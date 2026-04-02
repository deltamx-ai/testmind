/**
 * Tests for prompt slots - the dynamic data injection layer.
 */

import { describe, it, expect } from 'vitest'
import {
  jiraTicketSlot,
  jiraReportSlot,
  codeReportSlot,
  techStackSlot,
  businessRulesSlot,
  staticAnalysisSlot,
} from '../prompt/slots.js'
import type { JiraTicket, JiraReport, CodeReport } from '../types/index.js'
import type { StaticAnalysisResult } from '../stages/stage2-code.js'

const mockTicket: JiraTicket = {
  key: 'PROJ-101',
  summary: 'Test summary',
  description: 'Some description',
  type: 'Story',
  status: 'In Progress',
  priority: 'High',
  subtasks: ['PROJ-102'],
  linkedIssues: ['PROJ-88'],
  labels: ['auth'],
  comments: [
    { author: 'alice', body: 'This is important', createdAt: '2025-03-01T10:00:00Z' },
  ],
  createdAt: '2025-03-01T00:00:00Z',
  updatedAt: '2025-03-10T00:00:00Z',
}

describe('jiraTicketSlot', () => {
  it('includes ticket key and summary', () => {
    const s = jiraTicketSlot(mockTicket)
    expect(s.section).toBe('Jira Ticket')
    expect(s.value).toContain('PROJ-101')
    expect(s.value).toContain('Test summary')
  })

  it('includes AC when present', () => {
    const ticket = { ...mockTicket, acceptanceCriteria: 'AC1: Must pass' }
    const s = jiraTicketSlot(ticket)
    expect(s.value).toContain('Acceptance Criteria')
    expect(s.value).toContain('AC1: Must pass')
  })

  it('includes comments', () => {
    const s = jiraTicketSlot(mockTicket)
    expect(s.value).toContain('alice')
    expect(s.value).toContain('This is important')
  })

  it('includes metadata', () => {
    const s = jiraTicketSlot(mockTicket)
    expect(s.value).toContain('auth')
    expect(s.value).toContain('PROJ-102')
    expect(s.value).toContain('PROJ-88')
  })

  it('truncates long descriptions', () => {
    const ticket = { ...mockTicket, description: 'x'.repeat(5000) }
    const s = jiraTicketSlot(ticket, 100)
    expect(s.value).toContain('truncated')
  })

  it('limits to 6 most recent comments', () => {
    const comments = Array.from({ length: 10 }, (_, i) => ({
      author: `user${i}`,
      body: `Comment ${i}`,
      createdAt: `2025-03-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
    }))
    const ticket = { ...mockTicket, comments }
    const s = jiraTicketSlot(ticket)
    // Should only have the last 6
    expect(s.value).toContain('user4')
    expect(s.value).toContain('user9')
    expect(s.value).not.toContain('user3')
  })
})

describe('jiraReportSlot', () => {
  const report: JiraReport = {
    ticketKey: 'PROJ-101',
    summary: 'Test summary',
    requirements: [
      { id: 'REQ-001', description: 'Must reset password', priority: 'must', testable: true, source: 'explicit' },
    ],
    acceptanceCriteria: [
      { id: 'AC-001', description: 'Email sent within 30s', source: 'explicit' },
    ],
    outOfScope: ['SMS reset'],
    riskFlags: ['Touches auth'],
    ambiguities: ['What about OAuth?'],
    hasExplicitAC: true,
  }

  it('includes requirements', () => {
    const s = jiraReportSlot(report)
    expect(s.value).toContain('REQ-001')
    expect(s.value).toContain('Must reset password')
  })

  it('includes acceptance criteria', () => {
    const s = jiraReportSlot(report)
    expect(s.value).toContain('AC-001')
  })

  it('warns when no explicit AC', () => {
    const noAC = { ...report, hasExplicitAC: false }
    const s = jiraReportSlot(noAC)
    expect(s.value).toContain('INFERRED')
  })
})

describe('codeReportSlot', () => {
  const report: CodeReport = {
    implementedFeatures: ['Password reset'],
    modifiedBehaviors: ['Login flow changed'],
    deletedBehaviors: [],
    sideEffects: ['Session module'],
    testCoverage: { covered: ['Reset email'], uncovered: ['Token expiry'] },
    codeSmells: ['console.log found'],
    affectedFiles: ['src/auth.ts'],
    criticalPathFiles: [],
  }

  it('includes all sections', () => {
    const s = codeReportSlot(report)
    expect(s.value).toContain('Password reset')
    expect(s.value).toContain('Login flow changed')
    expect(s.value).toContain('Session module')
    expect(s.value).toContain('Token expiry')
  })
})

describe('techStackSlot', () => {
  it('returns empty skippable slot when undefined', () => {
    const s = techStackSlot()
    expect(s.value).toBe('')
    expect(s.skipIfEmpty).toBe(true)
  })

  it('returns value when provided', () => {
    const s = techStackSlot('React + Node.js')
    expect(s.value).toBe('React + Node.js')
  })
})

describe('businessRulesSlot', () => {
  it('returns empty skippable slot when undefined', () => {
    const s = businessRulesSlot()
    expect(s.value).toBe('')
  })

  it('returns empty skippable slot for empty array', () => {
    const s = businessRulesSlot([])
    expect(s.value).toBe('')
  })

  it('formats rules as list', () => {
    const s = businessRulesSlot(['Rule A', 'Rule B'])
    expect(s.value).toContain('- Rule A')
    expect(s.value).toContain('- Rule B')
  })
})

describe('staticAnalysisSlot', () => {
  const analysis: StaticAnalysisResult = {
    sourceFiles: ['src/app.ts'],
    testFiles: ['src/app.test.ts'],
    configFiles: [],
    migrationFiles: ['migrations/001.sql'],
    apiSchemaFiles: [],
    untestedSourceFiles: [],
    codeSmellHints: ['TODO found — src/app.ts'],
    changedImports: [],
    criticalPathFiles: ['src/app.ts'],
  }

  it('includes source and test file counts', () => {
    const s = staticAnalysisSlot(analysis)
    expect(s.value).toContain('Source files changed (1)')
    expect(s.value).toContain('Test files changed (1)')
  })

  it('includes migrations', () => {
    const s = staticAnalysisSlot(analysis)
    expect(s.value).toContain('migrations/001.sql')
  })

  it('includes code smells', () => {
    const s = staticAnalysisSlot(analysis)
    expect(s.value).toContain('TODO found')
  })

  it('includes critical path files', () => {
    const s = staticAnalysisSlot(analysis)
    expect(s.value).toContain('Critical path files')
    expect(s.value).toContain('src/app.ts')
  })
})
