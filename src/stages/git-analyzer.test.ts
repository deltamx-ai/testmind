import { describe, it, expect, vi } from 'vitest'

vi.mock('../utils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils.js')>()
  return {
    ...actual,
    git: vi.fn(),
    gitLines: vi.fn(),
    getLanguageFromPath: actual.getLanguageFromPath,
    truncateDiff: actual.truncateDiff,
  }
})

import { analyzeGit } from './git-analyzer.js'
import { git, gitLines } from '../utils.js'

const mockedGit = vi.mocked(git)
const mockedGitLines = vi.mocked(gitLines)

describe('analyzeGit', () => {
  it('returns correct structure with changed files', async () => {
    mockedGit.mockImplementation((args) => {
      if (args[0] === 'merge-base') return 'abc123'
      if (args[0] === 'diff' && args.includes('--')) return '+added\n-removed'
      return ''
    })
    mockedGitLines.mockImplementation((args) => {
      if (args.includes('--name-status')) return ['M\tsrc/foo.ts']
      if (args.includes('--numstat')) return ['10\t2\tsrc/foo.ts']
      if (args.some(arg => arg.startsWith('--format='))) return ['def456|feat: add foo|2026-01-01|dev']
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
    mockedGit.mockImplementation((args) => {
      if (args[0] === 'merge-base') return 'abc123'
      if (args[0] === 'diff' && args.includes('--')) return '+new file content'
      return ''
    })
    mockedGitLines.mockImplementation((args) => {
      if (args.includes('--name-status')) return ['A\tsrc/new.ts']
      if (args.includes('--numstat')) return ['20\t0\tsrc/new.ts']
      if (args.some(arg => arg.startsWith('--format='))) return []
      return []
    })

    const result = await analyzeGit('/repo', 'main', 'feat/new')
    expect(result.changedFiles[0].status).toBe('added')
    expect(result.changedFiles[0].additions).toBe(20)
  })

  it('handles renamed files', async () => {
    mockedGit.mockImplementation((args) => {
      if (args[0] === 'merge-base') return 'abc123'
      if (args[0] === 'diff' && args.includes('--')) return 'renamed content'
      return ''
    })
    mockedGitLines.mockImplementation((args) => {
      if (args.includes('--name-status')) return ['R100\tsrc/old.ts\tsrc/new.ts']
      if (args.includes('--numstat')) return ['0\t0\tsrc/new.ts']
      if (args.some(arg => arg.startsWith('--format='))) return []
      return []
    })

    const result = await analyzeGit('/repo', 'main', 'feat/rename')
    expect(result.changedFiles[0].path).toBe('src/new.ts')
    expect(result.changedFiles[0].status).toBe('renamed')
  })

  it('falls back to baseBranch if merge-base fails', async () => {
    mockedGit.mockImplementation((args) => {
      if (args[0] === 'merge-base') throw new Error('no merge base')
      if (args[0] === 'diff' && args.includes('--')) return ''
      return ''
    })
    mockedGitLines.mockImplementation((args) => {
      if (args.includes('--name-status')) return ['M\tsrc/foo.ts']
      if (args.includes('--numstat')) return ['1\t1\tsrc/foo.ts']
      if (args.some(arg => arg.startsWith('--format='))) return []
      return []
    })

    const result = await analyzeGit('/repo', 'main', 'feat/test')
    // Should not throw
    expect(result.changedFiles).toHaveLength(1)
  })

  it('returns empty when no changes', async () => {
    mockedGit.mockReturnValue('abc123')
    mockedGitLines.mockReturnValue([])

    const result = await analyzeGit('/repo', 'main', 'feat/empty')
    expect(result.changedFiles).toHaveLength(0)
    expect(result.stats.filesChanged).toBe(0)
  })

  it('categorizes test files correctly', async () => {
    mockedGit.mockImplementation((args) => {
      if (args[0] === 'merge-base') return 'abc123'
      if (args[0] === 'diff' && args.includes('--')) return ''
      return ''
    })
    mockedGitLines.mockImplementation((args) => {
      if (args.includes('--name-status')) return ['M\tsrc/__tests__/auth.test.ts']
      if (args.includes('--numstat')) return ['5\t2\tsrc/__tests__/auth.test.ts']
      if (args.some(arg => arg.startsWith('--format='))) return []
      return []
    })

    const result = await analyzeGit('/repo', 'main', 'feat/test')
    expect(result.changedFiles[0].category).toBe('test')
  })
})
