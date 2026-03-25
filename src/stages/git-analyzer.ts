import type { ChangedFile, CommitInfo, FileCategory, GitAnalysis } from '../types.js'
import { getLanguageFromPath, git, gitLines, truncateDiff } from '../utils.js'

const DEFAULT_MAX_DIFF_LINES_PER_FILE = 200
const DEFAULT_MAX_TOTAL_DIFF_LINES = 3000

function categorizeFile(path: string): FileCategory {
  const lower = path.toLowerCase()

  if (/\.(test|spec)\.[^.]+$/.test(lower) || /__tests__\//.test(lower) || /\/test\//.test(lower))
    return 'test'
  if (/\.(config|rc)\.[^.]+$/.test(lower) || /\/\.[^/]*rc/.test(lower) || /tsconfig/.test(lower))
    return 'config'
  if (/\.(css|scss|less|sass|styl)$/.test(lower))
    return 'style'
  if (/migrations?\//.test(lower) || /\.migration\.[^.]+$/.test(lower))
    return 'migration'
  if (/openapi|swagger|\.graphql$/.test(lower))
    return 'api-schema'
  if (/^\.github\/|jenkinsfile|dockerfile|\.gitlab-ci|\.circleci/i.test(lower))
    return 'ci'
  if (/\.md$/.test(lower) || /\/docs\//.test(lower))
    return 'docs'
  if (/\.(ts|tsx|js|jsx|py|go|rs|java|kt|rb|php|cs|swift|vue|svelte)$/.test(lower))
    return 'source'
  return 'other'
}

function parseStatus(letter: string): ChangedFile['status'] {
  switch (letter) {
    case 'A': return 'added'
    case 'D': return 'deleted'
    case 'R': return 'renamed'
    default: return 'modified'
  }
}

export async function analyzeGit(
  cwd: string,
  baseBranch: string,
  headBranch: string,
  options?: { maxDiffLinesPerFile?: number; maxDiffLines?: number },
): Promise<GitAnalysis> {
  const MAX_DIFF_LINES_PER_FILE = options?.maxDiffLinesPerFile ?? DEFAULT_MAX_DIFF_LINES_PER_FILE
  const MAX_TOTAL_DIFF_LINES = options?.maxDiffLines ?? DEFAULT_MAX_TOTAL_DIFF_LINES
  // Get merge base for accurate diff
  let mergeBase: string
  try {
    mergeBase = git(['merge-base', baseBranch, headBranch], cwd)
  } catch {
    mergeBase = baseBranch
  }

  // Get changed files with stats
  const nameStatusLines = gitLines(['diff', '--name-status', `${mergeBase}...${headBranch}`], cwd)

  const numstatLines = gitLines(['diff', '--numstat', `${mergeBase}...${headBranch}`], cwd)

  // Build numstat map
  const numstatMap = new Map<string, { additions: number; deletions: number }>()
  for (const line of numstatLines) {
    const [add, del, ...pathParts] = line.split('\t')
    const filePath = pathParts.join('\t') // handle renames with =>
    numstatMap.set(filePath, {
      additions: add === '-' ? 0 : parseInt(add, 10),
      deletions: del === '-' ? 0 : parseInt(del, 10),
    })
  }

  // Build changed files
  const changedFiles: ChangedFile[] = []
  for (const line of nameStatusLines) {
    const parts = line.split('\t')
    const statusLetter = parts[0][0]
    const filePath = statusLetter === 'R' ? parts[2] : parts[1]
    if (!filePath) continue

    const stats = numstatMap.get(filePath) ??
      numstatMap.get(parts.slice(1).join('\t')) ??
      { additions: 0, deletions: 0 }

    let diff = ''
    try {
      diff = git(['diff', `${mergeBase}...${headBranch}`, '--', filePath], cwd)
      diff = truncateDiff(diff, MAX_DIFF_LINES_PER_FILE)
    } catch {
      diff = '(unable to retrieve diff)'
    }

    changedFiles.push({
      path: filePath,
      status: parseStatus(statusLetter),
      additions: stats.additions,
      deletions: stats.deletions,
      diff,
      language: getLanguageFromPath(filePath),
      category: categorizeFile(filePath),
    })
  }

  // Truncate total diff if needed
  let totalLines = 0
  for (const f of changedFiles) {
    const lineCount = f.diff.split('\n').length
    totalLines += lineCount
    if (totalLines > MAX_TOTAL_DIFF_LINES) {
      f.diff = truncateDiff(f.diff, Math.max(20, MAX_DIFF_LINES_PER_FILE - (totalLines - MAX_TOTAL_DIFF_LINES)))
    }
  }

  // Get commits
  const commitLines = gitLines(['log', '--format=%H|%s|%ai|%an', `${mergeBase}...${headBranch}`], cwd)
  const commits: CommitInfo[] = commitLines.map(line => {
    const [hash, message, date, author] = line.split('|')
    return { hash, message, date, author }
  })

  // Aggregate stats
  const stats = changedFiles.reduce(
    (acc, f) => ({
      additions: acc.additions + f.additions,
      deletions: acc.deletions + f.deletions,
      filesChanged: acc.filesChanged + 1,
    }),
    { additions: 0, deletions: 0, filesChanged: 0 },
  )

  return { baseBranch, headBranch, changedFiles, stats, commits }
}
