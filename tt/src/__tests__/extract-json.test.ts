/**
 * Tests for extractJSON - the LLM JSON parsing utility.
 */

import { describe, it, expect } from 'vitest'
import { extractJSON } from '../llm/client.js'

describe('extractJSON', () => {
  it('parses plain JSON object', () => {
    const result = extractJSON<{ name: string }>('{"name": "test"}')
    expect(result).toEqual({ name: 'test' })
  })

  it('parses JSON wrapped in markdown fences', () => {
    const raw = '```json\n{"name": "test"}\n```'
    const result = extractJSON<{ name: string }>(raw)
    expect(result).toEqual({ name: 'test' })
  })

  it('parses JSON with surrounding prose', () => {
    const raw = 'Here is the analysis:\n{"requirements": [{"id": "REQ-001"}]}\nDone.'
    const result = extractJSON<{ requirements: Array<{ id: string }> }>(raw)
    expect(result.requirements[0].id).toBe('REQ-001')
  })

  it('handles nested braces correctly', () => {
    const raw = '{"a": {"b": {"c": 1}}, "d": [1,2,3]}'
    const result = extractJSON<{ a: { b: { c: number } }; d: number[] }>(raw)
    expect(result.a.b.c).toBe(1)
    expect(result.d).toEqual([1, 2, 3])
  })

  it('handles JSON with strings containing braces', () => {
    const raw = '{"description": "Use {braces} in text", "count": 1}'
    const result = extractJSON<{ description: string; count: number }>(raw)
    expect(result.description).toBe('Use {braces} in text')
    expect(result.count).toBe(1)
  })

  it('handles JSON arrays', () => {
    const raw = '[1, 2, 3]'
    const result = extractJSON<number[]>(raw)
    expect(result).toEqual([1, 2, 3])
  })

  it('throws on empty input', () => {
    expect(() => extractJSON('')).toThrow('No JSON object found')
  })

  it('throws on unclosed JSON', () => {
    expect(() => extractJSON('{"name": "test"')).toThrow('Unclosed JSON')
  })

  it('throws on invalid JSON content', () => {
    expect(() => extractJSON('{name: test}')).toThrow('JSON parse error')
  })

  it('handles escaped quotes in strings', () => {
    const raw = '{"text": "he said \\"hello\\""}'
    const result = extractJSON<{ text: string }>(raw)
    expect(result.text).toBe('he said "hello"')
  })

  it('ignores trailing content after matched JSON', () => {
    const raw = '{"valid": true} some extra text {"another": "object"}'
    const result = extractJSON<{ valid: boolean }>(raw)
    expect(result).toEqual({ valid: true })
  })
})
