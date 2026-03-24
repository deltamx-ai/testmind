import { basename } from 'node:path'
import type { ChangedFile, CoverageItem, TestCoverage } from '../types.js'
import { execLines } from '../utils.js'

function toSearchVariants(stem: string): string[] {
  const variants = [stem.toLowerCase()]

  // camelCase → kebab-case
  const kebab = stem.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()
  if (kebab !== stem.toLowerCase()) variants.push(kebab)

  // kebab-case → camelCase
  const camel = stem.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
  if (camel !== stem) variants.push(camel.toLowerCase())

  return [...new Set(variants)]
}

function getFileStem(filePath: string): string {
  return basename(filePath).replace(/\.[^.]+$/, '')
}

export async function scanTestCoverage(
  changedFiles: ChangedFile[],
  cwd: string,
): Promise<TestCoverage> {
  const sourceFiles = changedFiles.filter(f => f.category === 'source')
  if (sourceFiles.length === 0) {
    return { covered: [], uncovered: [], relatedTests: [], coverageRatio: 0 }
  }

  // Get all test files in repo
  let testFiles: string[]
  try {
    testFiles = execLines(
      'git ls-files "*.test.*" "*.spec.*" "*/__tests__/*"',
      cwd,
    )
  } catch {
    testFiles = []
  }

  const testFilesLower = testFiles.map(f => f.toLowerCase())

  const covered: CoverageItem[] = []
  const uncovered: string[] = []
  const allRelatedTests = new Set<string>()

  for (const source of sourceFiles) {
    const stem = getFileStem(source.path)
    const variants = toSearchVariants(stem)
    const matchedTests: string[] = []

    for (let i = 0; i < testFiles.length; i++) {
      const testLower = testFilesLower[i]
      const testStem = getFileStem(testFiles[i]).replace(/\.(test|spec)$/, '').toLowerCase()

      for (const variant of variants) {
        if (testStem === variant || testLower.includes(variant)) {
          matchedTests.push(testFiles[i])
          allRelatedTests.add(testFiles[i])
          break
        }
      }
    }

    if (matchedTests.length > 0) {
      covered.push({ sourcePath: source.path, testPaths: matchedTests })
    } else {
      uncovered.push(source.path)
    }
  }

  const total = sourceFiles.length
  const coverageRatio = total > 0 ? covered.length / total : 0

  return {
    covered,
    uncovered,
    relatedTests: [...allRelatedTests],
    coverageRatio,
  }
}
