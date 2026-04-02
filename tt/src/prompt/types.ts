/**
 * prompt/types.ts
 *
 * Core type definitions for the prompt system.
 *
 * Design principles:
 *   - PromptBlock  = a reusable prompt fragment (role/task/schema/rule...)
 *   - PromptSlot   = a runtime-injected dynamic slot
 *   - PromptTemplate = a complete prompt composed of Blocks + Slots
 *   - Any Block can be conditional (skipped when enabled=false)
 */

// ─── Building blocks ─────────────────────────────────────────────────────────

/**
 * A static prompt fragment.
 * `section` is an optional markdown heading for debugging/identification.
 */
export interface PromptBlock {
  section?: string
  content: string
  /** If false, this block is skipped entirely. Default true. */
  enabled?: boolean
}

/**
 * A runtime dynamic injection slot.
 * `value` is plain text (can be long), `section` is its heading in the prompt.
 */
export interface PromptSlot {
  section: string
  value: string
  /** If value is empty, skip this entire slot. Default true (skip empty). */
  skipIfEmpty?: boolean
}

/**
 * A complete prompt consists of system + user parts.
 * Both parts are Block arrays, joined with '\n\n' in order.
 */
export interface PromptTemplate {
  /** Global role setup for the LLM */
  system: Array<PromptBlock>
  /** Specific task content for this invocation */
  user: Array<PromptBlock | PromptSlot>
}

// ─── Build result ────────────────────────────────────────────────────────────

export interface BuiltPrompt {
  system: string
  user: string
  /** Debug info: which blocks/slots were included/skipped */
  debug: DebugRecord[]
}

export interface DebugRecord {
  section: string
  included: boolean
  reason?: string
  charCount?: number
}

// ─── Token budget ────────────────────────────────────────────────────────────

/**
 * Controls max character counts for dynamic content (diffs, Jira descriptions),
 * preventing a single injection from exhausting the context window.
 */
export interface TokenBudget {
  /** Approximate token limit for the system prompt (rough estimate: 1 token ~ 4 chars) */
  systemBudget?: number
  /** Max characters for dynamic content in the user prompt */
  dynamicContentMaxChars?: number
}
