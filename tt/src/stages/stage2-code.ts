/**
 * stages/stage2-code.ts
 *
 * 2a: Static analysis (no LLM)
 * 2b: PromptBuilder assembles prompt -> LLM understands business intent
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

// ─── Static analysis ─────────────────────────────────────────────────────────

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
  criticalPathFiles: string[]
}

const CODE_SMELL_PATTERNS: Array<{ regex: RegExp; hint: string }> = [
  { regex: /console\.log|console\.error|print\(|System\.out\.print/g, hint: 'Debug print statements left in code' },
  { regex: /TODO|FIXME|HACK|XXX/g, hint: 'TODO/FIXME comments in changed code' },
  { regex: /password|secret|token|api_key/gi, hint: 'Possible hardcoded credential or sensitive value' },
  { regex: /catch\s*\(\w+\)\s*\{\s*\}/g, hint: 'Empty catch block (swallowed exception)' },
  { regex: /\.catch\(\s*\(\s*\)\s*=>/g, hint: 'Silent promise rejection handler' },
]

/**
 * Simple glob-to-regex converter for criticalPaths matching.
 * Supports ** and * wildcards.
 */
function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '__DOUBLESTAR__')
    .replace(/\*/g, '[^/]*')
    .replace(/__DOUBLESTAR__/g, '.*')
  return new RegExp(`^${escaped}$`)
}

export function runStaticAnalysis(diff: GitDiffResult, criticalPaths?: string[]): StaticAnalysisResult {
  const buckets: Record<string, string[]> = {
    source: [], test: [], config: [], migration: [], 'api-schema': [], other: [],
  }
  const codeSmellHints = new Set<string>()
  const changedImports: string[] = []

  // Pre-compile critical path globs
  const criticalRegexes = (criticalPaths ?? []).map(g => globToRegex(g))

  for (const file of diff.files) {
    const cat = CATEGORY_MAP[file.category] ?? 'other'
    buckets[cat].push(file.path)
    if (file.isBinary) continue

    const addedText = file.hunks
      .flatMap(h => h.lines)
      .filter(l => l.type === '+')
      .map(l => l.content)
      .join('\n')

    for (const { regex, hint } of CODE_SMELL_PATTERNS) {
      // Reset lastIndex since we're reusing global regexes
      regex.lastIndex = 0
      if (regex.test(addedText)) {
        codeSmellHints.add(`${hint} — ${file.path}`)
      }
    }

    const imports = addedText.match(/^(?:import|require|from)\s+.+/gm)
    if (imports) changedImports.push(...imports.map(m => `${file.path}: ${m.trim()}`))
  }

  // Improved test-to-source matching: check both basename and directory proximity
  const testFileInfo = buckets.test.map(t => {
    const basename = t.replace(/\.(test|spec)\.(ts|tsx|js|jsx|py|go|rb|java)$/i, '').split('/').pop() ?? ''
    const dir = t.split('/').slice(0, -1).join('/')
    return { path: t, basename, dir }
  })

  const untestedSourceFiles = buckets.source.filter(s => {
    const basename = s.replace(/\.(ts|tsx|js|jsx|py|go|rb|java|rs)$/i, '').split('/').pop() ?? ''
    const sourceDir = s.split('/').slice(0, -1).join('/')
    // Match by basename (exact or partial) with directory proximity
    return !testFileInfo.some(t =>
      t.basename === basename ||
      t.basename.includes(basename) ||
      basename.includes(t.basename) ||
      // Also check if test is in a sibling __tests__ or test directory
      (t.dir.replace(/__tests__|\/test\b/, '') === sourceDir && t.basename === basename)
    )
  })

  // Identify files touching critical paths
  const criticalPathFiles = diff.files
    .filter(f => criticalRegexes.some(r => r.test(f.path)))
    .map(f => f.path)

  return {
    sourceFiles: buckets.source,
    testFiles: buckets.test,
    configFiles: buckets.config,
    migrationFiles: buckets.migration,
    apiSchemaFiles: buckets['api-schema'],
    untestedSourceFiles,
    codeSmellHints: [...codeSmellHints],
    changedImports: changedImports.slice(0, 30),
    criticalPathFiles,
  }
}

// ─── LLM analysis ────────────────────────────────────────────────────────────

interface LLMCodeReport {
  implementedFeatures: string[]
  modifiedBehaviors: string[]
  deletedBehaviors: string[]
  sideEffects: string[]
  testCoverage: { covered: string[]; uncovered: string[] }
  codeSmells: string[]
}

export async function runStage2(diff: GitDiffResult, techStack?: string, criticalPaths?: string[]): Promise<CodeReport> {
  const staticResult = runStaticAnalysis(diff, criticalPaths)

  const { system, user } = new PromptBuilder()
    .system(ROLE_SENIOR_ENGINEER)
    .system(TASK_CODE_ANALYSIS)
    .system(RULE_CODE_BUSINESS_LENS)
    .system(RULE_CONCISE)
    .system(SCHEMA_CODE_REPORT)
    .system(RULE_JSON_ONLY)
    .user(techStackSlot(techStack))
    .user(gitDiffSlot(diff, 1200))
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
    criticalPathFiles: staticResult.criticalPathFiles,
  }
}
