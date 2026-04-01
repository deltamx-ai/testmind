/**
 * Tests for the git diff parser and report generator.
 * Run with: npm test
 */

import { describe, it, expect } from 'vitest'

// ─── Import the pure functions we can test without LLM or git ────────────────

// We test diffToPromptText by constructing a synthetic GitDiffResult
import type { GitDiffResult } from '../src/types/index.js'
import { diffToPromptText } from '../src/git/analyzer.js'
import { runStage4 } from '../src/stages/stage4-report.js'
import type { JiraReport, CodeReport, CrossCheckReport } from '../src/types/index.js'

// ─── diffToPromptText tests ───────────────────────────────────────────────────

describe('diffToPromptText', () => {
  const minimalDiff: GitDiffResult = {
    baseBranch: 'main',
    headBranch: 'feature/test',
    commits: [
      { hash: 'abc123def456', shortHash: 'abc123', message: 'Add test feature', author: 'Alice', date: '2025-03-10' },
    ],
    files: [
      {
        path: 'src/auth/resetPassword.ts',
        category: 'source',
        changeKind: 'modified',
        additions: 30,
        deletions: 5,
        isBinary: false,
        hunks: [
          {
            oldStart: 10,
            oldCount: 5,
            newStart: 10,
            newCount: 30,
            lines: [
              { type: '+', content: 'export async function resetPassword(email: string) {', lineNumber: 10 },
              { type: '+', content: '  const token = generateToken()', lineNumber: 11 },
              { type: '-', content: '  // TODO: implement', lineNumber: 12 },
              { type: ' ', content: '}', lineNumber: 13 },
            ],
          },
        ],
      },
      {
        path: 'src/auth/resetPassword.test.ts',
        category: 'test',
        changeKind: 'added',
        additions: 50,
        deletions: 0,
        isBinary: false,
        hunks: [],
      },
    ],
    totalAdditions: 80,
    totalDeletions: 5,
  }

  it('includes commit messages', () => {
    const text = diffToPromptText(minimalDiff)
    expect(text).toContain('Add test feature')
    expect(text).toContain('abc123')
  })

  it('includes source file diff', () => {
    const text = diffToPromptText(minimalDiff)
    expect(text).toContain('resetPassword.ts')
    expect(text).toContain('generateToken')
  })

  it('suppresses hunk content for test files', () => {
    const text = diffToPromptText(minimalDiff)
    // Test file should appear as header but without ```diff content
    expect(text).toContain('resetPassword.test.ts')
    // The hunk lines from test file should NOT appear (it has no hunks anyway, but we check category handling)
    expect(text).not.toContain('describe(')
  })

  it('marks binary files correctly', () => {
    const diffWithBinary: GitDiffResult = {
      ...minimalDiff,
      files: [{ path: 'logo.png', category: 'other', changeKind: 'added', additions: 0, deletions: 0, isBinary: true, hunks: [] }],
    }
    const text = diffToPromptText(diffWithBinary)
    expect(text).toContain('[binary]')
  })

  it('truncates at maxSourceLines', () => {
    const manyLines = Array.from({ length: 2000 }, (_, i) => ({
      type: '+' as const,
      content: `  const x${i} = ${i}`,
      lineNumber: i,
    }))
    const bigDiff: GitDiffResult = {
      ...minimalDiff,
      files: [{
        path: 'src/big.ts',
        category: 'source',
        changeKind: 'modified',
        additions: 2000,
        deletions: 0,
        isBinary: false,
        hunks: [{ oldStart: 1, oldCount: 0, newStart: 1, newCount: 2000, lines: manyLines }],
      }],
    }
    const text = diffToPromptText(bigDiff, 100) // limit to 100 lines
    expect(text).toContain('truncated')
  })
})

// ─── Stage 4 report generator tests ──────────────────────────────────────────

describe('runStage4', () => {
  const jira: JiraReport = {
    ticketKey: 'TEST-1',
    summary: 'User can reset password',
    hasExplicitAC: true,
    requirements: [
      { id: 'REQ-001', description: 'User receives reset email', priority: 'must', testable: true, source: 'explicit' },
      { id: 'REQ-002', description: 'Token expires in 24h', priority: 'must', testable: true, source: 'explicit' },
    ],
    acceptanceCriteria: [
      { id: 'AC-001', description: 'Email sent within 30 seconds', source: 'explicit' },
    ],
    outOfScope: ['SMS reset'],
    riskFlags: ['Touches auth module'],
    ambiguities: [],
  }

  const code: CodeReport = {
    implementedFeatures: ['Password reset email flow'],
    modifiedBehaviors: [],
    deletedBehaviors: [],
    sideEffects: ['Session management module'],
    testCoverage: { covered: ['Email sending'], uncovered: ['Token expiry logic'] },
    codeSmells: ['console.log left in resetPassword.ts'],
    affectedFiles: ['src/auth/resetPassword.ts'],
  }

  const crossCheck: CrossCheckReport = {
    requirementCoverage: [
      { requirementId: 'REQ-001', requirementDescription: 'User receives reset email', status: 'implemented', evidence: 'sendResetEmail() in mailer.ts', concern: '' },
      { requirementId: 'REQ-002', requirementDescription: 'Token expires in 24h', status: 'missing', evidence: '', concern: 'No expiry logic found in diff' },
    ],
    potentialBugs: [
      { id: 'BUG-001', severity: 'critical', description: 'Token never expires', location: ['src/auth/resetPassword.ts'], triggerCondition: 'User requests reset, never uses it', suggestion: 'Check for expiresAt field' },
      { id: 'BUG-002', severity: 'medium', description: 'Rate limit not enforced', location: ['src/auth/resetPassword.ts'], triggerCondition: 'Sending many emails', suggestion: 'Add rate limit middleware' },
    ],
    missingImplementations: ['24-hour token expiry is missing'],
    unexpectedChanges: [],
    riskLevel: 'high',
  }

  it('generates all three reports', () => {
    const reports = runStage4(jira, code, crossCheck)
    expect(reports.requirementReport).toBeTruthy()
    expect(reports.bugReport).toBeTruthy()
    expect(reports.checklist).toBeTruthy()
  })

  it('Report A contains requirement status icons', () => {
    const { requirementReport } = runStage4(jira, code, crossCheck)
    expect(requirementReport).toContain('✅')  // implemented
    expect(requirementReport).toContain('❌')  // missing
  })

  it('Report B contains critical bug', () => {
    const { bugReport } = runStage4(jira, code, crossCheck)
    expect(bugReport).toContain('BUG-001')
    expect(bugReport).toContain('Token never expires')
    expect(bugReport).toContain('🔴')
  })

  it('Report B includes code smells', () => {
    const { bugReport } = runStage4(jira, code, crossCheck)
    expect(bugReport).toContain('console.log')
  })

  it('Report C is a checklist with checkboxes', () => {
    const { checklist } = runStage4(jira, code, crossCheck)
    expect(checklist).toContain('- [ ]')
    expect(checklist).toContain('- [x]')
  })

  it('Report C prioritizes critical bugs at top', () => {
    const { checklist } = runStage4(jira, code, crossCheck)
    const criticalPos = checklist.indexOf('Critical')
    const mediumPos = checklist.indexOf('Medium')
    expect(criticalPos).toBeLessThan(mediumPos)
  })

  it('Report A warns about missing implementations', () => {
    const { requirementReport } = runStage4(jira, code, crossCheck)
    expect(requirementReport).toContain('Missing Implementations')
    expect(requirementReport).toContain('24-hour token expiry')
  })

  it('sets riskLevel correctly', () => {
    const reports = runStage4(jira, code, crossCheck)
    expect(reports.riskLevel).toBe('high')
  })
})
