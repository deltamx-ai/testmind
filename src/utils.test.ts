import { describe, it, expect, vi } from 'vitest'
import * as childProcess from 'node:child_process'
import { branchExists, detectBaseBranch, exec, execLines, getCurrentBranch, getLanguageFromPath, git, gitLines, isGitRepo, truncateDiff } from './utils.js'

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    execFileSync: vi.fn(),
  }
})

const mockedExecFileSync = vi.mocked(childProcess.execFileSync)

describe('getLanguageFromPath', () => {
  it('maps common extensions', () => {
    expect(getLanguageFromPath('src/index.ts')).toBe('typescript')
    expect(getLanguageFromPath('app.jsx')).toBe('javascript')
    expect(getLanguageFromPath('main.py')).toBe('python')
    expect(getLanguageFromPath('main.go')).toBe('go')
    expect(getLanguageFromPath('lib.rs')).toBe('rust')
    expect(getLanguageFromPath('App.vue')).toBe('vue')
    expect(getLanguageFromPath('style.scss')).toBe('scss')
    expect(getLanguageFromPath('config.yaml')).toBe('yaml')
    expect(getLanguageFromPath('config.yml')).toBe('yaml')
    expect(getLanguageFromPath('Dockerfile')).toBe('dockerfile')
  })

  it('returns raw extension for unknown types', () => {
    expect(getLanguageFromPath('file.xyz')).toBe('xyz')
  })

  it('returns empty string for no extension', () => {
    // 'Makefile' -> extension is 'Makefile' (no dot), lowercased to 'makefile'
    expect(getLanguageFromPath('Makefile')).toBe('makefile')
  })
})

describe('truncateDiff', () => {
  it('returns full diff when under limit', () => {
    const diff = 'line1\nline2\nline3'
    expect(truncateDiff(diff, 10)).toBe(diff)
  })

  it('truncates long diffs with head/tail', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line${i}`)
    const diff = lines.join('\n')
    const result = truncateDiff(diff, 20)

    // Should have head (65% of 20 = 13) + omit message + tail (30% of 20 = 6)
    const resultLines = result.split('\n')
    expect(resultLines.length).toBeLessThan(100)
    expect(result).toContain('lines omitted')
    // First line preserved
    expect(result).toContain('line0')
    // Last line preserved
    expect(result).toContain('line99')
  })

  it('handles exact boundary', () => {
    const lines = Array.from({ length: 5 }, (_, i) => `line${i}`)
    const diff = lines.join('\n')
    expect(truncateDiff(diff, 5)).toBe(diff)
  })
})

describe('command helpers', () => {
  it('exec passes command and args to execFileSync', () => {
    mockedExecFileSync.mockReturnValueOnce('ok')
    expect(exec('git', ['status', '--short'], '/repo')).toBe('ok')
    expect(mockedExecFileSync).toHaveBeenCalledWith('git', ['status', '--short'], expect.objectContaining({ cwd: '/repo' }))
  })

  it('execLines splits output into lines', () => {
    mockedExecFileSync.mockReturnValueOnce('a\nb\n')
    expect(execLines('git', ['branch'], '/repo')).toEqual(['a', 'b'])
  })

  it('git helpers delegate to git command', () => {
    mockedExecFileSync.mockReturnValueOnce('HEAD')
    expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], '/repo')).toBe('HEAD')
    expect(mockedExecFileSync).toHaveBeenCalledWith('git', ['rev-parse', '--abbrev-ref', 'HEAD'], expect.any(Object))
  })

  it('gitLines returns split output', () => {
    mockedExecFileSync.mockReturnValueOnce('main\nfeature/test')
    expect(gitLines(['branch', '--format=%(refname:short)'], '/repo')).toEqual(['main', 'feature/test'])
  })
})

describe('git utilities', () => {
  it('isGitRepo returns true when git succeeds', () => {
    mockedExecFileSync.mockReturnValueOnce('true')
    expect(isGitRepo('/repo')).toBe(true)
  })

  it('detectBaseBranch prefers existing local branch', () => {
    mockedExecFileSync
      .mockImplementationOnce(() => { throw new Error('missing') })
      .mockReturnValueOnce('master')
    expect(detectBaseBranch('/repo')).toBe('master')
  })

  it('detectBaseBranch falls back to origin HEAD', () => {
    mockedExecFileSync
      .mockImplementationOnce(() => { throw new Error('missing') })
      .mockImplementationOnce(() => { throw new Error('missing') })
      .mockImplementationOnce(() => { throw new Error('missing') })
      .mockReturnValueOnce('refs/remotes/origin/main')
    expect(detectBaseBranch('/repo')).toBe('main')
  })

  it('branchExists checks local then remote branch', () => {
    mockedExecFileSync
      .mockImplementationOnce(() => { throw new Error('missing') })
      .mockReturnValueOnce('origin/feature/x')
    expect(branchExists('/repo', 'feature/x')).toBe(true)
  })

  it('getCurrentBranch reads HEAD branch name', () => {
    mockedExecFileSync.mockReturnValueOnce('feature/test')
    expect(getCurrentBranch('/repo')).toBe('feature/test')
  })
})
