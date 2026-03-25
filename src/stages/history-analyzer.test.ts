import { describe, it, expect, vi } from 'vitest'

vi.mock('../utils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils.js')>()
  return {
    ...actual,
    gitLines: vi.fn(),
  }
})

import { analyzeHistory } from './history-analyzer.js'
import { gitLines } from '../utils.js'
import type { ChangedFile } from '../types.js'

const mockedGitLines = vi.mocked(gitLines)

function makeFile(path: string, status: ChangedFile['status'] = 'modified'): ChangedFile {
  return {
    path,
    status,
    additions: 5,
    deletions: 1,
    diff: '',
    language: 'typescript',
    category: 'source',
  }
}

describe('analyzeHistory', () => {
  it('skips newly added files', async () => {
    mockedGitLines.mockReturnValue([])
    const result = await analyzeHistory([makeFile('src/new.ts', 'added')], '/repo')
    expect(result.hotspots).toHaveLength(0)
    expect(mockedGitLines).not.toHaveBeenCalled()
  })

  it('classifies high risk correctly', async () => {
    // 11 commits, 4 fixes
    const lines = [
      ...Array.from({ length: 7 }, (_, i) => `hash${i}|feat: change ${i}|2026-01-01`),
      ...Array.from({ length: 4 }, (_, i) => `fixhash${i}|fix: bug ${i}|2026-01-02`),
    ]
    mockedGitLines.mockReturnValue(lines)
    const result = await analyzeHistory([makeFile('src/auth.ts')], '/repo')
    expect(result.hotspots).toHaveLength(1)
    expect(result.hotspots[0].riskLevel).toBe('high')
    expect(result.hotspots[0].commitCount).toBe(11)
    expect(result.hotspots[0].fixCount).toBe(4)
  })

  it('classifies medium risk correctly', async () => {
    const lines = [
      ...Array.from({ length: 5 }, (_, i) => `hash${i}|feat: change ${i}|2026-01-01`),
      'fixhash0|fix: bug|2026-01-02',
      'fixhash1|fix: another bug|2026-01-02',
    ]
    mockedGitLines.mockReturnValue(lines)
    const result = await analyzeHistory([makeFile('src/svc.ts')], '/repo')
    expect(result.hotspots[0].riskLevel).toBe('medium')
  })

  it('classifies low risk correctly', async () => {
    mockedGitLines.mockReturnValue(['hash0|feat: init|2026-01-01'])
    const result = await analyzeHistory([makeFile('src/util.ts')], '/repo')
    expect(result.hotspots[0].riskLevel).toBe('low')
  })

  it('collects fix commits', async () => {
    mockedGitLines.mockReturnValue([
      'abc123|fix: crash on null input|2026-02-01',
    ])
    const result = await analyzeHistory([makeFile('src/parser.ts')], '/repo')
    expect(result.recentFixCommits).toHaveLength(1)
    expect(result.recentFixCommits[0].hash).toBe('abc123')
    expect(result.recentFixCommits[0].files).toContain('src/parser.ts')
  })

  it('handles git log failure gracefully', async () => {
    mockedGitLines.mockImplementation(() => { throw new Error('git error') })
    const result = await analyzeHistory([makeFile('src/broken.ts')], '/repo')
    expect(result.hotspots).toHaveLength(0)
  })

  it('sorts by risk then fixCount', async () => {
    mockedGitLines
      .mockReturnValueOnce(['h1|feat: a|2026-01-01']) // low risk
      .mockReturnValueOnce([
        ...Array.from({ length: 12 }, (_, i) => `h${i}|fix: bug ${i}|2026-01-01`),
      ]) // high risk
    const result = await analyzeHistory([
      makeFile('src/low.ts'),
      makeFile('src/high.ts'),
    ], '/repo')
    expect(result.hotspots[0].path).toBe('src/high.ts')
    expect(result.hotspots[1].path).toBe('src/low.ts')
  })
})
