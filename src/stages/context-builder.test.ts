import { describe, it, expect } from 'vitest'
import { buildContext } from './context-builder.js'
import type { AnalysisContext } from '../types.js'

function makeCtx(overrides?: Partial<AnalysisContext>): AnalysisContext {
  return {
    git: {
      baseBranch: 'main',
      headBranch: 'feat/test',
      changedFiles: [
        {
          path: 'src/foo.ts',
          status: 'modified',
          additions: 10,
          deletions: 2,
          diff: '+added line\n-removed line',
          language: 'typescript',
          category: 'source',
        },
      ],
      stats: { additions: 10, deletions: 2, filesChanged: 1 },
      commits: [{ hash: 'abc1234', message: 'feat: add foo', date: '2026-01-01', author: 'dev' }],
    },
    dependencies: { impactedFiles: [], sharedModules: [], entryPoints: [] },
    history: { hotspots: [], recentFixCommits: [] },
    testCoverage: { covered: [], uncovered: ['src/foo.ts'], relatedTests: [], coverageRatio: 0 },
    stageWarnings: [],
    ...overrides,
  }
}

describe('buildContext', () => {
  it('includes change summary section', () => {
    const result = buildContext(makeCtx())
    expect(result).toContain('变更概要')
    expect(result).toContain('feat/test')
    expect(result).toContain('src/foo.ts')
  })

  it('includes commit records', () => {
    const result = buildContext(makeCtx())
    expect(result).toContain('提交记录')
    expect(result).toContain('feat: add foo')
  })

  it('includes test coverage section', () => {
    const result = buildContext(makeCtx())
    expect(result).toContain('测试覆盖情况')
    expect(result).toContain('0%')
    expect(result).toContain('src/foo.ts')
  })

  it('includes high risk diffs when hotspots exist', () => {
    const ctx = makeCtx({
      history: {
        hotspots: [{ path: 'src/foo.ts', commitCount: 15, fixCount: 5, riskLevel: 'high' }],
        recentFixCommits: [],
      },
    })
    const result = buildContext(ctx)
    expect(result).toContain('高风险文件 Diff')
    expect(result).toContain('历史风险热区')
  })

  it('includes dependency impact section', () => {
    const ctx = makeCtx({
      dependencies: {
        impactedFiles: [{ path: 'src/bar.ts', reason: 'imports from src/foo.ts', depth: 1 }],
        sharedModules: [],
        entryPoints: ['src/pages/index.ts'],
      },
    })
    const result = buildContext(ctx)
    expect(result).toContain('依赖影响面')
    expect(result).toContain('src/bar.ts')
    expect(result).toContain('受影响的入口文件')
  })

  it('respects token budget by truncating lower-priority sections', () => {
    const bigDiff = 'x'.repeat(90_000)
    const ctx = makeCtx()
    ctx.git.changedFiles[0].diff = bigDiff
    ctx.history.hotspots = [{ path: 'src/foo.ts', commitCount: 15, fixCount: 5, riskLevel: 'high' }]
    const result = buildContext(ctx)
    // Should not exceed MAX_CONTEXT_CHARS too much (required sections may push over)
    // But optional sections like "其他变更文件 Diff" should be omitted
    expect(result).not.toContain('其他变更文件 Diff')
  })
})
