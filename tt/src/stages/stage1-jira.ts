/**
 * stages/stage1-jira.ts
 *
 * Stage 1: Jira Analysis
 *
 * Input  → JiraTicket (raw Jira data)
 * Output → JiraReport (structured requirements + AC + risk flags)
 *
 * Two-pass strategy:
 *   Pass A: detect whether explicit AC exists (cheap check)
 *   Pass B: full LLM analysis → structured JSON
 */

import type { JiraTicket, JiraReport, Requirement, AcceptanceCriteria } from '../types/index.js'
import { callLLM, extractJSON, JSON_ONLY_INSTRUCTION } from '../llm/client.js'

// ─── AC detection ─────────────────────────────────────────────────────────────

const AC_KEYWORDS = [
  'acceptance criteria',
  'acceptance criterion',
  'done when',
  'definition of done',
  '验收标准',
  'ac:',
  '- ac',
]

function detectExplicitAC(ticket: JiraTicket): boolean {
  const haystack = [
    ticket.description,
    ticket.acceptanceCriteria ?? '',
  ]
    .join('\n')
    .toLowerCase()

  return AC_KEYWORDS.some((kw) => haystack.includes(kw))
}

// ─── ticket → prompt text ─────────────────────────────────────────────────────

function ticketToPromptText(ticket: JiraTicket): string {
  const lines: string[] = []

  lines.push(`# Jira Ticket: ${ticket.key}`)
  lines.push(`**Type:** ${ticket.type}  |  **Priority:** ${ticket.priority}  |  **Status:** ${ticket.status}`)
  lines.push(`**Summary:** ${ticket.summary}`)
  lines.push('')
  lines.push('## Description')
  lines.push(ticket.description || '(no description)')

  if (ticket.acceptanceCriteria) {
    lines.push('')
    lines.push('## Acceptance Criteria (as extracted from ticket)')
    lines.push(ticket.acceptanceCriteria)
  }

  if (ticket.comments.length > 0) {
    lines.push('')
    lines.push('## Comments (may contain requirement changes)')
    for (const c of ticket.comments) {
      lines.push(`**${c.author}** (${c.createdAt}):`)
      lines.push(c.body)
      lines.push('')
    }
  }

  if (ticket.subtasks.length > 0) {
    lines.push(`**Subtasks:** ${ticket.subtasks.join(', ')}`)
  }
  if (ticket.linkedIssues.length > 0) {
    lines.push(`**Linked issues:** ${ticket.linkedIssues.join(', ')}`)
  }
  if (ticket.labels.length > 0) {
    lines.push(`**Labels:** ${ticket.labels.join(', ')}`)
  }

  return lines.join('\n')
}

// ─── LLM response shape ───────────────────────────────────────────────────────

interface LLMJiraReport {
  summary: string
  requirements: Array<{
    id: string
    description: string
    priority: 'must' | 'should' | 'nice-to-have'
    testable: boolean
    source: 'explicit' | 'inferred'
  }>
  acceptanceCriteria: Array<{
    id: string
    description: string
    source: 'explicit' | 'inferred'
  }>
  outOfScope: string[]
  riskFlags: string[]
  ambiguities: string[]
}

// ─── main function ────────────────────────────────────────────────────────────

export async function runStage1(ticket: JiraTicket): Promise<JiraReport> {
  const hasExplicitAC = detectExplicitAC(ticket)
  const ticketText = ticketToPromptText(ticket)

  const systemPrompt = `
You are a senior QA engineer and business analyst.
Your job is to parse a Jira ticket and convert it into a precise, structured specification
that can be used to verify whether a code implementation is correct and complete.

${hasExplicitAC
    ? 'This ticket has explicit Acceptance Criteria. Extract them faithfully, then also derive additional implicit requirements from the description and comments.'
    : `This ticket does NOT have explicit Acceptance Criteria.
You MUST infer the AC from the description, ticket type, and comments.
Mark all inferred items with source: "inferred".
Later you will warn the user that these are inferred and should be confirmed.`
  }

Guidelines:
- Break the work into atomic, independently testable requirements.
- "Must" = without this the ticket is incomplete; "should" = important but not blocking; "nice-to-have" = bonus.
- riskFlags: identify anything in the description/comments that signals technical risk
  (e.g. "backward compatible", "need to migrate data", "touches payments", "rate limiting").
- ambiguities: phrases that different developers could interpret differently.
- outOfScope: things explicitly excluded OR clearly outside the scope of this ticket.
- Comments from stakeholders often contain late-breaking requirements — treat them as authoritative.

${JSON_ONLY_INSTRUCTION}

Output schema:
{
  "summary": "one-sentence description of what this ticket delivers",
  "requirements": [
    {
      "id": "REQ-001",
      "description": "...",
      "priority": "must" | "should" | "nice-to-have",
      "testable": true | false,
      "source": "explicit" | "inferred"
    }
  ],
  "acceptanceCriteria": [
    {
      "id": "AC-001",
      "description": "...",
      "source": "explicit" | "inferred"
    }
  ],
  "outOfScope": ["..."],
  "riskFlags": ["..."],
  "ambiguities": ["..."]
}
`.trim()

  const userPrompt = `
Please analyse the following Jira ticket and produce the structured JSON report.

${ticketText}
`.trim()

  const raw = await callLLM({
    system: systemPrompt,
    userPrompt,
    maxTokens: 3000,
    temperature: 0.1, // we want deterministic structured output
  })

  const parsed = extractJSON<LLMJiraReport>(raw)

  // Validate and normalise
  const requirements: Requirement[] = (parsed.requirements ?? []).map((r) => ({
    id: r.id ?? 'REQ-???',
    description: r.description ?? '',
    priority: r.priority ?? 'must',
    testable: r.testable ?? true,
    source: r.source ?? (hasExplicitAC ? 'explicit' : 'inferred'),
  }))

  const acceptanceCriteria: AcceptanceCriteria[] = (parsed.acceptanceCriteria ?? []).map((ac) => ({
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
