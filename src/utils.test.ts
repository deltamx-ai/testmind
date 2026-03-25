import { describe, it, expect, vi } from 'vitest'
import { getLanguageFromPath, truncateDiff } from './utils.js'

describe('getLanguageFromPath', () => {
  it('maps common extensions', () => {
    expect(getLanguageFromPath('src/index.ts')).toBe('typescript')
    expect(getLanguageFromPath('app.jsx')).toBe('javascript')
    expect(getLanguageFromPath('main.py')).toBe('python')
    expect(getLanguageFromPath('main.go')).toBe('go')
    expect(getLanguageFromPath('lib.rs')).toBe('rust')
    expect(getLanguageFromPath('App.vue')).toBe('vue')
    expect(getLanguageFromPath('style.scss')).toBe('scss')
    expect(getLanguageFromPath('config.yaml')).toBe('yaml')
    expect(getLanguageFromPath('config.yml')).toBe('yaml')
    expect(getLanguageFromPath('Dockerfile')).toBe('dockerfile')
  })

  it('returns raw extension for unknown types', () => {
    expect(getLanguageFromPath('file.xyz')).toBe('xyz')
  })

  it('returns empty string for no extension', () => {
    // 'Makefile' -> extension is 'Makefile' (no dot), lowercased to 'makefile'
    expect(getLanguageFromPath('Makefile')).toBe('makefile')
  })
})

describe('truncateDiff', () => {
  it('returns full diff when under limit', () => {
    const diff = 'line1\nline2\nline3'
    expect(truncateDiff(diff, 10)).toBe(diff)
  })

  it('truncates long diffs with head/tail', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line${i}`)
    const diff = lines.join('\n')
    const result = truncateDiff(diff, 20)

    // Should have head (65% of 20 = 13) + omit message + tail (30% of 20 = 6)
    const resultLines = result.split('\n')
    expect(resultLines.length).toBeLessThan(100)
    expect(result).toContain('lines omitted')
    // First line preserved
    expect(result).toContain('line0')
    // Last line preserved
    expect(result).toContain('line99')
  })

  it('handles exact boundary', () => {
    const lines = Array.from({ length: 5 }, (_, i) => `line${i}`)
    const diff = lines.join('\n')
    expect(truncateDiff(diff, 5)).toBe(diff)
  })
})
