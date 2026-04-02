/**
 * prompt/builder.ts
 *
 * PromptBuilder — assembles Blocks and Slots into final prompt strings.
 *
 * Usage:
 *   const prompt = new PromptBuilder()
 *     .system(ROLE_QA_ENGINEER)
 *     .system(TASK_JIRA_ANALYSIS)
 *     .systemIf(hasExplicitAC, AC_EXTRACT_BLOCK, AC_INFER_BLOCK)
 *     .systemConst(JSON_ONLY_INSTRUCTION)
 *     .user(slot('Jira Ticket', ticketText))
 *     .user(slot('Output Schema', JIRA_REPORT_SCHEMA))
 *     .build()
 */

import type {
  PromptBlock,
  PromptSlot,
  PromptTemplate,
  BuiltPrompt,
  DebugRecord,
} from './types.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Create a simple Block */
export function block(content: string, section?: string): PromptBlock {
  return { content, section }
}

/** Create a dynamic injection Slot */
export function slot(section: string, value: string, skipIfEmpty = true): PromptSlot {
  return { section, value, skipIfEmpty }
}

/** Check if item is a Slot (duck typing) */
function isSlot(x: PromptBlock | PromptSlot): x is PromptSlot {
  return 'value' in x
}

// ─── Builder ─────────────────────────────────────────────────────────────────

export class PromptBuilder {
  private _system: PromptBlock[] = []
  private _user: Array<PromptBlock | PromptSlot> = []

  /** Append a system block */
  system(b: PromptBlock | string): this {
    this._system.push(typeof b === 'string' ? block(b) : b)
    return this
  }

  /** Conditionally append system block — if condition is true append ifBlock, otherwise elseBlock */
  systemIf(condition: boolean, ifBlock: PromptBlock | string, elseBlock?: PromptBlock | string): this {
    if (condition) {
      this._system.push(typeof ifBlock === 'string' ? block(ifBlock) : ifBlock)
    } else if (elseBlock !== undefined) {
      this._system.push(typeof elseBlock === 'string' ? block(elseBlock) : elseBlock)
    }
    return this
  }

  /** Append plain text system block (no section header) */
  systemConst(text: string): this {
    this._system.push(block(text))
    return this
  }

  /** Append a user block or slot */
  user(b: PromptBlock | PromptSlot | string): this {
    if (typeof b === 'string') {
      this._user.push(block(b))
    } else {
      this._user.push(b)
    }
    return this
  }

  /** Conditionally append user block/slot */
  userIf(condition: boolean, item: PromptBlock | PromptSlot | string): this {
    if (condition) this.user(item)
    return this
  }

  /** Build the final prompt */
  build(debug = false): BuiltPrompt {
    const debugRecords: DebugRecord[] = []

    // ── Build system ─────────────────────────────────────────────────────────
    const systemParts: string[] = []
    for (const b of this._system) {
      const enabled = b.enabled !== false
      const rec: DebugRecord = {
        section: b.section ?? '(unnamed block)',
        included: enabled,
        charCount: b.content.length,
      }
      if (!enabled) { rec.reason = 'enabled=false'; debugRecords.push(rec); continue }
      systemParts.push(b.section ? `## ${b.section}\n${b.content}` : b.content)
      debugRecords.push(rec)
    }

    // ── Build user ───────────────────────────────────────────────────────────
    const userParts: string[] = []
    for (const item of this._user) {
      if (isSlot(item)) {
        const isEmpty = !item.value || !item.value.trim()
        const skip = isEmpty && (item.skipIfEmpty !== false)
        const rec: DebugRecord = {
          section: item.section,
          included: !skip,
          charCount: item.value.length,
          reason: skip ? 'empty slot skipped' : undefined,
        }
        if (!skip) {
          userParts.push(`## ${item.section}\n\n${item.value}`)
        }
        debugRecords.push(rec)
      } else {
        const enabled = item.enabled !== false
        const rec: DebugRecord = {
          section: item.section ?? '(block)',
          included: enabled,
          charCount: item.content.length,
        }
        if (enabled) {
          userParts.push(item.section ? `## ${item.section}\n${item.content}` : item.content)
        }
        debugRecords.push(rec)
      }
    }

    return {
      system: systemParts.join('\n\n'),
      user: userParts.join('\n\n---\n\n'),
      debug: debugRecords,
    }
  }
}
