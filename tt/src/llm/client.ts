/**
 * llm/client.ts
 *
 * Thin wrapper around @anthropic-ai/sdk that:
 *   1. Manages the Anthropic client singleton
 *   2. Provides a `callLLM` helper with retry logic
 *   3. Provides `extractJSON` to safely parse LLM JSON output
 *   4. Tracks token usage across the pipeline run
 */

import Anthropic from '@anthropic-ai/sdk'

// ─── singleton ────────────────────────────────────────────────────────────────

let _client: Anthropic | null = null

function getClient(): Anthropic {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY environment variable is not set.\n' +
          'Export it before running: export ANTHROPIC_API_KEY=sk-ant-...',
      )
    }
    _client = new Anthropic({ apiKey })
  }
  return _client
}

// ─── token usage tracker ─────────────────────────────────────────────────────

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  calls: number
}

const _usage: TokenUsage = { inputTokens: 0, outputTokens: 0, calls: 0 }

export function getUsage(): Readonly<TokenUsage> {
  return Object.freeze({ ..._usage })
}

export function resetUsage(): void {
  _usage.inputTokens = 0
  _usage.outputTokens = 0
  _usage.calls = 0
}

// ─── core call helper ─────────────────────────────────────────────────────────

export interface LLMCallOptions {
  system: string
  userPrompt: string
  /** Default: claude-sonnet-4-20250514 */
  model?: string
  /** Default: 4096 */
  maxTokens?: number
  /** Default: 2 */
  maxRetries?: number
  /** Temperature 0 = deterministic; default 0.2 */
  temperature?: number
}

export async function callLLM(opts: LLMCallOptions): Promise<string> {
  const {
    system,
    userPrompt,
    model = process.env.TESTMIND_MODEL ?? 'claude-sonnet-4-20250514',
    maxTokens = 4096,
    maxRetries = 2,
    temperature = 0.2,
  } = opts

  const client = getClient()
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        temperature,
        system,
        messages: [{ role: 'user', content: userPrompt }],
      })

      // Track usage
      _usage.inputTokens += response.usage.input_tokens
      _usage.outputTokens += response.usage.output_tokens
      _usage.calls++

      const text = response.content
        .filter((b) => b.type === 'text')
        .map((b) => (b as Anthropic.TextBlock).text)
        .join('')

      return text
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (attempt < maxRetries) {
        const delay = 1000 * 2 ** attempt
        await sleep(delay)
      }
    }
  }

  throw lastError ?? new Error('LLM call failed after retries')
}

// ─── JSON extraction ─────────────────────────────────────────────────────────

/**
 * Extract and parse JSON from an LLM response.
 * Handles cases where the model wraps output in ```json … ``` fences.
 */
export function extractJSON<T = unknown>(raw: string): T {
  // Strip markdown code fences if present
  const stripped = raw
    .replace(/^```(?:json)?\s*/m, '')
    .replace(/\s*```\s*$/m, '')
    .trim()

  // Find the first { or [ and its matching close bracket using depth tracking
  const firstBrace = stripped.search(/[{[]/)
  if (firstBrace === -1) {
    throw new Error(`No JSON object found in LLM response:\n${raw.slice(0, 500)}`)
  }

  const openChar = stripped[firstBrace]
  const closeChar = openChar === '{' ? '}' : ']'

  // Walk forward with depth counting to find the correctly matched closing bracket
  let depth = 0
  let inString = false
  let escaped = false
  let matchEnd = -1

  for (let i = firstBrace; i < stripped.length; i++) {
    const ch = stripped[i]

    if (escaped) { escaped = false; continue }
    if (ch === '\\' && inString) { escaped = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue

    if (ch === openChar) depth++
    else if (ch === closeChar) {
      depth--
      if (depth === 0) { matchEnd = i; break }
    }
  }

  if (matchEnd === -1) {
    throw new Error(`Unclosed JSON in LLM response (unmatched ${openChar}):\n${raw.slice(0, 500)}`)
  }

  const jsonStr = stripped.slice(firstBrace, matchEnd + 1)

  try {
    return JSON.parse(jsonStr) as T
  } catch (err) {
    throw new Error(
      `JSON parse error: ${err instanceof Error ? err.message : String(err)}\n` +
        `Raw JSON (first 800 chars):\n${jsonStr.slice(0, 800)}`,
    )
  }
}

// ─── prompt building utilities ────────────────────────────────────────────────

/**
 * Instruct the model to respond ONLY with JSON.
 * Attach this as the last line of every system prompt in JSON-output stages.
 */
export const JSON_ONLY_INSTRUCTION = `
IMPORTANT: Your response MUST be valid JSON only.
Do NOT include any prose, explanation, or markdown fences before or after the JSON.
Output the JSON object directly, starting with { and ending with }.
`.trim()

// ─── helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
