/**
 * stages/stage2-code.ts
 *
 * Stage 2: Code Analysis
 *
 * 2a — Static analysis (no LLM)
 *       Classify files, count changes, detect test coverage gaps,
 *       flag suspicious patterns (console.log, TODO, hardcoded values…)
 *
 * 2b — LLM analysis
 *       Read the diff and convert it from "what changed" → "what business features
 *       does this implement / modify / remove?"
 *
 * Output → CodeReport
 */

import type { GitDiffResult, CodeReport, FileDiff } from '../types/index.js'
import { diffToPromptText } from '../git/analyzer.js'
import { callLLM, extractJSON, JSON_ONLY_INSTRUCTION } from '../llm/client.js'

// ─── 2a: static analysis ─────────────────────────────────────────────────────

export interface StaticAnalysisResult {
  sourceFiles: string[]
  testFiles: string[]
  configFiles: string[]
  migrationFiles: string[]
  apiSchemaFiles: string[]
  /** source files without any corresponding test file changes */
  untestedSourceFiles: string[]
  /** patterns that indicate potential issues */
  codeSmellHints: string[]
  /** Import/require relationships changed in diff */
  changedImports: string[]
}

const CODE_SMELL_PATTERNS: Array<{ pattern: RegExp; hint: string }> = [
  { pattern: /console\.log|console\.error|print\(|System\.out\.print/g, hint: 'Debug print statements left in code' },
  { pattern: /TODO|FIXME|HACK|XXX/g, hint: 'TODO/FIXME comments in changed code' },
  { pattern: /password|secret|token|api_key/gi, hint: 'Possible hardcoded credential or sensitive value' },
  { pattern: /catch\s*\(\w+\)\s*\{\s*\}/g, hint: 'Empty catch block (swallowed exception)' },
  { pattern: /any\s*[;,)]/g, hint: 'TypeScript `any` type used' },
  { pattern: /\.catch\(\s*\(\s*\)\s*=>/g, hint: 'Silent promise rejection handler' },
  { pattern: /setTimeout.*0\)/g, hint: 'setTimeout with 0ms delay (possible hack)' },
  { pattern: /Math\.random|Date\.now/g, hint: 'Non-deterministic value used (may affect test reliability)' },
]

function runStaticAnalysis(diff: GitDiffResult): StaticAnalysisResult {
  const sourceFiles: string[] = []
  const testFiles: string[] = []
  const configFiles: string[] = []
  const migrationFiles: string[] = []
  const apiSchemaFiles: string[] = []
  const codeSmellHints = new Set<string>()
  const changedImports: string[] = []

  for (const file of diff.files) {
    switch (file.category) {
      case 'source':      sourceFiles.push(file.path); break
      case 'test':        testFiles.push(file.path); break
      case 'config':      configFiles.push(file.path); break
      case 'migration':   migrationFiles.push(file.path); break
      case 'api-schema':  apiSchemaFiles.push(file.path); break
    }

    if (file.isBinary) continue

    // Analyse added lines for smells
    const addedLines = file.hunks
      .flatMap((h) => h.lines)
      .filter((l) => l.type === '+')
      .map((l) => l.content)
      .join('\n')

    for (const { pattern, hint } of CODE_SMELL_PATTERNS) {
      if (pattern.test(addedLines)) {
        codeSmellHints.add(`${hint} — in ${file.path}`)
      }
    }

    // Track import changes
    const importMatches = addedLines.match(/^(?:import|require|from)\s+.+/gm)
    if (importMatches) {
      changedImports.push(...importMatches.map((m) => `${file.path}: ${m.trim()}`))
    }
  }

  // Determine which source files have no matching test change
  const testBasenames = new Set(
    testFiles.map((t) =>
      t.replace(/\.(test|spec)\.(ts|tsx|js|jsx|py|go|rb|java)$/i, '').split('/').pop() ?? '',
    ),
  )

  const untestedSourceFiles = sourceFiles.filter((s) => {
    const basename = s.replace(/\.(ts|tsx|js|jsx|py|go|rb|java|rs)$/i, '').split('/').pop() ?? ''
    return !testBasenames.has(basename)
  })

  return {
    sourceFiles,
    testFiles,
    configFiles,
    migrationFiles,
    apiSchemaFiles,
    untestedSourceFiles,
    codeSmellHints: [...codeSmellHints],
    changedImports: changedImports.slice(0, 30), // cap at 30 for prompt
  }
}

// ─── 2b: LLM analysis ────────────────────────────────────────────────────────

interface LLMCodeReport {
  implementedFeatures: string[]
  modifiedBehaviors: string[]
  deletedBehaviors: string[]
  sideEffects: string[]
  testCoverage: {
    covered: string[]
    uncovered: string[]
  }
  codeSmells: string[]
}

async function runLLMCodeAnalysis(
  diff: GitDiffResult,
  staticResult: StaticAnalysisResult,
  techStack?: string,
): Promise<LLMCodeReport> {
  const diffText = diffToPromptText(diff, 1500)

  const systemPrompt = `
You are a senior software engineer performing a pre-test code review.
Your goal is to understand what business functionality this git diff implements,
modifies, or removes — from a PRODUCT / BUSINESS perspective, not a code perspective.

Think like a QA engineer reading the diff: what features are now available?
What existing behaviour changed? What might break?

${techStack ? `Tech stack context: ${techStack}` : ''}

${JSON_ONLY_INSTRUCTION}

Output schema:
{
  "implementedFeatures": [
    "Concise sentence describing a business feature this diff implements"
  ],
  "modifiedBehaviors": [
    "Existing behaviour X was changed to Y (be specific about before/after)"
  ],
  "deletedBehaviors": [
    "Feature or behaviour that was removed"
  ],
  "sideEffects": [
    "Module or functionality that might be indirectly affected by these changes"
  ],
  "testCoverage": {
    "covered": ["Changes that have corresponding test modifications"],
    "uncovered": ["Changes that lack test coverage"]
  },
  "codeSmells": [
    "Code quality concern (not related to requirements)"
  ]
}

Rules:
- implementedFeatures: use business language (e.g. "Users can now reset their password via email")
  NOT code language (e.g. "Added resetPassword() method")
- modifiedBehaviors: must be specific. Bad: "Changed login logic". Good: "Login now requires email verification before issuing JWT"
- sideEffects: only include modules that are ACTUALLY imported/called by changed code
- testCoverage: cross-reference the list of untested source files provided
- Be concise. No item should exceed two sentences.
`.trim()

  const userPrompt = `
## Diff to analyse

${diffText}

## Static analysis findings (use these to inform testCoverage)

Source files changed (${staticResult.sourceFiles.length}): ${staticResult.sourceFiles.join(', ') || 'none'}
Test files changed (${staticResult.testFiles.length}): ${staticResult.testFiles.join(', ') || 'none'}
Source files with NO matching test changes: ${staticResult.untestedSourceFiles.join(', ') || 'none'}
Migrations: ${staticResult.migrationFiles.join(', ') || 'none'}
API schema changes: ${staticResult.apiSchemaFiles.join(', ') || 'none'}
Pre-detected code smells: ${staticResult.codeSmellHints.join(' | ') || 'none'}
`.trim()

  const raw = await callLLM({
    system: systemPrompt,
    userPrompt,
    maxTokens: 3000,
    temperature: 0.2,
  })

  return extractJSON<LLMCodeReport>(raw)
}

// ─── public API ───────────────────────────────────────────────────────────────

export async function runStage2(
  diff: GitDiffResult,
  techStack?: string,
): Promise<CodeReport> {
  // 2a: static (synchronous, fast)
  const staticResult = runStaticAnalysis(diff)

  // 2b: LLM understanding (async)
  const llmResult = await runLLMCodeAnalysis(diff, staticResult, techStack)

  // Merge static code smells with LLM-detected ones
  const allCodeSmells = [
    ...staticResult.codeSmellHints,
    ...(llmResult.codeSmells ?? []),
  ].filter(Boolean)

  return {
    implementedFeatures: llmResult.implementedFeatures ?? [],
    modifiedBehaviors: llmResult.modifiedBehaviors ?? [],
    deletedBehaviors: llmResult.deletedBehaviors ?? [],
    sideEffects: llmResult.sideEffects ?? [],
    testCoverage: {
      covered: llmResult.testCoverage?.covered ?? [],
      uncovered: [
        ...(llmResult.testCoverage?.uncovered ?? []),
        ...staticResult.untestedSourceFiles.map((f) => `No test changes for ${f}`),
      ].filter((v, i, arr) => arr.indexOf(v) === i), // dedupe
    },
    codeSmells: allCodeSmells,
    affectedFiles: staticResult.sourceFiles,
  }
}
