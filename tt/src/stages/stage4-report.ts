/**
 * stages/stage4-report.ts
 *
 * Stage 4: Report Generation
 *
 * Pure TypeScript (no LLM call needed — we already have structured data).
 * Produces three markdown documents:
 *
 *   Report A — Requirement Completeness  (developer self-review)
 *   Report B — Bug Risk List             (review before testing)
 *   Report C — Self-test Checklist       (paste into PR description)
 */

import type {
  JiraReport,
  CodeReport,
  CrossCheckReport,
  FinalReports,
  RequirementCheck,
  PotentialBug,
  BugSeverity,
} from '../types/index.js'

// ─── helpers ──────────────────────────────────────────────────────────────────

const STATUS_ICON: Record<RequirementCheck['status'], string> = {
  implemented: '✅',
  partial:     '⚠️',
  missing:     '❌',
  unclear:     '❓',
}

const SEVERITY_ICON: Record<BugSeverity, string> = {
  critical: '🔴',
  high:     '🟠',
  medium:   '🟡',
  low:      '🟢',
}

const RISK_ICON: Record<string, string> = {
  high:   '🔴 HIGH',
  medium: '🟡 MEDIUM',
  low:    '🟢 LOW',
}

function header(level: number, text: string): string {
  return `${'#'.repeat(level)} ${text}`
}

function divider(): string {
  return '\n---\n'
}

function timestamp(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
}

// ─── Report A: Requirement Completeness ──────────────────────────────────────

function buildReportA(
  jira: JiraReport,
  crossCheck: CrossCheckReport,
): string {
  const lines: string[] = []

  lines.push(header(1, `📋 Report A: Requirement Completeness — ${jira.ticketKey}`))
  lines.push(`_Generated: ${timestamp()}_`)
  lines.push('')

  // Overall stats
  const total = crossCheck.requirementCoverage.length
  const implemented = crossCheck.requirementCoverage.filter((r) => r.status === 'implemented').length
  const partial = crossCheck.requirementCoverage.filter((r) => r.status === 'partial').length
  const missing = crossCheck.requirementCoverage.filter((r) => r.status === 'missing').length
  const unclear = crossCheck.requirementCoverage.filter((r) => r.status === 'unclear').length

  lines.push(header(2, 'Summary'))
  lines.push(`| Status | Count |`)
  lines.push(`|--------|-------|`)
  lines.push(`| ✅ Implemented | ${implemented} |`)
  lines.push(`| ⚠️ Partial | ${partial} |`)
  lines.push(`| ❌ Missing | ${missing} |`)
  lines.push(`| ❓ Unclear | ${unclear} |`)
  lines.push(`| **Total** | **${total}** |`)
  lines.push('')
  lines.push(`**Overall risk:** ${RISK_ICON[crossCheck.riskLevel]}`)
  lines.push('')

  if (!jira.hasExplicitAC) {
    lines.push('> ⚠️ **Note:** This ticket had no explicit Acceptance Criteria.')
    lines.push('> The requirements below were **inferred** by AI from the description and comments.')
    lines.push('> Please verify them with your PM / ticket author before using this report.')
    lines.push('')
  }

  // Per-requirement breakdown
  lines.push(header(2, 'Requirement Coverage'))
  lines.push('')

  for (const req of crossCheck.requirementCoverage) {
    const icon = STATUS_ICON[req.status]
    lines.push(`### ${icon} ${req.requirementId}: ${req.requirementDescription}`)
    lines.push(`**Status:** ${req.status.toUpperCase()}`)
    if (req.evidence) lines.push(`**Evidence:** ${req.evidence}`)
    if (req.concern)  lines.push(`**Concern:** ${req.concern}`)
    lines.push('')
  }

  // Missing implementations
  if (crossCheck.missingImplementations.length > 0) {
    lines.push(divider())
    lines.push(header(2, '❌ Missing Implementations'))
    lines.push('These requirements are in the Jira ticket but appear to have no corresponding code:')
    lines.push('')
    crossCheck.missingImplementations.forEach((m) => lines.push(`- ${m}`))
    lines.push('')
  }

  // Unexpected changes
  if (crossCheck.unexpectedChanges.length > 0) {
    lines.push(divider())
    lines.push(header(2, '⚠️ Unexpected Changes (Scope Creep / Accidental Changes)'))
    lines.push('These code changes are NOT justified by the Jira ticket:')
    lines.push('')
    crossCheck.unexpectedChanges.forEach((u) => lines.push(`- ${u}`))
    lines.push('')
  }

  // Risk flags from Jira
  if (jira.riskFlags.length > 0) {
    lines.push(divider())
    lines.push(header(2, '🚩 Risk Flags (from Jira)'))
    jira.riskFlags.forEach((r) => lines.push(`- ${r}`))
    lines.push('')
  }

  // Ambiguities
  if (jira.ambiguities.length > 0) {
    lines.push(divider())
    lines.push(header(2, '❓ Ambiguities'))
    lines.push('These aspects of the ticket may be interpreted differently by different people:')
    lines.push('')
    jira.ambiguities.forEach((a) => lines.push(`- ${a}`))
    lines.push('')
  }

  // Out of scope
  if (jira.outOfScope.length > 0) {
    lines.push(divider())
    lines.push(header(2, 'Out of Scope'))
    jira.outOfScope.forEach((o) => lines.push(`- ${o}`))
    lines.push('')
  }

  return lines.join('\n')
}

// ─── Report B: Bug Risk List ──────────────────────────────────────────────────

function buildReportB(
  jira: JiraReport,
  code: CodeReport,
  crossCheck: CrossCheckReport,
  businessRules?: string[],
): string {
  const lines: string[] = []

  lines.push(header(1, `🐛 Report B: Bug Risk List — ${jira.ticketKey}`))
  lines.push(`_Generated: ${timestamp()}_`)
  lines.push(`_Review this BEFORE testing — fix critical/high items before handoff to QA_`)
  lines.push('')

  // Overall risk
  lines.push(`**Overall risk:** ${RISK_ICON[crossCheck.riskLevel]}`)
  lines.push('')

  if (crossCheck.potentialBugs.length === 0) {
    lines.push('✅ No significant potential bugs identified. Good to go!')
    lines.push('')
  } else {
    // Sort by severity
    const severityOrder: BugSeverity[] = ['critical', 'high', 'medium', 'low']
    const sorted = [...crossCheck.potentialBugs].sort(
      (a, b) => severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity),
    )

    // Stats table
    const counts = severityOrder.reduce<Record<string, number>>((acc, s) => {
      acc[s] = sorted.filter((b) => b.severity === s).length
      return acc
    }, {})

    lines.push(header(2, 'Bug Summary'))
    lines.push(`| Severity | Count |`)
    lines.push(`|----------|-------|`)
    severityOrder.forEach((s) => {
      if (counts[s] > 0) lines.push(`| ${SEVERITY_ICON[s]} ${s.toUpperCase()} | ${counts[s]} |`)
    })
    lines.push('')

    // Bug details
    lines.push(header(2, 'Bug Details'))
    lines.push('')

    for (const bug of sorted) {
      lines.push(`### ${SEVERITY_ICON[bug.severity]} ${bug.id} — ${bug.description}`)
      lines.push(`**Severity:** ${bug.severity.toUpperCase()}`)
      if (bug.location.length > 0) {
        lines.push(`**Location:** ${bug.location.join(', ')}`)
      }
      lines.push(`**Trigger condition:** ${bug.triggerCondition}`)
      lines.push(`**Suggestion:** ${bug.suggestion}`)
      lines.push('')
    }
  }

  // Code smells
  if (code.codeSmells.length > 0) {
    lines.push(divider())
    lines.push(header(2, '🔍 Code Smells'))
    lines.push('These are code quality issues unrelated to requirements:')
    lines.push('')
    code.codeSmells.forEach((s) => lines.push(`- ${s}`))
    lines.push('')
  }

  // Test coverage gaps
  if (code.testCoverage.uncovered.length > 0) {
    lines.push(divider())
    lines.push(header(2, '🧪 Test Coverage Gaps'))
    lines.push('These changes have no corresponding test modifications:')
    lines.push('')
    code.testCoverage.uncovered.forEach((u) => lines.push(`- ${u}`))
    lines.push('')
  }

  // Business rules reminder
  if (businessRules && businessRules.length > 0) {
    lines.push(divider())
    lines.push(header(2, '📏 Business Rules to Verify'))
    lines.push('These project-level rules should be checked against this change:')
    lines.push('')
    businessRules.forEach((r) => lines.push(`- [ ] ${r}`))
    lines.push('')
  }

  // Critical path files
  if (code.criticalPathFiles && code.criticalPathFiles.length > 0) {
    lines.push(divider())
    lines.push(header(2, '🔥 Critical Path Files Modified'))
    lines.push('These high-risk files were changed and require extra review:')
    lines.push('')
    code.criticalPathFiles.forEach((f) => lines.push(`- ${f}`))
    lines.push('')
  }

  // Side effects
  if (code.sideEffects.length > 0) {
    lines.push(divider())
    lines.push(header(2, '💥 Potential Side Effects'))
    lines.push('These modules may be indirectly affected:')
    lines.push('')
    code.sideEffects.forEach((s) => lines.push(`- ${s}`))
    lines.push('')
  }

  return lines.join('\n')
}

// ─── Report C: Self-test Checklist ───────────────────────────────────────────

function buildReportC(
  jira: JiraReport,
  crossCheck: CrossCheckReport,
): string {
  const lines: string[] = []

  lines.push(header(1, `✅ Self-test Checklist — ${jira.ticketKey}`))
  lines.push(`_${jira.summary}_`)
  lines.push(`_Generated: ${timestamp()}_`)
  lines.push('')
  lines.push('Copy this checklist into your PR description. Check each item before requesting review.')
  lines.push('')

  // Critical bugs first
  const criticalBugs = crossCheck.potentialBugs.filter((b) => b.severity === 'critical')
  if (criticalBugs.length > 0) {
    lines.push(header(2, '🔴 Critical — Must fix before merging'))
    for (const bug of criticalBugs) {
      lines.push(`- [ ] **[${bug.id}]** ${bug.description}`)
      lines.push(`  - _Verify: ${bug.suggestion}_`)
    }
    lines.push('')
  }

  // High bugs
  const highBugs = crossCheck.potentialBugs.filter((b) => b.severity === 'high')
  if (highBugs.length > 0) {
    lines.push(header(2, '🟠 High — Fix or explicitly defer'))
    for (const bug of highBugs) {
      lines.push(`- [ ] **[${bug.id}]** ${bug.description}`)
      lines.push(`  - _Verify: ${bug.suggestion}_`)
    }
    lines.push('')
  }

  // Requirements checklist
  lines.push(header(2, '📋 Requirement Verification'))
  for (const req of crossCheck.requirementCoverage) {
    const icon = req.status === 'implemented' ? '✅' : '⬜'
    const prefix = req.status === 'implemented' ? '[x]' : '[ ]'
    lines.push(`- ${prefix} **[${req.requirementId}]** ${req.requirementDescription}`)
    if (req.concern) {
      lines.push(`  - _⚠️ ${req.concern}_`)
    }
  }
  lines.push('')

  // AC checklist
  if (jira.acceptanceCriteria.length > 0) {
    lines.push(header(2, '🎯 Acceptance Criteria'))
    if (!jira.hasExplicitAC) {
      lines.push('_⚠️ These AC were inferred by AI — please confirm with ticket author_')
      lines.push('')
    }
    for (const ac of jira.acceptanceCriteria) {
      lines.push(`- [ ] **[${ac.id}]** ${ac.description}`)
    }
    lines.push('')
  }

  // Medium/Low bugs
  const medBugs = crossCheck.potentialBugs.filter((b) => b.severity === 'medium')
  const lowBugs = crossCheck.potentialBugs.filter((b) => b.severity === 'low')
  if (medBugs.length > 0 || lowBugs.length > 0) {
    lines.push(header(2, '🟡🟢 Medium / Low — Review and decide'))
    for (const bug of [...medBugs, ...lowBugs]) {
      lines.push(`- [ ] **[${bug.id}]** (${bug.severity}) ${bug.description}`)
    }
    lines.push('')
  }

  // Unexpected changes notice
  if (crossCheck.unexpectedChanges.length > 0) {
    lines.push(header(2, '⚠️ Unexpected Changes — Review with reviewer'))
    crossCheck.unexpectedChanges.forEach((u) => lines.push(`- [ ] ${u}`))
    lines.push('')
  }

  return lines.join('\n')
}

// ─── public API ───────────────────────────────────────────────────────────────

export function runStage4(
  jira: JiraReport,
  code: CodeReport,
  crossCheck: CrossCheckReport,
  businessRules?: string[],
): FinalReports {
  return {
    ticketKey: jira.ticketKey,
    generatedAt: new Date().toISOString(),
    riskLevel: crossCheck.riskLevel,
    requirementReport: buildReportA(jira, crossCheck),
    bugReport:         buildReportB(jira, code, crossCheck, businessRules),
    checklist:         buildReportC(jira, crossCheck),
  }
}
