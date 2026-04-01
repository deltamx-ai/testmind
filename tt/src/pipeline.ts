/**
 * pipeline.ts
 *
 * Orchestrates the 4-stage TestMind pipeline:
 *
 *   Stage 1 → JiraReport        (structured requirements)
 *   Stage 2 → CodeReport        (structured implementation summary)
 *   Stage 3 → CrossCheckReport  (gap analysis)
 *   Stage 4 → FinalReports      (three markdown reports)
 *
 * Each stage is independent, so errors in one don't corrupt the others.
 */

import type { PipelineInput, JiraReport, CodeReport, CrossCheckReport, FinalReports } from './types/index.js'
import { analyzeGitDiff } from './git/analyzer.js'
import { runStage1 } from './stages/stage1-jira.js'
import { runStage2 } from './stages/stage2-code.js'
import { runStage3 } from './stages/stage3-crosscheck.js'
import { runStage4 } from './stages/stage4-report.js'
import { getUsage, resetUsage } from './llm/client.js'

export interface PipelineResult {
  jiraReport: JiraReport
  codeReport: CodeReport
  crossCheckReport: CrossCheckReport
  finalReports: FinalReports
  tokenUsage: { inputTokens: number; outputTokens: number; calls: number }
  durationMs: number
}

export type StageProgressCallback = (stage: number, name: string, status: 'start' | 'done' | 'error', detail?: string) => void

export async function runPipeline(
  input: PipelineInput,
  onProgress?: StageProgressCallback,
): Promise<PipelineResult> {
  const startTime = Date.now()
  resetUsage()

  const notify = (stage: number, name: string, status: 'start' | 'done' | 'error', detail?: string) => {
    onProgress?.(stage, name, status, detail)
  }

  // ─── Git diff ────────────────────────────────────────────────────────────
  notify(0, 'Git Diff', 'start')
  let diff
  try {
    diff = await analyzeGitDiff({
      repoPath: input.repoPath,
      baseBranch: input.baseBranch,
      headBranch: input.headBranch,
    })
    notify(0, 'Git Diff', 'done', `${diff.files.length} files changed, ${diff.commits.length} commits`)
  } catch (err) {
    notify(0, 'Git Diff', 'error', String(err))
    throw err
  }

  // ─── Stage 1: Jira analysis ───────────────────────────────────────────────
  notify(1, 'Jira Analysis', 'start')
  let jiraReport: JiraReport
  try {
    jiraReport = await runStage1(input.jiraTicket)
    notify(1, 'Jira Analysis', 'done', `${jiraReport.requirements.length} requirements, ${jiraReport.acceptanceCriteria.length} AC`)
  } catch (err) {
    notify(1, 'Jira Analysis', 'error', String(err))
    throw err
  }

  // ─── Stage 2: Code analysis ───────────────────────────────────────────────
  notify(2, 'Code Analysis', 'start')
  let codeReport: CodeReport
  try {
    codeReport = await runStage2(diff, input.config?.techStack)
    notify(2, 'Code Analysis', 'done', `${codeReport.implementedFeatures.length} features, ${codeReport.testCoverage.uncovered.length} gaps`)
  } catch (err) {
    notify(2, 'Code Analysis', 'error', String(err))
    throw err
  }

  // ─── Stage 3: Cross-check ─────────────────────────────────────────────────
  notify(3, 'Cross-check', 'start')
  let crossCheckReport: CrossCheckReport
  try {
    crossCheckReport = await runStage3(jiraReport, codeReport, input.config?.businessRules)
    const bugs = crossCheckReport.potentialBugs.length
    const missing = crossCheckReport.missingImplementations.length
    notify(3, 'Cross-check', 'done', `risk=${crossCheckReport.riskLevel}, ${bugs} bugs, ${missing} missing`)
  } catch (err) {
    notify(3, 'Cross-check', 'error', String(err))
    throw err
  }

  // ─── Stage 4: Report generation ───────────────────────────────────────────
  notify(4, 'Report Generation', 'start')
  const finalReports = runStage4(jiraReport, codeReport, crossCheckReport)
  notify(4, 'Report Generation', 'done', '3 reports generated')

  return {
    jiraReport,
    codeReport,
    crossCheckReport,
    finalReports,
    tokenUsage: getUsage(),
    durationMs: Date.now() - startTime,
  }
}
