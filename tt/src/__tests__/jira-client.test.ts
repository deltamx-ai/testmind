/**
 * Tests for Jira client (mock mode).
 */

import { describe, it, expect } from 'vitest'
import { createJiraClient, MOCK_TICKET_KEYS } from '../jira/client.js'

describe('MockJiraClient', () => {
  const client = createJiraClient({ mode: 'mock' })

  it('returns known fixture tickets', async () => {
    const ticket = await client.getTicket('PROJ-101')
    expect(ticket.key).toBe('PROJ-101')
    expect(ticket.summary).toContain('reset password')
    expect(ticket.type).toBe('Story')
  })

  it('returns PROJ-210 bug ticket', async () => {
    const ticket = await client.getTicket('PROJ-210')
    expect(ticket.key).toBe('PROJ-210')
    expect(ticket.type).toBe('Bug')
    expect(ticket.priority).toBe('Highest')
  })

  it('returns PROJ-315 task ticket', async () => {
    const ticket = await client.getTicket('PROJ-315')
    expect(ticket.key).toBe('PROJ-315')
    expect(ticket.type).toBe('Task')
  })

  it('throws on unknown ticket key', async () => {
    await expect(client.getTicket('UNKNOWN-999')).rejects.toThrow('No fixture')
  })

  it('MOCK_TICKET_KEYS lists available tickets', () => {
    expect(MOCK_TICKET_KEYS).toContain('PROJ-101')
    expect(MOCK_TICKET_KEYS).toContain('PROJ-210')
    expect(MOCK_TICKET_KEYS).toContain('PROJ-315')
  })

  it('ticket has expected structure', async () => {
    const ticket = await client.getTicket('PROJ-101')
    expect(ticket.description).toBeTruthy()
    expect(ticket.comments).toBeInstanceOf(Array)
    expect(ticket.comments.length).toBeGreaterThan(0)
    expect(ticket.labels).toBeInstanceOf(Array)
    expect(ticket.subtasks).toBeInstanceOf(Array)
  })

  it('ticket with AC has acceptanceCriteria field', async () => {
    const ticket = await client.getTicket('PROJ-101')
    expect(ticket.acceptanceCriteria).toBeTruthy()
    expect(ticket.acceptanceCriteria).toContain('AC1')
  })

  it('bug ticket has no explicit AC', async () => {
    const ticket = await client.getTicket('PROJ-210')
    expect(ticket.acceptanceCriteria).toBeUndefined()
  })
})

describe('createJiraClient', () => {
  it('throws when real mode lacks baseUrl', () => {
    expect(() => createJiraClient({ mode: 'real', token: 'tok' })).toThrow('baseUrl')
  })

  it('throws when real mode lacks token', () => {
    expect(() => createJiraClient({ mode: 'real', baseUrl: 'https://jira.example.com' })).toThrow('token')
  })
})
