/**
 * prompt/slots.ts
 *
 * Runtime dynamic Slot builder functions.
 *
 * Each function takes raw data and returns compressed, prompt-friendly text.
 * Compression principles:
 *   1. Remove formatting meaningless to the LLM (excessive blank lines, nested markdown)
 *   2. Truncate overly long content (prevent context window exhaustion)
 *   3. High information density: every line should carry meaning
 */

import type { JiraTicket, JiraReport, CodeReport } from '../types/index.js'
import { diffToPromptText } from '../git/analyzer.js'
import type { GitDiffResult } from '../types/index.js'
import type { StaticAnalysisResult } from '../stages/stage2-code.js'
import { slot } from './builder.js'
import type { PromptSlot } from './types.js'

// ─── Jira-related slots ──────────────────────────────────────────────────────

/**
 * Compress JiraTicket raw data into LLM-friendly text.
 *
 * Information priority:
 *   summary > acceptanceCriteria > description > comments > metadata
 */
export function jiraTicketSlot(ticket: JiraTicket, maxDescChars = 3000): PromptSlot {
  const lines: string[] = []

  lines.push(`Ticket: ${ticket.key} [${ticket.type}] Priority: ${ticket.priority}`)
  lines.push(`Summary: ${ticket.summary}`)
  lines.push('')

  // AC has highest priority — put it first if available
  if (ticket.acceptanceCriteria?.trim()) {
    lines.push('=== Acceptance Criteria (explicitly written in ticket) ===')
    lines.push(ticket.acceptanceCriteria.trim())
    lines.push('')
  }

  // Description — truncate overly long content
  const desc = ticket.description?.trim() ?? ''
  if (desc) {
    lines.push('=== Description ===')
    lines.push(desc.length > maxDescChars ? desc.slice(0, maxDescChars) + '\n…[truncated]' : desc)
    lines.push('')
  }

  // Comments — sorted by time, keep most recent (LLM prioritizes later content)
  if (ticket.comments.length > 0) {
    lines.push('=== Comments (may contain requirement updates) ===')
    // Only keep the most recent 6 comments to avoid filling context
    const recent = ticket.comments.slice(-6)
    for (const c of recent) {
      lines.push(`[${c.author} @ ${c.createdAt.slice(0, 10)}]: ${c.body.trim()}`)
    }
    lines.push('')
  }

  // Metadata
  const meta: string[] = []
  if (ticket.labels.length > 0)       meta.push(`Labels: ${ticket.labels.join(', ')}`)
  if (ticket.subtasks.length > 0)     meta.push(`Subtasks: ${ticket.subtasks.join(', ')}`)
  if (ticket.linkedIssues.length > 0) meta.push(`Linked: ${ticket.linkedIssues.join(', ')}`)
  if (meta.length > 0) lines.push(meta.join(' | '))

  return slot('Jira Ticket', lines.join('\n'))
}

/**
 * Stage 3: inject JiraReport (already structured) for LLM gap analysis.
 * At this point the LLM doesn't need to parse raw Jira text — it works
 * directly against the requirements list.
 */
export function jiraReportSlot(report: JiraReport): PromptSlot {
  const lines: string[] = []

  lines.push(`Ticket: ${report.ticketKey}`)
  lines.push(`Summary: ${report.summary}`)
  lines.push('')

  if (!report.hasExplicitAC) {
    lines.push('⚠️  NOTE: No explicit AC in ticket — requirements below are INFERRED by AI.')
    lines.push('')
  }

  lines.push('=== Requirements ===')
  for (const r of report.requirements) {
    const inferred = r.source === 'inferred' ? ' [inferred]' : ''
    lines.push(`[${r.id}] (${r.priority}) ${r.description}${inferred}`)
  }
  lines.push('')

  lines.push('=== Acceptance Criteria ===')
  for (const ac of report.acceptanceCriteria) {
    const inferred = ac.source === 'inferred' ? ' [inferred]' : ''
    lines.push(`[${ac.id}] ${ac.description}${inferred}`)
  }
  lines.push('')

  if (report.outOfScope.length > 0) {
    lines.push('=== Out of Scope ===')
    report.outOfScope.forEach(o => lines.push(`- ${o}`))
    lines.push('')
  }

  if (report.riskFlags.length > 0) {
    lines.push('=== Risk Flags ===')
    report.riskFlags.forEach(r => lines.push(`- ${r}`))
    lines.push('')
  }

  if (report.ambiguities.length > 0) {
    lines.push('=== Ambiguities ===')
    report.ambiguities.forEach(a => lines.push(`- ${a}`))
  }

  return slot('Jira Specification', lines.join('\n'))
}

// ─── Git diff related slots ──────────────────────────────────────────────────

/**
 * Compress GitDiffResult into LLM-friendly text.
 * Uses diffToPromptText to truncate large diffs, keeping only source file hunks.
 */
export function gitDiffSlot(diff: GitDiffResult, maxSourceLines = 1200): PromptSlot {
  const text = diffToPromptText(diff, maxSourceLines)
  return slot('Git Diff', text)
}

/**
 * Inject static analysis results into Stage 2 prompt.
 * Provides pre-computed test coverage gaps so the LLM doesn't have to guess.
 */
export function staticAnalysisSlot(analysis: StaticAnalysisResult): PromptSlot {
  const lines: string[] = []

  lines.push(`Source files changed (${analysis.sourceFiles.length}):`)
  lines.push(analysis.sourceFiles.join(', ') || '  (none)')
  lines.push('')

  lines.push(`Test files changed (${analysis.testFiles.length}):`)
  lines.push(analysis.testFiles.join(', ') || '  (none)')
  lines.push('')

  lines.push(`Source files with NO test changes (coverage gap):`)
  lines.push(analysis.untestedSourceFiles.join(', ') || '  (all covered)')
  lines.push('')

  if (analysis.migrationFiles.length > 0) {
    lines.push(`DB migrations: ${analysis.migrationFiles.join(', ')}`)
  }

  if (analysis.apiSchemaFiles.length > 0) {
    lines.push(`API schema changes: ${analysis.apiSchemaFiles.join(', ')}`)
  }

  if (analysis.codeSmellHints.length > 0) {
    lines.push('')
    lines.push('Pre-detected code smells (static regex scan):')
    analysis.codeSmellHints.forEach(h => lines.push(`  - ${h}`))
  }

  if (analysis.criticalPathFiles && analysis.criticalPathFiles.length > 0) {
    lines.push('')
    lines.push('Critical path files modified (high-risk):')
    analysis.criticalPathFiles.forEach(f => lines.push(`  - ${f}`))
  }

  return slot('Static Analysis Findings', lines.join('\n'))
}

// ─── Stage 3: CodeReport slot ────────────────────────────────────────────────

/**
 * Inject CodeReport (already structured) into Stage 3 LLM prompt.
 */
export function codeReportSlot(report: CodeReport): PromptSlot {
  const lines: string[] = []

  lines.push('=== Implemented Features ===')
  if (report.implementedFeatures.length === 0) {
    lines.push('(none identified)')
  } else {
    report.implementedFeatures.forEach(f => lines.push(`- ${f}`))
  }
  lines.push('')

  lines.push('=== Modified Behaviors ===')
  if (report.modifiedBehaviors.length === 0) {
    lines.push('(none)')
  } else {
    report.modifiedBehaviors.forEach(b => lines.push(`- ${b}`))
  }
  lines.push('')

  lines.push('=== Deleted Behaviors ===')
  if (report.deletedBehaviors.length === 0) {
    lines.push('(none)')
  } else {
    report.deletedBehaviors.forEach(b => lines.push(`- ${b}`))
  }
  lines.push('')

  lines.push('=== Side Effects ===')
  if (report.sideEffects.length === 0) {
    lines.push('(none identified)')
  } else {
    report.sideEffects.forEach(s => lines.push(`- ${s}`))
  }
  lines.push('')

  lines.push('=== Test Coverage ===')
  lines.push('Covered:')
  if (report.testCoverage.covered.length === 0) {
    lines.push('  (none)')
  } else {
    report.testCoverage.covered.forEach(c => lines.push(`  - ${c}`))
  }
  lines.push('NOT covered:')
  if (report.testCoverage.uncovered.length === 0) {
    lines.push('  (all changes appear tested)')
  } else {
    report.testCoverage.uncovered.forEach(u => lines.push(`  - ${u}`))
  }

  return slot('Code Implementation Summary', lines.join('\n'))
}

// ─── Optional context slots ──────────────────────────────────────────────────

/**
 * Inject tech stack info (from .testmindrc.json techStack field).
 * Helps LLM give more precise suggestions (e.g. "validate with zod" instead of "validate somehow").
 */
export function techStackSlot(techStack?: string): PromptSlot {
  return slot('Tech Stack Context', techStack ?? '', true)
}

/**
 * Inject business rules (from .testmindrc.json businessRules field).
 * Stage 3 uses these — LLM treats them as an extra checklist to verify against.
 */
export function businessRulesSlot(rules?: string[]): PromptSlot {
  if (!rules || rules.length === 0) return slot('Business Rules', '', true)
  const text = [
    'Always verify the following project-level rules apply to this change:',
    ...rules.map(r => `- ${r}`),
  ].join('\n')
  return slot('Project Business Rules', text)
}
