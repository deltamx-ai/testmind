import { describe, it, expect, vi } from 'vitest'

// Mock fs and utils to avoid real filesystem/git access
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    readFileSync: vi.fn(),
  }
})

vi.mock('../utils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils.js')>()
  return {
    ...actual,
    gitLines: vi.fn(),
  }
})

import { traceDependencies } from './dependency-tracer.js'
import { readFileSync } from 'node:fs'
import { gitLines } from '../utils.js'
import type { ChangedFile } from '../types.js'

const mockedGitLines = vi.mocked(gitLines)
const mockedReadFileSync = vi.mocked(readFileSync)

function makeFile(path: string): ChangedFile {
  return {
    path,
    status: 'modified',
    additions: 5,
    deletions: 1,
    diff: '',
    language: 'typescript',
    category: 'source',
  }
}

describe('traceDependencies', () => {
  it('returns empty when no source files', async () => {
    const result = await traceDependencies([], '/repo')
    expect(result.impactedFiles).toEqual([])
    expect(result.sharedModules).toEqual([])
    expect(result.entryPoints).toEqual([])
  })

  it('finds files that import a changed file', async () => {
    mockedGitLines.mockReturnValue(['src/utils.ts', 'src/consumer.ts'])
    mockedReadFileSync.mockImplementation((path) => {
      if (String(path).includes('consumer.ts')) return 'import { foo } from "./utils"'
      return 'export const foo = 1'
    })

    const result = await traceDependencies([makeFile('src/utils.ts')], '/repo')
    expect(result.impactedFiles).toHaveLength(1)
    expect(result.impactedFiles[0].path).toBe('src/consumer.ts')
  })

  it('identifies entry points among changed files', async () => {
    mockedGitLines.mockReturnValue([])
    const entryFile = makeFile('src/pages/index.ts')
    const result = await traceDependencies([entryFile], '/repo')
    expect(result.entryPoints).toContain('src/pages/index.ts')
  })

  it('identifies entry points among impacted files', async () => {
    mockedGitLines.mockReturnValue(['src/pages/home.tsx'])
    mockedReadFileSync.mockReturnValue('import { util } from "../lib"')

    const result = await traceDependencies([makeFile('src/lib.ts')], '/repo')
    expect(result.entryPoints).toContain('src/pages/home.tsx')
  })

  it('marks shared modules with >2 importers', async () => {
    mockedGitLines.mockReturnValue(['src/a.ts', 'src/b.ts', 'src/c.ts'])
    mockedReadFileSync.mockReturnValue('import { x } from "./shared"')

    const result = await traceDependencies([makeFile('src/shared.ts')], '/repo')
    expect(result.sharedModules).toContain('src/shared.ts')
  })

  it('handles git ls-files failure', async () => {
    mockedGitLines.mockImplementation(() => { throw new Error('git error') })
    const result = await traceDependencies([makeFile('src/foo.ts')], '/repo')
    // Should still check entryPoints for changed files
    expect(result.impactedFiles).toEqual([])
  })

  it('caps impacted files at 30', async () => {
    const files = Array.from({ length: 40 }, (_, i) => `src/file${i}.ts`)
    mockedGitLines.mockReturnValue(files)
    mockedReadFileSync.mockReturnValue('import { x } from "./changed"')

    const result = await traceDependencies([makeFile('src/changed.ts')], '/repo')
    expect(result.impactedFiles.length).toBeLessThanOrEqual(30)
  })
})
