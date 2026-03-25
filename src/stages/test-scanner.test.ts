import { describe, it, expect, vi } from 'vitest'

// We need to mock gitLines since these call git commands
vi.mock('../utils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils.js')>()
  return {
    ...actual,
    gitLines: vi.fn(),
  }
})

import { scanTestCoverage } from './test-scanner.js'
import { gitLines } from '../utils.js'
import type { ChangedFile } from '../types.js'

const mockedGitLines = vi.mocked(gitLines)

function makeFile(path: string, category: 'source' | 'test' = 'source'): ChangedFile {
  return {
    path,
    status: 'modified',
    additions: 5,
    deletions: 1,
    diff: '',
    language: 'typescript',
    category,
  }
}

describe('scanTestCoverage', () => {
  it('returns empty when no source files', async () => {
    const result = await scanTestCoverage([], '/repo')
    expect(result.coverageRatio).toBe(0)
    expect(result.covered).toEqual([])
    expect(result.uncovered).toEqual([])
  })

  it('matches source to test by filename stem', async () => {
    mockedGitLines.mockReturnValue(['src/__tests__/auth.test.ts'])
    const result = await scanTestCoverage([makeFile('src/auth.ts')], '/repo')
    expect(result.covered).toHaveLength(1)
    expect(result.covered[0].sourcePath).toBe('src/auth.ts')
    expect(result.covered[0].testPaths).toContain('src/__tests__/auth.test.ts')
    expect(result.coverageRatio).toBe(1)
  })

  it('handles camelCase to kebab-case matching', async () => {
    mockedGitLines.mockReturnValue(['src/user-service.test.ts'])
    const result = await scanTestCoverage([makeFile('src/userService.ts')], '/repo')
    expect(result.covered).toHaveLength(1)
  })

  it('reports uncovered files', async () => {
    mockedGitLines.mockReturnValue([])
    const result = await scanTestCoverage([makeFile('src/orphan.ts')], '/repo')
    expect(result.uncovered).toEqual(['src/orphan.ts'])
    expect(result.coverageRatio).toBe(0)
  })

  it('handles git ls-files failure gracefully', async () => {
    mockedGitLines.mockImplementation(() => { throw new Error('git error') })
    const result = await scanTestCoverage([makeFile('src/foo.ts')], '/repo')
    expect(result.uncovered).toEqual(['src/foo.ts'])
  })
})
