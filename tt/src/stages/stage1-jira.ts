/**
 * stages/stage1-jira.ts
 *
 * Uses PromptBuilder to assemble the prompt — each layer is clearly visible,
 * conditional branches are explicit.
 */

import type { JiraTicket, JiraReport, Requirement, AcceptanceCriteria } from '../types/index.js'
import { callLLM, extractJSON } from '../llm/client.js'
import { PromptBuilder } from '../prompt/builder.js'
import {
  ROLE_QA_ANALYST,
  TASK_JIRA_ANALYSIS,
  AC_HAS_EXPLICIT,
  AC_MUST_INFER,
  RULE_PRIORITY_GUIDE,
  RULE_CONCISE,
  RULE_JSON_ONLY,
  SCHEMA_JIRA_REPORT,
} from '../prompt/blocks.js'
import { jiraTicketSlot } from '../prompt/slots.js'

const AC_KEYWORDS = [
  'acceptance criteria', 'acceptance criterion',
  'done when', 'definition of done',
  '验收标准', 'ac:', '- ac',
]

function detectExplicitAC(ticket: JiraTicket): boolean {
  const haystack = [ticket.description, ticket.acceptanceCriteria ?? '']
    .join('\n').toLowerCase()
  return AC_KEYWORDS.some(kw => haystack.includes(kw))
}

interface LLMJiraReport {
  summary: string
  requirements: Array<{
    id: string; description: string
    priority: 'must' | 'should' | 'nice-to-have'
    testable: boolean; source: 'explicit' | 'inferred'
  }>
  acceptanceCriteria: Array<{
    id: string; description: string; source: 'explicit' | 'inferred'
  }>
  outOfScope: string[]
  riskFlags: string[]
  ambiguities: string[]
}

export async function runStage1(ticket: JiraTicket): Promise<JiraReport> {
  const hasExplicitAC = detectExplicitAC(ticket)

  const { system, user } = new PromptBuilder()
    .system(ROLE_QA_ANALYST)
    .system(TASK_JIRA_ANALYSIS)
    .systemIf(hasExplicitAC, AC_HAS_EXPLICIT, AC_MUST_INFER)
    .system(RULE_PRIORITY_GUIDE)
    .system(RULE_CONCISE)
    .system(SCHEMA_JIRA_REPORT)
    .system(RULE_JSON_ONLY)
    .user(jiraTicketSlot(ticket))
    .build()

  const raw = await callLLM({ system, userPrompt: user, maxTokens: 3000, temperature: 0.1 })
  const parsed = extractJSON<LLMJiraReport>(raw)

  const requirements: Requirement[] = (parsed.requirements ?? []).map(r => ({
    id: r.id ?? 'REQ-???',
    description: r.description ?? '',
    priority: r.priority ?? 'must',
    testable: r.testable ?? true,
    source: r.source ?? (hasExplicitAC ? 'explicit' : 'inferred'),
  }))

  const acceptanceCriteria: AcceptanceCriteria[] = (parsed.acceptanceCriteria ?? []).map(ac => ({
    id: ac.id ?? 'AC-???',
    description: ac.description ?? '',
    source: ac.source ?? (hasExplicitAC ? 'explicit' : 'inferred'),
  }))

  return {
    ticketKey: ticket.key,
    summary: parsed.summary ?? ticket.summary,
    requirements,
    acceptanceCriteria,
    outOfScope: parsed.outOfScope ?? [],
    riskFlags: parsed.riskFlags ?? [],
    ambiguities: parsed.ambiguities ?? [],
    hasExplicitAC,
  }
}
