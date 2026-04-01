/**
 * stages/stage3-crosscheck.ts
 *
 * Stage 3: Cross-Check (the most valuable stage)
 *
 * Takes JiraReport + CodeReport, asks the LLM to:
 *   - Check each requirement against the implementation
 *   - Identify potential bugs
 *   - Find missing implementations
 *   - Flag unexpected changes (scope creep / accidental regressions)
 *
 * This is a focused, clean LLM call: both inputs are already structured,
 * so the model can concentrate on gap analysis rather than parsing.
 */

import type {
  JiraReport,
  CodeReport,
  CrossCheckReport,
  RequirementCheck,
  PotentialBug,
  RiskLevel,
} from '../types/index.js'
import { callLLM, extractJSON, JSON_ONLY_INSTRUCTION } from '../llm/client.js'

// ─── prompt serialisers ───────────────────────────────────────────────────────

function jiraReportToText(jira: JiraReport): string {
  const lines: string[] = []
  lines.push(`# Jira Report — ${jira.ticketKey}`)
  lines.push(`**Summary:** ${jira.summary}`)
  lines.push('')

  lines.push('## Requirements')
  for (const req of jira.requirements) {
    const inferred = req.source === 'inferred' ? ' ⚠️ [inferred]' : ''
    lines.push(
      `- [${req.id}] (${req.priority}) ${req.description}${inferred}`,
    )
  }
  lines.push('')

  lines.push('## Acceptance Criteria')
  for (const ac of jira.acceptanceCriteria) {
    const inferred = ac.source === 'inferred' ? ' ⚠️ [inferred — not written in ticket]' : ''
    lines.push(`- [${ac.id}] ${ac.description}${inferred}`)
  }
  lines.push('')

  if (jira.outOfScope.length > 0) {
    lines.push('## Explicitly Out of Scope')
    jira.outOfScope.forEach((s) => lines.push(`- ${s}`))
    lines.push('')
  }

  if (jira.riskFlags.length > 0) {
    lines.push('## Risk Flags (from Jira)')
    jira.riskFlags.forEach((r) => lines.push(`- ${r}`))
    lines.push('')
  }

  if (jira.ambiguities.length > 0) {
    lines.push('## Known Ambiguities')
    jira.ambiguities.forEach((a) => lines.push(`- ${a}`))
  }

  return lines.join('\n')
}

function codeReportToText(code: CodeReport): string {
  const lines: string[] = []
  lines.push('# Code Report (from diff analysis)')
  lines.push('')

  lines.push('## What this diff implements (business features)')
  if (code.implementedFeatures.length === 0) {
    lines.push('- (none identified)')
  } else {
    code.implementedFeatures.forEach((f) => lines.push(`- ${f}`))
  }
  lines.push('')

  lines.push('## Existing behaviours that were modified')
  if (code.modifiedBehaviors.length === 0) {
    lines.push('- (none)')
  } else {
    code.modifiedBehaviors.forEach((b) => lines.push(`- ${b}`))
  }
  lines.push('')

  lines.push('## Behaviours that were deleted')
  if (code.deletedBehaviors.length === 0) {
    lines.push('- (none)')
  } else {
    code.deletedBehaviors.forEach((b) => lines.push(`- ${b}`))
  }
  lines.push('')

  lines.push('## Potential side effects (other modules impacted)')
  if (code.sideEffects.length === 0) {
    lines.push('- (none identified)')
  } else {
    code.sideEffects.forEach((s) => lines.push(`- ${s}`))
  }
  lines.push('')

  lines.push('## Test coverage')
  lines.push('**Covered:**')
  if (code.testCoverage.covered.length === 0) {
    lines.push('- (none)')
  } else {
    code.testCoverage.covered.forEach((c) => lines.push(`  - ${c}`))
  }
  lines.push('**NOT covered:**')
  if (code.testCoverage.uncovered.length === 0) {
    lines.push('- (all changes appear to be tested)')
  } else {
    code.testCoverage.uncovered.forEach((u) => lines.push(`  - ${u}`))
  }
  lines.push('')

  lines.push('## Files changed')
  lines.push(code.affectedFiles.join(', ') || '(none)')

  return lines.join('\n')
}

// ─── LLM response shape ───────────────────────────────────────────────────────

interface LLMCrossCheck {
  requirementCoverage: Array<{
    requirementId: string
    requirementDescription: string
    status: 'implemented' | 'partial' | 'missing' | 'unclear'
    evidence: string
    concern: string
  }>
  potentialBugs: Array<{
    id: string
    severity: 'critical' | 'high' | 'medium' | 'low'
    description: string
    location: string[]
    triggerCondition: string
    suggestion: string
  }>
  missingImplementations: string[]
  unexpectedChanges: string[]
  riskLevel: 'high' | 'medium' | 'low'
}

// ─── main function ────────────────────────────────────────────────────────────

export async function runStage3(
  jiraReport: JiraReport,
  codeReport: CodeReport,
  businessRules?: string[],
): Promise<CrossCheckReport> {
  const jiraText = jiraReportToText(jiraReport)
  const codeText = codeReportToText(codeReport)

  const businessRulesSection = businessRules && businessRules.length > 0
    ? `\n## Project Business Rules (always check these)\n${businessRules.map((r) => `- ${r}`).join('\n')}\n`
    : ''

  const systemPrompt = `
You are an expert QA engineer performing a gap analysis between a product specification and its implementation.

You will be given:
1. A structured Jira Report (what the ticket requires)
2. A structured Code Report (what the diff actually implements)

Your job:
A) For EVERY requirement and AC in the Jira Report, determine whether the code implements it.
B) Identify potential bugs that could arise from the changes — think about edge cases,
   error handling, concurrency, data validation, security, and backward compatibility.
C) List features the ticket requires but the code hasn't implemented.
D) List code changes that aren't justified by the ticket (scope creep, accidental changes).
E) Assign an overall risk level.
${businessRulesSection}

Severity guide for bugs:
- critical: would cause data loss, security breach, payment errors, or system unavailability
- high: breaks a core feature for some users
- medium: degrades experience but has a workaround
- low: cosmetic / minor inconsistency

${JSON_ONLY_INSTRUCTION}

Output schema:
{
  "requirementCoverage": [
    {
      "requirementId": "REQ-001",
      "requirementDescription": "copy the requirement text here",
      "status": "implemented" | "partial" | "missing" | "unclear",
      "evidence": "which file/function/line implements this, or why you think it's missing",
      "concern": "what specifically is missing or at risk (empty string if status=implemented)"
    }
  ],
  "potentialBugs": [
    {
      "id": "BUG-001",
      "severity": "critical" | "high" | "medium" | "low",
      "description": "what the bug is",
      "location": ["file/path"],
      "triggerCondition": "how to trigger this bug",
      "suggestion": "how to verify or fix it"
    }
  ],
  "missingImplementations": [
    "Requirement X is in the Jira but there is no corresponding code change"
  ],
  "unexpectedChanges": [
    "Description of a code change that the Jira ticket does not justify"
  ],
  "riskLevel": "high" | "medium" | "low"
}
`.trim()

  const userPrompt = `
Please perform the gap analysis.

---

${jiraText}

---

${codeText}
`.trim()

  const raw = await callLLM({
    system: systemPrompt,
    userPrompt,
    maxTokens: 5000,
    temperature: 0.15,
  })

  const parsed = extractJSON<LLMCrossCheck>(raw)

  const requirementCoverage: RequirementCheck[] = (parsed.requirementCoverage ?? []).map((r) => ({
    requirementId: r.requirementId ?? '',
    requirementDescription: r.requirementDescription ?? '',
    status: r.status ?? 'unclear',
    evidence: r.evidence ?? '',
    concern: r.concern ?? '',
  }))

  const potentialBugs: PotentialBug[] = (parsed.potentialBugs ?? []).map((b) => ({
    id: b.id ?? 'BUG-???',
    severity: b.severity ?? 'medium',
    description: b.description ?? '',
    location: Array.isArray(b.location) ? b.location : [b.location ?? ''],
    triggerCondition: b.triggerCondition ?? '',
    suggestion: b.suggestion ?? '',
  }))

  const riskLevel: RiskLevel = (['high', 'medium', 'low'] as const).includes(
    parsed.riskLevel as RiskLevel,
  )
    ? (parsed.riskLevel as RiskLevel)
    : 'medium'

  return {
    requirementCoverage,
    potentialBugs,
    missingImplementations: parsed.missingImplementations ?? [],
    unexpectedChanges: parsed.unexpectedChanges ?? [],
    riskLevel,
  }
}
