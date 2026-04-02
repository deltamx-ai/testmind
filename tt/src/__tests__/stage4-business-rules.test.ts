/**
 * Tests for Stage 4 report generation with business rules and critical paths.
 */

import { describe, it, expect } from 'vitest'
import { runStage4 } from '../stages/stage4-report.js'
import type { JiraReport, CodeReport, CrossCheckReport } from '../types/index.js'

const jira: JiraReport = {
  ticketKey: 'TEST-1',
  summary: 'User can reset password',
  hasExplicitAC: true,
  requirements: [
    { id: 'REQ-001', description: 'User receives reset email', priority: 'must', testable: true, source: 'explicit' },
  ],
  acceptanceCriteria: [
    { id: 'AC-001', description: 'Email sent within 30 seconds', source: 'explicit' },
  ],
  outOfScope: [],
  riskFlags: [],
  ambiguities: [],
}

const code: CodeReport = {
  implementedFeatures: ['Password reset'],
  modifiedBehaviors: [],
  deletedBehaviors: [],
  sideEffects: [],
  testCoverage: { covered: [], uncovered: [] },
  codeSmells: [],
  affectedFiles: ['src/auth/reset.ts'],
  criticalPathFiles: ['src/auth/reset.ts'],
}

const crossCheck: CrossCheckReport = {
  requirementCoverage: [
    { requirementId: 'REQ-001', requirementDescription: 'User receives reset email', status: 'implemented', evidence: 'sendEmail()', concern: '' },
  ],
  potentialBugs: [],
  missingImplementations: [],
  unexpectedChanges: [],
  riskLevel: 'low',
}

describe('runStage4 with business rules', () => {
  it('includes business rules section in bug report', () => {
    const rules = ['Payment must check idempotency', 'Auth must verify token invalidation']
    const reports = runStage4(jira, code, crossCheck, rules)
    expect(reports.bugReport).toContain('Business Rules')
    expect(reports.bugReport).toContain('Payment must check idempotency')
    expect(reports.bugReport).toContain('Auth must verify token invalidation')
  })

  it('omits business rules section when none provided', () => {
    const reports = runStage4(jira, code, crossCheck)
    expect(reports.bugReport).not.toContain('Business Rules')
  })

  it('omits business rules section for empty array', () => {
    const reports = runStage4(jira, code, crossCheck, [])
    expect(reports.bugReport).not.toContain('Business Rules')
  })

  it('includes critical path files section', () => {
    const reports = runStage4(jira, code, crossCheck)
    expect(reports.bugReport).toContain('Critical Path Files')
    expect(reports.bugReport).toContain('src/auth/reset.ts')
  })

  it('omits critical path section when no critical files', () => {
    const codeNoCrit = { ...code, criticalPathFiles: [] }
    const reports = runStage4(jira, codeNoCrit, crossCheck)
    expect(reports.bugReport).not.toContain('Critical Path Files')
  })
})
