import type { ChangedFile, FixCommit, HistoryAnalysis, Hotspot } from '../types.js'
import { exec, execLines } from '../utils.js'

const FIX_KEYWORDS = /\b(fix|bug|hotfix|patch|resolve|revert|regression|crash|broken|issue)\b/i

export async function analyzeHistory(
  changedFiles: ChangedFile[],
  cwd: string,
  historyDays: number = 90,
): Promise<HistoryAnalysis> {
  const sourceFiles = changedFiles.filter(f => f.category === 'source' || f.category === 'config')
  const hotspots: Hotspot[] = []
  const fixCommitMap = new Map<string, FixCommit>()

  for (const file of sourceFiles) {
    if (file.status === 'added') continue // new files have no history

    try {
      // Count commits touching this file in the last N days
      const logLines = execLines(
        `git log --since="${historyDays} days ago" --format="%H|%s|%ai" -- "${file.path}"`,
        cwd,
      )

      const commitCount = logLines.length
      let fixCount = 0

      for (const line of logLines) {
        const [hash, message, date] = line.split('|')
        if (FIX_KEYWORDS.test(message)) {
          fixCount++
          if (!fixCommitMap.has(hash)) {
            fixCommitMap.set(hash, { hash, message, date, files: [file.path] })
          } else {
            fixCommitMap.get(hash)!.files.push(file.path)
          }
        }
      }

      let riskLevel: Hotspot['riskLevel'] = 'low'
      if (commitCount > 10 || fixCount > 3) riskLevel = 'high'
      else if (commitCount > 5 || fixCount > 1) riskLevel = 'medium'

      hotspots.push({ path: file.path, commitCount, fixCount, riskLevel })
    } catch {
      // git log failed for this file, skip
    }
  }

  // Sort by risk: high > medium > low, then by fixCount desc
  const riskOrder = { high: 0, medium: 1, low: 2 }
  hotspots.sort((a, b) => riskOrder[a.riskLevel] - riskOrder[b.riskLevel] || b.fixCount - a.fixCount)

  // Only keep fix commits that overlap with changed files
  const recentFixCommits = [...fixCommitMap.values()]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 10)

  return { hotspots, recentFixCommits }
}
