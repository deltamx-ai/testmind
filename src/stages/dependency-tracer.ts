import { readFileSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import type { ChangedFile, DependencyAnalysis, ImpactedFile } from '../types.js'
import { execLines } from '../utils.js'

const ENTRY_PATTERNS = [
  /^(src\/)?pages\//,
  /^(src\/)?app\/.*\/page\./,
  /^(src\/)?app\/.*\/route\./,
  /^(src\/)?routes\//,
  /^(src\/)?api\//,
  /^(src\/)?server\/routes\//,
]

function getImportStem(filePath: string): string {
  const base = basename(filePath)
  // Remove extension and index
  return base.replace(/\.(ts|tsx|js|jsx|vue|svelte)$/, '').replace(/^index$/, basename(dirname(filePath)))
}

function buildImportPatterns(filePath: string): RegExp[] {
  // Build patterns that would match imports of this file
  const withoutExt = filePath.replace(/\.(ts|tsx|js|jsx|vue|svelte)$/, '')
  const stem = getImportStem(filePath)
  const patterns: RegExp[] = []

  // Match relative imports like: from './path/to/file' or from '../path/to/file'
  const escapedStem = stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  patterns.push(new RegExp(`from\\s+['"].*${escapedStem}['"]`))
  patterns.push(new RegExp(`require\\s*\\(\\s*['"].*${escapedStem}['"]\\s*\\)`))
  patterns.push(new RegExp(`import\\s*\\(\\s*['"].*${escapedStem}['"]\\s*\\)`))

  // Also match by directory path segments for less ambiguity
  const pathSegments = withoutExt.split('/').slice(-2).join('/')
  if (pathSegments.includes('/')) {
    const escapedPath = pathSegments.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    patterns.push(new RegExp(`from\\s+['"].*${escapedPath}['"]`))
  }

  return patterns
}

function isEntryPoint(filePath: string): boolean {
  return ENTRY_PATTERNS.some(p => p.test(filePath))
}

export async function traceDependencies(
  changedFiles: ChangedFile[],
  cwd: string,
  excludePatterns: string[] = [],
  maxImpactedFiles: number = 30,
): Promise<DependencyAnalysis> {
  const sourceFiles = changedFiles.filter(f => f.category === 'source')
  if (sourceFiles.length === 0) {
    return { impactedFiles: [], sharedModules: [], entryPoints: [] }
  }

  // Get all source files in the repo
  const extensions = '{ts,tsx,js,jsx,vue,svelte,py,go,java,kt}'
  let allFiles: string[]
  try {
    const excludeArgs = [
      '--not-path', '*/node_modules/*',
      '--not-path', '*/.next/*',
      '--not-path', '*/dist/*',
      '--not-path', '*/build/*',
      ...excludePatterns.flatMap(p => ['--not-path', `*/${p}`]),
    ]
    // Use git ls-files for speed
    allFiles = execLines(`git ls-files "*.ts" "*.tsx" "*.js" "*.jsx" "*.vue" "*.svelte"`, cwd)
  } catch {
    allFiles = []
  }

  const impactedMap = new Map<string, ImpactedFile>()
  const importCounts = new Map<string, number>()
  const entryPoints = new Set<string>()

  // For each changed source file, find who imports it
  for (const changed of sourceFiles) {
    const patterns = buildImportPatterns(changed.path)
    let importerCount = 0

    for (const candidate of allFiles) {
      // Skip the file itself
      if (candidate === changed.path) continue
      // Skip already-changed files
      if (changedFiles.some(f => f.path === candidate)) continue

      try {
        const content = readFileSync(join(cwd, candidate), 'utf-8')
        for (const pattern of patterns) {
          if (pattern.test(content)) {
            importerCount++
            if (!impactedMap.has(candidate)) {
              impactedMap.set(candidate, {
                path: candidate,
                reason: `imports from ${changed.path}`,
                depth: 1,
              })
            }
            // Check if this importer is an entry point
            if (isEntryPoint(candidate)) {
              entryPoints.add(candidate)
            }
            break
          }
        }
      } catch {
        // File read error, skip
      }
    }

    if (importerCount > 2) {
      importCounts.set(changed.path, importerCount)
    }
  }

  // Also check if changed files themselves are entry points
  for (const changed of sourceFiles) {
    if (isEntryPoint(changed.path)) {
      entryPoints.add(changed.path)
    }
  }

  // Sort shared modules by import count descending
  const sharedModules = [...importCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([path]) => path)

  return {
    impactedFiles: [...impactedMap.values()].slice(0, maxImpactedFiles),
    sharedModules,
    entryPoints: [...entryPoints],
  }
}
