/**
 * Tests for PromptBuilder and related utilities.
 */

import { describe, it, expect } from 'vitest'
import { PromptBuilder, block, slot } from '../prompt/builder.js'

describe('PromptBuilder', () => {
  it('builds simple system + user prompt', () => {
    const result = new PromptBuilder()
      .system('You are a QA engineer.')
      .user('Analyze this ticket.')
      .build()

    expect(result.system).toBe('You are a QA engineer.')
    expect(result.user).toBe('Analyze this ticket.')
  })

  it('joins multiple system blocks with double newline', () => {
    const result = new PromptBuilder()
      .system('Role: QA')
      .system('Task: Analyze')
      .build()

    expect(result.system).toBe('Role: QA\n\nTask: Analyze')
  })

  it('adds section headers to blocks with section', () => {
    const result = new PromptBuilder()
      .system(block('You are QA.', 'Role'))
      .build()

    expect(result.system).toBe('## Role\nYou are QA.')
  })

  it('systemIf includes ifBlock when true', () => {
    const result = new PromptBuilder()
      .systemIf(true, block('Has AC', 'AC'))
      .build()

    expect(result.system).toContain('Has AC')
  })

  it('systemIf includes elseBlock when false', () => {
    const result = new PromptBuilder()
      .systemIf(false, block('Has AC'), block('No AC'))
      .build()

    expect(result.system).toContain('No AC')
  })

  it('systemIf skips when false and no elseBlock', () => {
    const result = new PromptBuilder()
      .systemIf(false, block('Optional'))
      .build()

    expect(result.system).toBe('')
  })

  it('user slots are rendered with section headers', () => {
    const result = new PromptBuilder()
      .user(slot('Ticket', 'PROJ-101 details'))
      .build()

    expect(result.user).toContain('## Ticket')
    expect(result.user).toContain('PROJ-101 details')
  })

  it('empty slots are skipped when skipIfEmpty=true', () => {
    const result = new PromptBuilder()
      .user(slot('Empty', '', true))
      .user(slot('Present', 'data'))
      .build()

    expect(result.user).not.toContain('Empty')
    expect(result.user).toContain('Present')
  })

  it('empty slots are included when skipIfEmpty=false', () => {
    const result = new PromptBuilder()
      .user(slot('Empty', '', false))
      .build()

    expect(result.user).toContain('Empty')
  })

  it('disabled blocks are skipped', () => {
    const result = new PromptBuilder()
      .system({ content: 'disabled', enabled: false })
      .system({ content: 'enabled' })
      .build()

    expect(result.system).not.toContain('disabled')
    expect(result.system).toContain('enabled')
  })

  it('debug records track inclusion', () => {
    const result = new PromptBuilder()
      .system(block('included', 'A'))
      .system({ content: 'excluded', section: 'B', enabled: false })
      .user(slot('C', 'data'))
      .user(slot('D', ''))
      .build()

    expect(result.debug).toHaveLength(4)
    expect(result.debug[0]).toMatchObject({ section: 'A', included: true })
    expect(result.debug[1]).toMatchObject({ section: 'B', included: false })
    expect(result.debug[2]).toMatchObject({ section: 'C', included: true })
    expect(result.debug[3]).toMatchObject({ section: 'D', included: false, reason: 'empty slot skipped' })
  })

  it('userIf includes when condition true', () => {
    const result = new PromptBuilder()
      .userIf(true, slot('Tech', 'React'))
      .build()

    expect(result.user).toContain('React')
  })

  it('userIf skips when condition false', () => {
    const result = new PromptBuilder()
      .userIf(false, slot('Tech', 'React'))
      .build()

    expect(result.user).toBe('')
  })

  it('user parts are joined with separator', () => {
    const result = new PromptBuilder()
      .user(slot('A', 'data-a'))
      .user(slot('B', 'data-b'))
      .build()

    expect(result.user).toContain('---')
  })
})

describe('block helper', () => {
  it('creates block without section', () => {
    const b = block('content')
    expect(b.content).toBe('content')
    expect(b.section).toBeUndefined()
  })

  it('creates block with section', () => {
    const b = block('content', 'Title')
    expect(b.section).toBe('Title')
  })
})

describe('slot helper', () => {
  it('creates slot with defaults', () => {
    const s = slot('Title', 'value')
    expect(s.section).toBe('Title')
    expect(s.value).toBe('value')
    expect(s.skipIfEmpty).toBe(true)
  })

  it('creates slot with skipIfEmpty=false', () => {
    const s = slot('Title', '', false)
    expect(s.skipIfEmpty).toBe(false)
  })
})
