/**
 * git/analyzer.ts
 *
 * Real git diff implementation.
 * Uses parameterised child_process.spawn (never shell: true) to avoid
 * shell injection vulnerabilities.
 */

import { spawnSync } from 'node:child_process'
import * as path from 'node:path'
import type {
  GitDiffResult,
  FileDiff,
  FileCategory,
  ChangeKind,
  Hunk,
  HunkLine,
  CommitInfo,
} from '../types/index.js'

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * Run a git command in `cwd` using spawn (no shell).
 * Returns stdout as a string, throws on non-zero exit.
 */
function git(args: string[], cwd: string): string {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024, // 50 MB — large monorepos
  })

  if (result.error) {
    throw new Error(`git spawn error: ${result.error.message}`)
  }
  if (result.status !== 0) {
    const stderr = result.stderr?.trim() ?? ''
    const cmd = `git ${args.join(' ')}`
    if (stderr.includes('not a git repository')) {
      throw new Error(`Not a git repository. Run this command inside a git repo.\n  Command: ${cmd}`)
    }
    if (stderr.includes('unknown revision') || stderr.includes('bad revision')) {
      throw new Error(`Git ref not found. Check that the branch/commit exists.\n  Command: ${cmd}\n  Error: ${stderr}`)
    }
    throw new Error(`git command failed (exit ${result.status}):\n  Command: ${cmd}\n  Error: ${stderr}`)
  }
  return result.stdout ?? ''
}

// ─── file classification ─────────────────────────────────────────────────────

const CATEGORY_RULES: Array<{ pattern: RegExp; category: FileCategory }> = [
  { pattern: /\.(test|spec)\.(ts|tsx|js|jsx|py|go|rb|java)$/i, category: 'test' },
  { pattern: /\/__tests__\//,                                    category: 'test' },
  { pattern: /\/test\//,                                         category: 'test' },
  { pattern: /migrations?\//,                                    category: 'migration' },
  { pattern: /\.(sql)$/i,                                        category: 'migration' },
  { pattern: /\.(json|yaml|yml|toml|env|ini|conf)$/i,            category: 'config' },
  { pattern: /openapi|swagger/i,                                 category: 'api-schema' },
  { pattern: /\.(graphql|gql)$/i,                                category: 'api-schema' },
  { pattern: /\.(md|mdx|txt|rst)$/i,                            category: 'docs' },
  { pattern: /\.(ts|tsx|js|jsx|py|go|rb|java|rs|c|cpp|cs)$/i,  category: 'source' },
]

function classifyFile(filePath: string): FileCategory {
  const normalized = filePath.replace(/\\/g, '/')
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(normalized)) return rule.category
  }
  return 'other'
}

// ─── diff parser ─────────────────────────────────────────────────────────────

interface RawFileDiff {
  oldPath: string
  newPath: string
  changeKind: ChangeKind
  isBinary: boolean
  rawHunks: string
}

/**
 * Parse `git diff --raw` output to get file-level metadata.
 * Format: :<old-mode> <new-mode> <old-sha> <new-sha> <status>[score]\t<path>[\t<new-path>]
 */
function parseRawDiff(rawOutput: string): Map<string, RawFileDiff> {
  const map = new Map<string, RawFileDiff>()
  for (const line of rawOutput.trim().split('\n')) {
    if (!line.startsWith(':')) continue
    const [meta, ...paths] = line.split('\t')
    const statusCode = meta.split(' ')[4]?.[0] ?? 'M'
    const kind: ChangeKind =
      statusCode === 'A' ? 'added'
      : statusCode === 'D' ? 'deleted'
      : statusCode === 'R' ? 'renamed'
      : 'modified'
    const oldPath = paths[0] ?? ''
    const newPath = paths[1] ?? oldPath
    map.set(newPath, { oldPath, newPath, changeKind: kind, isBinary: false, rawHunks: '' })
  }
  return map
}

/**
 * Parse unified diff text (output of `git diff`) for a single file into Hunks.
 */
function parseHunks(diffText: string): Hunk[] {
  const hunks: Hunk[] = []
  let current: Hunk | null = null
  let newLineNum = 0
  let oldLineNum = 0

  for (const line of diffText.split('\n')) {
    const hunkHeader = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
    if (hunkHeader) {
      if (current) hunks.push(current)
      const oldStart = parseInt(hunkHeader[1], 10)
      const oldCount = parseInt(hunkHeader[2] ?? '1', 10)
      const newStart = parseInt(hunkHeader[3], 10)
      const newCount = parseInt(hunkHeader[4] ?? '1', 10)
      current = {
        oldStart,
        oldCount,
        newStart,
        newCount,
        lines: [],
      }
      newLineNum = newStart
      oldLineNum = oldStart
      continue
    }

    if (!current) continue

    if (line.startsWith('+') && !line.startsWith('+++')) {
      current.lines.push({ type: '+', content: line.slice(1), lineNumber: newLineNum++ })
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      current.lines.push({ type: '-', content: line.slice(1), lineNumber: oldLineNum++ })
    } else if (line.startsWith(' ')) {
      current.lines.push({ type: ' ', content: line.slice(1), lineNumber: newLineNum++ })
      oldLineNum++
    }
  }
  if (current) hunks.push(current)
  return hunks
}

/**
 * Split a unified diff by file (separated by `diff --git` headers).
 */
function splitByFile(diffOutput: string): Map<string, string> {
  const result = new Map<string, string>()
  const sections = diffOutput.split(/^diff --git /m).slice(1)

  for (const section of sections) {
    // First line: "a/<path> b/<path>"
    const firstNewline = section.indexOf('\n')
    const header = section.slice(0, firstNewline)
    const match = header.match(/^a\/.+ b\/(.+)$/)
    const filePath = match?.[1] ?? header.split(' ').pop() ?? ''
    result.set(filePath, section)
  }
  return result
}

// ─── commit log parser ───────────────────────────────────────────────────────

function parseCommits(logOutput: string): CommitInfo[] {
  if (!logOutput.trim()) return []
  return logOutput
    .trim()
    .split('\n')
    .map((line) => {
      const [hash, shortHash, date, author, ...msgParts] = line.split('\x1f')
      return {
        hash: hash ?? '',
        shortHash: shortHash ?? '',
        date: date ?? '',
        author: author ?? '',
        message: msgParts.join('\x1f').trim(),
      }
    })
    .filter((c) => c.hash)
}

// ─── public API ──────────────────────────────────────────────────────────────

export interface GitAnalyzerOptions {
  /** Absolute path to the repository root */
  repoPath: string
  /** The base branch/ref (e.g. "main", "origin/main") */
  baseBranch: string
  /** The head branch/ref (defaults to HEAD) */
  headBranch?: string
  /** Max diff lines per file before truncating (default 2000) */
  maxLinesPerFile?: number
}

export async function analyzeGitDiff(opts: GitAnalyzerOptions): Promise<GitDiffResult> {
  const { repoPath, baseBranch, headBranch = 'HEAD', maxLinesPerFile = 2000 } = opts
  const absRepo = path.resolve(repoPath)

  // 1. Validate repo
  git(['rev-parse', '--git-dir'], absRepo)

  // 2. Resolve refs to SHA (validates they exist)
  const baseSha = git(['rev-parse', baseBranch], absRepo).trim()
  const headSha = git(['rev-parse', headBranch], absRepo).trim()

  if (baseSha === headSha) {
    console.warn(`[TestMind] Warning: base (${baseBranch}) and head (${headBranch}) resolve to the same commit (${baseSha.slice(0, 8)}). Diff will be empty.`)
    return {
      baseBranch,
      headBranch,
      commits: [],
      files: [],
      totalAdditions: 0,
      totalDeletions: 0,
      truncated: false,
    }
  }

  // 3. Commit log between base and head
  const logFormat = '%H\x1f%h\x1f%ai\x1f%an\x1f%s'
  const logOutput = git(
    ['log', `${baseSha}..${headSha}`, `--format=${logFormat}`],
    absRepo,
  )
  const commits = parseCommits(logOutput)

  // 4. Raw diff metadata (file statuses)
  const rawOutput = git(['diff', '--raw', baseSha, headSha], absRepo)
  const rawMap = parseRawDiff(rawOutput)

  // 5. Numstat for line counts
  const numstatOutput = git(['diff', '--numstat', baseSha, headSha], absRepo)
  const numstatMap = new Map<string, { additions: number; deletions: number }>()
  for (const line of numstatOutput.trim().split('\n')) {
    if (!line) continue
    const parts = line.split('\t')
    const additions = parts[0] === '-' ? 0 : parseInt(parts[0] ?? '0', 10)
    const deletions = parts[1] === '-' ? 0 : parseInt(parts[1] ?? '0', 10)
    const filePath = parts[2] ?? ''
    numstatMap.set(filePath, { additions, deletions })
  }

  // 6. Full unified diff
  const unifiedDiff = git(
    [
      'diff',
      '--unified=3',
      '--no-color',
      `--diff-filter=ACDMRT`, // skip untracked
      baseSha,
      headSha,
    ],
    absRepo,
  )
  const diffByFile = splitByFile(unifiedDiff)

  // 7. Detect binary files
  const binaryOutput = git(
    ['diff', '--numstat', '--diff-filter=ACDMRT', baseSha, headSha],
    absRepo,
  )
  const binaryFiles = new Set<string>()
  for (const line of binaryOutput.trim().split('\n')) {
    if (line.startsWith('-\t-\t')) {
      binaryFiles.add(line.split('\t')[2] ?? '')
    }
  }

  // 8. Build FileDiff objects
  let totalAdditions = 0
  let totalDeletions = 0
  let truncated = false

  const files: FileDiff[] = []

  for (const [filePath, rawInfo] of rawMap) {
    const isBinary = binaryFiles.has(filePath)
    const stats = numstatMap.get(filePath) ?? { additions: 0, deletions: 0 }
    totalAdditions += stats.additions
    totalDeletions += stats.deletions

    let hunks: Hunk[] = []
    if (!isBinary) {
      const fileDiffText = diffByFile.get(filePath) ?? ''
      const allHunks = parseHunks(fileDiffText)
      // Truncate extremely large diffs to avoid filling LLM context
      let lineCount = 0
      for (const hunk of allHunks) {
        if (lineCount >= maxLinesPerFile) {
          truncated = true
          break
        }
        lineCount += hunk.lines.length
        hunks.push(hunk)
      }
    }

    files.push({
      path: filePath,
      oldPath: rawInfo.oldPath !== filePath ? rawInfo.oldPath : undefined,
      category: classifyFile(filePath),
      changeKind: rawInfo.changeKind,
      additions: stats.additions,
      deletions: stats.deletions,
      hunks,
      isBinary,
    })
  }

  return {
    baseBranch,
    headBranch,
    commits,
    files,
    totalAdditions,
    totalDeletions,
    truncated,
  }
}

// ─── diff summary for LLM context ────────────────────────────────────────────

/**
 * Convert a GitDiffResult to a compact text representation that can be
 * included in an LLM prompt without blowing up the context window.
 *
 * Strategy:
 *  - Full hunks for source files up to MAX_SOURCE_LINES
 *  - Only file names + line counts for test/config/docs files
 *  - Binary files: just noted as binary
 */
export function diffToPromptText(diff: GitDiffResult, maxSourceLines = 1500): string {
  const lines: string[] = []

  lines.push(`## Git Diff Summary`)
  lines.push(`Base: ${diff.baseBranch}  →  Head: ${diff.headBranch}`)
  lines.push(`Commits: ${diff.commits.length} | Files changed: ${diff.files.length}`)
  lines.push(`+${diff.totalAdditions} / -${diff.totalDeletions} lines`)
  if (diff.truncated) {
    lines.push(`⚠️ NOTE: Some file diffs were truncated due to size limits. Analysis may be incomplete.`)
  }
  lines.push('')

  if (diff.commits.length > 0) {
    lines.push('### Commit Messages')
    for (const c of diff.commits) {
      lines.push(`- [${c.shortHash}] ${c.message}  (${c.author}, ${c.date})`)
    }
    lines.push('')
  }

  let sourceLinesUsed = 0

  for (const file of diff.files) {
    const header = `### ${file.changeKind.toUpperCase()} ${file.path} [${file.category}] +${file.additions}/-${file.deletions}`

    if (file.isBinary) {
      lines.push(`${header} [binary]`)
      continue
    }

    // Non-source files: just the header (save context)
    if (file.category !== 'source' && file.category !== 'api-schema') {
      lines.push(header)
      continue
    }

    if (sourceLinesUsed >= maxSourceLines) {
      lines.push(`${header} [diff omitted — context limit reached]`)
      continue
    }

    lines.push(header)
    lines.push('```diff')
    for (const hunk of file.hunks) {
      lines.push(`@@ -${hunk.oldStart} +${hunk.newStart},${hunk.newCount} @@`)
      for (const l of hunk.lines) {
        lines.push(`${l.type}${l.content}`)
        if (l.type !== ' ') sourceLinesUsed++
        if (sourceLinesUsed >= maxSourceLines) {
          lines.push(`... [truncated at ${maxSourceLines} source lines]`)
          break
        }
      }
      if (sourceLinesUsed >= maxSourceLines) break
    }
    lines.push('```')
    lines.push('')
  }

  return lines.join('\n')
}
