/**
 * stages/stage3-crosscheck.ts
 *
 * Stage 3: the most complex prompt in the pipeline:
 *   - Two structured data inputs (JiraReport + CodeReport) injected simultaneously
 *   - businessRules conditionally injected (only if configured)
 *   - Multiple rule constraint blocks stacked
 */

import type {
  JiraReport, CodeReport, CrossCheckReport,
  RequirementCheck, PotentialBug, RiskLevel,
} from '../types/index.js'
import { callLLM, extractJSON } from '../llm/client.js'
import { PromptBuilder } from '../prompt/builder.js'
import {
  ROLE_GAP_ANALYST,
  TASK_CROSSCHECK,
  RULE_CROSSCHECK_EVIDENCE,
  RULE_BUG_SEVERITY,
  RULE_RISK_LEVEL,
  RULE_CONCISE,
  RULE_JSON_ONLY,
  SCHEMA_CROSSCHECK_REPORT,
} from '../prompt/blocks.js'
import { jiraReportSlot, codeReportSlot, businessRulesSlot } from '../prompt/slots.js'

interface LLMCrossCheck {
  requirementCoverage: Array<{
    requirementId: string; requirementDescription: string
    status: 'implemented' | 'partial' | 'missing' | 'unclear'
    evidence: string; concern: string
  }>
  potentialBugs: Array<{
    id: string; severity: 'critical' | 'high' | 'medium' | 'low'
    description: string; location: string[]
    triggerCondition: string; suggestion: string
  }>
  missingImplementations: string[]
  unexpectedChanges: string[]
  riskLevel: 'high' | 'medium' | 'low'
}

export async function runStage3(
  jiraReport: JiraReport,
  codeReport: CodeReport,
  businessRules?: string[],
): Promise<CrossCheckReport> {

  // ── Prompt assembly ─────────────────────────────────────────────────────
  //
  // System:
  //   Role → Task → Evidence rules → Severity guide → Risk level → Concise → Schema → JSON constraint
  //
  // User:
  //   JiraReport (already structured, LLM doesn't need to parse raw Jira)
  //   CodeReport (already structured, LLM doesn't need to parse raw diff)
  //   businessRules (conditionally injected, skipped when empty)

  const { system, user } = new PromptBuilder()
    .system(ROLE_GAP_ANALYST)
    .system(TASK_CROSSCHECK)
    .system(RULE_CROSSCHECK_EVIDENCE)
    .system(RULE_BUG_SEVERITY)
    .system(RULE_RISK_LEVEL)
    .system(RULE_CONCISE)
    .system(SCHEMA_CROSSCHECK_REPORT)
    .system(RULE_JSON_ONLY)
    // Jira spec — from Stage 1 output (clean structured text)
    .user(jiraReportSlot(jiraReport))
    // Code summary — from Stage 2 output
    .user(codeReportSlot(codeReport))
    // Business rules — only injected if configured in .testmindrc.json
    .user(businessRulesSlot(businessRules))
    .build()

  // Stage 3 has the most content — give a larger token budget
  const raw = await callLLM({
    system,
    userPrompt: user,
    maxTokens: 5000,
    temperature: 0.15,
  })

  const parsed = extractJSON<LLMCrossCheck>(raw)

  const VALID_STATUSES = ['implemented', 'partial', 'missing', 'unclear'] as const
  const VALID_SEVERITIES = ['critical', 'high', 'medium', 'low'] as const

  const requirementCoverage: RequirementCheck[] = (parsed.requirementCoverage ?? []).map(r => ({
    requirementId: r.requirementId ?? '',
    requirementDescription: r.requirementDescription ?? '',
    status: VALID_STATUSES.includes(r.status as typeof VALID_STATUSES[number]) ? r.status : 'unclear',
    evidence: r.evidence ?? '',
    concern: r.concern ?? '',
  }))

  const potentialBugs: PotentialBug[] = (parsed.potentialBugs ?? []).map(b => ({
    id: b.id ?? 'BUG-???',
    severity: VALID_SEVERITIES.includes(b.severity as typeof VALID_SEVERITIES[number]) ? b.severity : 'medium',
    description: b.description ?? '',
    location: Array.isArray(b.location) ? b.location : [b.location ?? ''],
    triggerCondition: b.triggerCondition ?? '',
    suggestion: b.suggestion ?? '',
  }))

  const VALID_RISK_LEVELS = ['high', 'medium', 'low'] as const
  const riskLevel: RiskLevel = VALID_RISK_LEVELS.includes(parsed.riskLevel as RiskLevel)
    ? (parsed.riskLevel as RiskLevel)
    : (() => {
        console.warn(`[Stage3] LLM returned unexpected riskLevel "${parsed.riskLevel}", defaulting to "medium"`)
        return 'medium' as RiskLevel
      })()

  return {
    requirementCoverage,
    potentialBugs,
    missingImplementations: parsed.missingImplementations ?? [],
    unexpectedChanges: parsed.unexpectedChanges ?? [],
    riskLevel,
  }
}
