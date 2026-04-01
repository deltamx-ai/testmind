/**
 * stages/stage2-code.ts  (重写版)
 *
 * 2a: 纯静态分析（无 LLM）
 * 2b: PromptBuilder 组装 prompt → LLM 理解业务意图
 */

import type { GitDiffResult, CodeReport } from '../types/index.js'
import { callLLM, extractJSON } from '../llm/client.js'
import { PromptBuilder } from '../prompt/builder.js'
import {
  ROLE_SENIOR_ENGINEER,
  TASK_CODE_ANALYSIS,
  RULE_CODE_BUSINESS_LENS,
  RULE_CONCISE,
  RULE_JSON_ONLY,
  SCHEMA_CODE_REPORT,
} from '../prompt/blocks.js'
import { gitDiffSlot, staticAnalysisSlot, techStackSlot } from '../prompt/slots.js'

// ─── 静态分析 ─────────────────────────────────────────────────────────────────

const CATEGORY_MAP: Record<string, string> = {
  source: 'source', test: 'test', config: 'config',
  migration: 'migration', 'api-schema': 'api-schema',
}

export interface StaticAnalysisResult {
  sourceFiles: string[]
  testFiles: string[]
  configFiles: string[]
  migrationFiles: string[]
  apiSchemaFiles: string[]
  untestedSourceFiles: string[]
  codeSmellHints: string[]
  changedImports: string[]
}

const CODE_SMELL_PATTERNS: Array<{ pattern: RegExp; hint: string }> = [
  { pattern: /console\.log|console\.error|print\(|System\.out\.print/g, hint: 'Debug print statements left in code' },
  { pattern: /TODO|FIXME|HACK|XXX/g, hint: 'TODO/FIXME comments in changed code' },
  { pattern: /password|secret|token|api_key/gi, hint: 'Possible hardcoded credential or sensitive value' },
  { pattern: /catch\s*\(\w+\)\s*\{\s*\}/g, hint: 'Empty catch block (swallowed exception)' },
  { pattern: /\.catch\(\s*\(\s*\)\s*=>/g, hint: 'Silent promise rejection handler' },
]

export function runStaticAnalysis(diff: GitDiffResult): StaticAnalysisResult {
  const buckets: Record<string, string[]> = {
    source: [], test: [], config: [], migration: [], 'api-schema': [], other: [],
  }
  const codeSmellHints = new Set<string>()
  const changedImports: string[] = []

  for (const file of diff.files) {
    const cat = CATEGORY_MAP[file.category] ?? 'other'
    buckets[cat].push(file.path)
    if (file.isBinary) continue

    const addedText = file.hunks
      .flatMap(h => h.lines)
      .filter(l => l.type === '+')
      .map(l => l.content)
      .join('\n')

    for (const { pattern, hint } of CODE_SMELL_PATTERNS) {
      if (new RegExp(pattern.source, pattern.flags).test(addedText)) {
        codeSmellHints.add(`${hint} — ${file.path}`)
      }
    }

    const imports = addedText.match(/^(?:import|require|from)\s+.+/gm)
    if (imports) changedImports.push(...imports.map(m => `${file.path}: ${m.trim()}`))
  }

  const testBasenames = new Set(
    buckets.test.map(t =>
      t.replace(/\.(test|spec)\.(ts|tsx|js|jsx|py|go|rb|java)$/i, '').split('/').pop() ?? '',
    ),
  )

  const untestedSourceFiles = buckets.source.filter(s => {
    const basename = s.replace(/\.(ts|tsx|js|jsx|py|go|rb|java|rs)$/i, '').split('/').pop() ?? ''
    return !testBasenames.has(basename)
  })

  return {
    sourceFiles: buckets.source,
    testFiles: buckets.test,
    configFiles: buckets.config,
    migrationFiles: buckets.migration,
    apiSchemaFiles: buckets['api-schema'],
    untestedSourceFiles,
    codeSmellHints: [...codeSmellHints],
    changedImports: changedImports.slice(0, 30),
  }
}

// ─── LLM 分析 ─────────────────────────────────────────────────────────────────

interface LLMCodeReport {
  implementedFeatures: string[]
  modifiedBehaviors: string[]
  deletedBehaviors: string[]
  sideEffects: string[]
  testCoverage: { covered: string[]; uncovered: string[] }
  codeSmells: string[]
}

export async function runStage2(diff: GitDiffResult, techStack?: string): Promise<CodeReport> {
  const staticResult = runStaticAnalysis(diff)

  // ── Prompt 组装 ───────────────────────────────────────────────────────────
  //
  // 条件分支：techStack 仅在配置了才注入（skipIfEmpty=true 是默认值）
  // 动态注入：diff 内容 + static 分析结果（避免 LLM 重复检测已知问题）

  const { system, user } = new PromptBuilder()
    .system(ROLE_SENIOR_ENGINEER)
    .system(TASK_CODE_ANALYSIS)
    .system(RULE_CODE_BUSINESS_LENS)
    .system(RULE_CONCISE)
    .system(SCHEMA_CODE_REPORT)
    .system(RULE_JSON_ONLY)
    // techStack slot — 空时自动跳过（skipIfEmpty=true）
    .user(techStackSlot(techStack))
    // diff 内容：限制 1200 行 source lines，超出截断
    .user(gitDiffSlot(diff, 1200))
    // 静态分析的发现直接注入，让 LLM 聚焦在语义理解上
    .user(staticAnalysisSlot(staticResult))
    .build()

  const raw = await callLLM({ system, userPrompt: user, maxTokens: 3000, temperature: 0.2 })
  const llmResult = extractJSON<LLMCodeReport>(raw)

  return {
    implementedFeatures: llmResult.implementedFeatures ?? [],
    modifiedBehaviors: llmResult.modifiedBehaviors ?? [],
    deletedBehaviors: llmResult.deletedBehaviors ?? [],
    sideEffects: llmResult.sideEffects ?? [],
    testCoverage: {
      covered: llmResult.testCoverage?.covered ?? [],
      uncovered: [
        ...(llmResult.testCoverage?.uncovered ?? []),
        ...staticResult.untestedSourceFiles.map(f => `No test changes for ${f}`),
      ].filter((v, i, arr) => arr.indexOf(v) === i),
    },
    codeSmells: [
      ...staticResult.codeSmellHints,
      ...(llmResult.codeSmells ?? []),
    ],
    affectedFiles: staticResult.sourceFiles,
  }
}
