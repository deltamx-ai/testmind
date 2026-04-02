/**
 * jira/client.ts
 *
 * Provides:
 *   - MockJiraClient  — returns hard-coded fixture tickets (for local dev)
 *   - RealJiraClient  — calls Jira REST API v3 with a Personal Access Token
 *   - createJiraClient factory
 *
 * The mock tickets cover a realistic range: Story with AC, Bug without AC,
 * and a Task with ambiguous requirements.
 */

import type { JiraTicket, JiraComment } from '../types/index.js'

export interface JiraClientOptions {
  mode: 'mock' | 'real'
  /** Required when mode === 'real' */
  baseUrl?: string
  /** Personal Access Token (Bearer) or Basic token */
  token?: string
}

export interface JiraClient {
  getTicket(key: string): Promise<JiraTicket>
}

// ─── Mock client ─────────────────────────────────────────────────────────────

const MOCK_TICKETS: Record<string, JiraTicket> = {
  // Story with explicit Acceptance Criteria
  'PROJ-101': {
    key: 'PROJ-101',
    summary: 'User can reset password via email verification',
    type: 'Story',
    status: 'In Progress',
    priority: 'High',
    assignee: 'alice@example.com',
    reporter: 'pm@example.com',
    description: `
## Description
As a user who has forgotten their password, I want to receive a verification email so
that I can securely reset my password without contacting support.

## Acceptance Criteria
- AC1: When a user submits their email on /forgot-password, a reset link is sent within 30 seconds
- AC2: The reset link expires after 24 hours
- AC3: The reset link is single-use; clicking it twice shows "link already used"
- AC4: New password must be at least 8 characters and contain a number
- AC5: After successful reset, all existing sessions for that user are invalidated
- AC6: Rate limit: no more than 3 reset emails per user per hour

## Out of Scope
- Social login / OAuth reset
- SMS-based reset
    `.trim(),
    acceptanceCriteria: `
- AC1: When a user submits their email on /forgot-password, a reset link is sent within 30 seconds
- AC2: The reset link expires after 24 hours
- AC3: The reset link is single-use; clicking it twice shows "link already used"
- AC4: New password must be at least 8 characters and contain a number
- AC5: After successful reset, all existing sessions for that user are invalidated
- AC6: Rate limit: no more than 3 reset emails per user per hour
    `.trim(),
    subtasks: ['PROJ-102', 'PROJ-103'],
    linkedIssues: ['PROJ-88'],
    labels: ['auth', 'security'],
    createdAt: '2025-03-01T10:00:00Z',
    updatedAt: '2025-03-10T15:30:00Z',
    comments: [
      {
        author: 'backend-dev@example.com',
        body: 'Should we also revoke refresh tokens on reset? Checking with security.',
        createdAt: '2025-03-05T09:00:00Z',
      },
      {
        author: 'pm@example.com',
        body: 'Yes, all tokens including refresh tokens must be invalidated. Adding to AC5.',
        createdAt: '2025-03-05T09:45:00Z',
      },
    ],
  },

  // Bug ticket — no explicit AC, description is terse
  'PROJ-210': {
    key: 'PROJ-210',
    summary: 'Shopping cart total is wrong when coupon + tax applied simultaneously',
    type: 'Bug',
    status: 'In Progress',
    priority: 'Highest',
    assignee: 'bob@example.com',
    reporter: 'qa@example.com',
    description: `
## Bug Report

**Steps to reproduce:**
1. Add item ($100) to cart
2. Apply coupon SAVE20 (20% off)
3. Checkout in a state with 8% sales tax

**Expected:** Total = ($100 - $20) * 1.08 = $86.40
**Actual:**   Total = ($100 * 1.08) - $20 = $88.00

The bug seems to be in the order of operations — tax is applied before the coupon discount.

**Affected versions:** v2.3.1, v2.3.2
**Priority:** Must fix before release on Friday.
    `.trim(),
    subtasks: [],
    linkedIssues: ['PROJ-200'],
    labels: ['payments', 'regression'],
    createdAt: '2025-03-08T08:00:00Z',
    updatedAt: '2025-03-09T11:00:00Z',
    comments: [
      {
        author: 'qa@example.com',
        body: 'Also tested with multiple coupons — same problem. Stacked coupons make it worse.',
        createdAt: '2025-03-08T14:00:00Z',
      },
      {
        author: 'bob@example.com',
        body: 'Found it. calculateTotal() applies tax first, then discount. Will fix order of operations.',
        createdAt: '2025-03-09T10:00:00Z',
      },
    ],
  },

  // Task with ambiguous requirements
  'PROJ-315': {
    key: 'PROJ-315',
    summary: 'Add audit logging for admin actions',
    type: 'Task',
    status: 'In Progress',
    priority: 'Medium',
    assignee: 'charlie@example.com',
    reporter: 'tech-lead@example.com',
    description: `
Admins can currently perform sensitive operations (delete user, change role, export data)
without any audit trail. We need to add logging so we can investigate incidents.

The logs should be queryable and retained for compliance.

Some thoughts:
- Maybe use a separate audit_logs table?
- Could also write to an external service (Datadog? Splunk?)
- Need to capture who did what and when
    `.trim(),
    subtasks: [],
    linkedIssues: [],
    labels: ['security', 'compliance'],
    createdAt: '2025-03-03T12:00:00Z',
    updatedAt: '2025-03-10T09:00:00Z',
    comments: [
      {
        author: 'tech-lead@example.com',
        body: 'Let\'s use the audit_logs table approach for now, external service can come later. Keep it simple.',
        createdAt: '2025-03-04T10:00:00Z',
      },
      {
        author: 'compliance@example.com',
        body: 'Minimum retention is 90 days per policy. Logs must include user_id, action, timestamp, IP address.',
        createdAt: '2025-03-06T16:00:00Z',
      },
    ],
  },
}

class MockJiraClient implements JiraClient {
  async getTicket(key: string): Promise<JiraTicket> {
    const ticket = MOCK_TICKETS[key]
    if (!ticket) {
      throw new Error(`[MockJira] No fixture for ticket ${key}. Available: ${MOCK_TICKET_KEYS.join(', ')}`)
    }
    return { ...ticket }
  }
}

// ─── Real Jira client ─────────────────────────────────────────────────────────

class RealJiraClient implements JiraClient {
  private baseUrl: string
  private headers: Record<string, string>

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }
  }

  async getTicket(key: string): Promise<JiraTicket> {
    const url = `${this.baseUrl}/rest/api/3/issue/${encodeURIComponent(key)}?expand=renderedFields,comments`

    let res: Response
    try {
      res = await fetch(url, { headers: this.headers })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`Jira API network error for ${key}: ${msg} (URL: ${this.baseUrl})`)
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Jira API error ${res.status} for ${key}: ${body.slice(0, 200)}`)
    }

    const data = (await res.json()) as JiraIssueV3
    return normalizeJiraIssue(data)
  }
}

// ─── Jira API v3 response types (minimal) ────────────────────────────────────

interface JiraIssueV3 {
  key: string
  fields: {
    summary: string
    description?: JiraDocNode | string | null
    issuetype: { name: string }
    status: { name: string }
    priority: { name: string }
    assignee?: { emailAddress?: string; displayName?: string } | null
    reporter?: { emailAddress?: string; displayName?: string } | null
    subtasks?: Array<{ key: string }>
    issuelinks?: Array<{ outwardIssue?: { key: string }; inwardIssue?: { key: string } }>
    labels?: string[]
    created: string
    updated: string
    comment?: { comments: JiraCommentV3[] }
  }
}

interface JiraCommentV3 {
  author: { displayName?: string; emailAddress?: string }
  body: JiraDocNode | string
  created: string
}

interface JiraDocNode {
  type: string
  content?: JiraDocNode[]
  text?: string
  attrs?: Record<string, unknown>
}

function docNodeToText(node: JiraDocNode | string | null | undefined): string {
  if (!node) return ''
  if (typeof node === 'string') return node
  if (node.type === 'text') return node.text ?? ''
  return (node.content ?? []).map(docNodeToText).join('\n')
}

function extractAC(description: string): string | undefined {
  const acPatterns = [
    /acceptance criteria[:\s]*([\s\S]+?)(?=\n##|\n\*\*|$)/i,
    /done when[:\s]*([\s\S]+?)(?=\n##|\n\*\*|$)/i,
    /验收标准[：:\s]*([\s\S]+?)(?=\n##|\n\*\*|$)/i,
  ]
  for (const p of acPatterns) {
    const m = description.match(p)
    if (m?.[1]?.trim()) return m[1].trim()
  }
  return undefined
}

function normalizeJiraIssue(data: JiraIssueV3): JiraTicket {
  const f = data.fields
  const description = docNodeToText(f.description)

  const comments: JiraComment[] = (f.comment?.comments ?? []).map((c) => ({
    author: c.author.emailAddress ?? c.author.displayName ?? 'unknown',
    body: docNodeToText(c.body),
    createdAt: c.created,
  }))

  const linkedIssues: string[] = []
  for (const link of f.issuelinks ?? []) {
    if (link.outwardIssue?.key) linkedIssues.push(link.outwardIssue.key)
    if (link.inwardIssue?.key) linkedIssues.push(link.inwardIssue.key)
  }

  return {
    key: data.key,
    summary: f.summary,
    description,
    type: (f.issuetype.name as JiraTicket['type']) ?? 'Task',
    status: f.status.name,
    priority: (f.priority.name as JiraTicket['priority']) ?? 'Medium',
    assignee: f.assignee?.emailAddress ?? f.assignee?.displayName,
    reporter: f.reporter?.emailAddress ?? f.reporter?.displayName,
    acceptanceCriteria: extractAC(description),
    subtasks: (f.subtasks ?? []).map((s) => s.key),
    linkedIssues,
    labels: f.labels ?? [],
    comments,
    createdAt: f.created,
    updatedAt: f.updated,
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createJiraClient(opts: JiraClientOptions): JiraClient {
  if (opts.mode === 'real') {
    if (!opts.baseUrl || !opts.token) {
      throw new Error('Real Jira client requires baseUrl and token')
    }
    return new RealJiraClient(opts.baseUrl, opts.token)
  }
  return new MockJiraClient()
}

// ─── helpers ─────────────────────────────────────────────────────────────────

/** List available mock ticket keys (useful for CLI help) */
export const MOCK_TICKET_KEYS = Object.keys(MOCK_TICKETS)
