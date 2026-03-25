import { describe, it, expect, vi } from 'vitest'

vi.mock('../utils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils.js')>()
  return {
    ...actual,
    exec: vi.fn(),
    execLines: vi.fn(),
    getLanguageFromPath: actual.getLanguageFromPath,
    truncateDiff: actual.truncateDiff,
  }
})

import { analyzeGit } from './git-analyzer.js'
import { exec, execLines } from '../utils.js'

const mockedExec = vi.mocked(exec)
const mockedExecLines = vi.mocked(execLines)

describe('analyzeGit', () => {
  it('returns correct structure with changed files', async () => {
    mockedExec.mockImplementation((cmd) => {
      if (cmd.includes('merge-base')) return 'abc123'
      if (cmd.includes('git diff') && cmd.includes('-- "')) return '+added\n-removed'
      return ''
    })
    mockedExecLines.mockImplementation((cmd) => {
      if (cmd.includes('--name-status')) return ['M\tsrc/foo.ts']
      if (cmd.includes('--numstat')) return ['10\t2\tsrc/foo.ts']
      if (cmd.includes('--format')) return ['def456|feat: add foo|2026-01-01|dev']
      return []
    })

    const result = await analyzeGit('/repo', 'main', 'feat/test')
    expect(result.baseBranch).toBe('main')
    expect(result.headBranch).toBe('feat/test')
    expect(result.changedFiles).toHaveLength(1)
    expect(result.changedFiles[0].path).toBe('src/foo.ts')
    expect(result.changedFiles[0].status).toBe('modified')
    expect(result.changedFiles[0].additions).toBe(10)
    expect(result.changedFiles[0].deletions).toBe(2)
    expect(result.changedFiles[0].category).toBe('source')
    expect(result.stats.filesChanged).toBe(1)
    expect(result.commits).toHaveLength(1)
    expect(result.commits[0].message).toBe('feat: add foo')
  })

  it('handles added files', async () => {
    mockedExec.mockImplementation((cmd) => {
      if (cmd.includes('merge-base')) return 'abc123'
      if (cmd.includes('git diff') && cmd.includes('-- "')) return '+new file content'
      return ''
    })
    mockedExecLines.mockImplementation((cmd) => {
      if (cmd.includes('--name-status')) return ['A\tsrc/new.ts']
      if (cmd.includes('--numstat')) return ['20\t0\tsrc/new.ts']
      if (cmd.includes('--format')) return []
      return []
    })

    const result = await analyzeGit('/repo', 'main', 'feat/new')
    expect(result.changedFiles[0].status).toBe('added')
    expect(result.changedFiles[0].additions).toBe(20)
  })

  it('handles renamed files', async () => {
    mockedExec.mockImplementation((cmd) => {
      if (cmd.includes('merge-base')) return 'abc123'
      if (cmd.includes('git diff') && cmd.includes('-- "')) return 'renamed content'
      return ''
    })
    mockedExecLines.mockImplementation((cmd) => {
      if (cmd.includes('--name-status')) return ['R100\tsrc/old.ts\tsrc/new.ts']
      if (cmd.includes('--numstat')) return ['0\t0\tsrc/new.ts']
      if (cmd.includes('--format')) return []
      return []
    })

    const result = await analyzeGit('/repo', 'main', 'feat/rename')
    expect(result.changedFiles[0].path).toBe('src/new.ts')
    expect(result.changedFiles[0].status).toBe('renamed')
  })

  it('falls back to baseBranch if merge-base fails', async () => {
    mockedExec.mockImplementation((cmd) => {
      if (cmd.includes('merge-base')) throw new Error('no merge base')
      if (cmd.includes('git diff') && cmd.includes('-- "')) return ''
      return ''
    })
    mockedExecLines.mockImplementation((cmd) => {
      if (cmd.includes('--name-status')) return ['M\tsrc/foo.ts']
      if (cmd.includes('--numstat')) return ['1\t1\tsrc/foo.ts']
      if (cmd.includes('--format')) return []
      return []
    })

    const result = await analyzeGit('/repo', 'main', 'feat/test')
    // Should not throw
    expect(result.changedFiles).toHaveLength(1)
  })

  it('returns empty when no changes', async () => {
    mockedExec.mockReturnValue('abc123')
    mockedExecLines.mockReturnValue([])

    const result = await analyzeGit('/repo', 'main', 'feat/empty')
    expect(result.changedFiles).toHaveLength(0)
    expect(result.stats.filesChanged).toBe(0)
  })

  it('categorizes test files correctly', async () => {
    mockedExec.mockImplementation((cmd) => {
      if (cmd.includes('merge-base')) return 'abc123'
      if (cmd.includes('git diff') && cmd.includes('-- "')) return ''
      return ''
    })
    mockedExecLines.mockImplementation((cmd) => {
      if (cmd.includes('--name-status')) return ['M\tsrc/__tests__/auth.test.ts']
      if (cmd.includes('--numstat')) return ['5\t2\tsrc/__tests__/auth.test.ts']
      if (cmd.includes('--format')) return []
      return []
    })

    const result = await analyzeGit('/repo', 'main', 'feat/test')
    expect(result.changedFiles[0].category).toBe('test')
  })
})
