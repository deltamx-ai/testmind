/**
 * Tests for static analysis (stage 2) and code smell detection.
 */

import { describe, it, expect } from 'vitest'
import { runStaticAnalysis } from '../stages/stage2-code.js'
import type { GitDiffResult, FileDiff } from '../types/index.js'

function makeDiff(files: FileDiff[]): GitDiffResult {
  return {
    baseBranch: 'main',
    headBranch: 'feature/test',
    commits: [],
    files,
    totalAdditions: 0,
    totalDeletions: 0,
    truncated: false,
  }
}

function makeFile(path: string, category: FileDiff['category'], addedLines: string[] = []): FileDiff {
  return {
    path,
    category,
    changeKind: 'modified',
    additions: addedLines.length,
    deletions: 0,
    isBinary: false,
    hunks: addedLines.length > 0 ? [{
      oldStart: 1, oldCount: 0, newStart: 1, newCount: addedLines.length,
      lines: addedLines.map((content, i) => ({ type: '+' as const, content, lineNumber: i + 1 })),
    }] : [],
  }
}

describe('runStaticAnalysis', () => {
  it('classifies files into correct buckets', () => {
    const diff = makeDiff([
      makeFile('src/auth/login.ts', 'source'),
      makeFile('src/auth/login.test.ts', 'test'),
      makeFile('package.json', 'config'),
      makeFile('migrations/001.sql', 'migration'),
    ])
    const result = runStaticAnalysis(diff)
    expect(result.sourceFiles).toEqual(['src/auth/login.ts'])
    expect(result.testFiles).toEqual(['src/auth/login.test.ts'])
    expect(result.configFiles).toEqual(['package.json'])
    expect(result.migrationFiles).toEqual(['migrations/001.sql'])
  })

  it('detects untested source files', () => {
    const diff = makeDiff([
      makeFile('src/auth/login.ts', 'source'),
      makeFile('src/auth/register.ts', 'source'),
      makeFile('src/auth/login.test.ts', 'test'),
    ])
    const result = runStaticAnalysis(diff)
    expect(result.untestedSourceFiles).toEqual(['src/auth/register.ts'])
  })

  it('matches test files with partial name overlap', () => {
    const diff = makeDiff([
      makeFile('src/auth/setupAuth.ts', 'source'),
      makeFile('src/auth/__tests__/auth.test.ts', 'test'),
    ])
    const result = runStaticAnalysis(diff)
    // 'auth' is contained in 'setupAuth', so it should match
    expect(result.untestedSourceFiles).toEqual([])
  })

  it('detects console.log code smell', () => {
    const diff = makeDiff([
      makeFile('src/app.ts', 'source', ['console.log("debug")', 'const x = 1']),
    ])
    const result = runStaticAnalysis(diff)
    expect(result.codeSmellHints.some(h => h.includes('Debug print'))).toBe(true)
  })

  it('detects TODO comments', () => {
    const diff = makeDiff([
      makeFile('src/app.ts', 'source', ['// TODO: fix this later']),
    ])
    const result = runStaticAnalysis(diff)
    expect(result.codeSmellHints.some(h => h.includes('TODO/FIXME'))).toBe(true)
  })

  it('detects possible hardcoded credentials', () => {
    const diff = makeDiff([
      makeFile('src/config.ts', 'source', ['const api_key = "sk-123"']),
    ])
    const result = runStaticAnalysis(diff)
    expect(result.codeSmellHints.some(h => h.includes('credential'))).toBe(true)
  })

  it('skips binary files for smell detection', () => {
    const file: FileDiff = {
      path: 'logo.png', category: 'other', changeKind: 'added',
      additions: 0, deletions: 0, isBinary: true, hunks: [],
    }
    const diff = makeDiff([file])
    const result = runStaticAnalysis(diff)
    expect(result.codeSmellHints).toEqual([])
  })

  it('detects changed imports', () => {
    const diff = makeDiff([
      makeFile('src/app.ts', 'source', ['import { something } from "./module"']),
    ])
    const result = runStaticAnalysis(diff)
    expect(result.changedImports.length).toBe(1)
    expect(result.changedImports[0]).toContain('import')
  })

  it('identifies critical path files when globs provided', () => {
    const diff = makeDiff([
      makeFile('src/payments/checkout.ts', 'source'),
      makeFile('src/utils/helpers.ts', 'source'),
      makeFile('src/auth/login.ts', 'source'),
    ])
    const result = runStaticAnalysis(diff, ['src/payments/**', 'src/auth/**'])
    expect(result.criticalPathFiles).toEqual(['src/payments/checkout.ts', 'src/auth/login.ts'])
  })

  it('returns empty criticalPathFiles when no globs provided', () => {
    const diff = makeDiff([makeFile('src/app.ts', 'source')])
    const result = runStaticAnalysis(diff)
    expect(result.criticalPathFiles).toEqual([])
  })
})
