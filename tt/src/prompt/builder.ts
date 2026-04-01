/**
 * prompt/builder.ts
 *
 * PromptBuilder — 把 Block 和 Slot 组装成最终 prompt 字符串。
 *
 * 用法：
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

// ─── 辅助函数 ─────────────────────────────────────────────────────────────────

/** 创建一个简单 Block */
export function block(content: string, section?: string): PromptBlock {
  return { content, section }
}

/** 创建一个动态注入 Slot */
export function slot(section: string, value: string, skipIfEmpty = true): PromptSlot {
  return { section, value, skipIfEmpty }
}

/** 判断是否是 Slot（duck typing） */
function isSlot(x: PromptBlock | PromptSlot): x is PromptSlot {
  return 'value' in x
}

// ─── 构建器 ───────────────────────────────────────────────────────────────────

export class PromptBuilder {
  private _system: PromptBlock[] = []
  private _user: Array<PromptBlock | PromptSlot> = []

  /** 追加一个 system block */
  system(b: PromptBlock | string): this {
    this._system.push(typeof b === 'string' ? block(b) : b)
    return this
  }

  /** 条件追加 system block — condition 为 true 追加 ifBlock，否则追加 elseBlock */
  systemIf(condition: boolean, ifBlock: PromptBlock | string, elseBlock?: PromptBlock | string): this {
    if (condition) {
      this._system.push(typeof ifBlock === 'string' ? block(ifBlock) : ifBlock)
    } else if (elseBlock !== undefined) {
      this._system.push(typeof elseBlock === 'string' ? block(elseBlock) : elseBlock)
    }
    return this
  }

  /** 追加纯文本 system block（无 section 标题） */
  systemConst(text: string): this {
    this._system.push(block(text))
    return this
  }

  /** 追加一个 user block 或 slot */
  user(b: PromptBlock | PromptSlot | string): this {
    if (typeof b === 'string') {
      this._user.push(block(b))
    } else {
      this._user.push(b)
    }
    return this
  }

  /** 条件追加 user block/slot */
  userIf(condition: boolean, item: PromptBlock | PromptSlot | string): this {
    if (condition) this.user(item)
    return this
  }

  /** 构建最终 prompt */
  build(debug = false): BuiltPrompt {
    const debugRecords: DebugRecord[] = []

    // ── 拼 system ─────────────────────────────────────────────────────────────
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

    // ── 拼 user ───────────────────────────────────────────────────────────────
    const userParts: string[] = []
    for (const item of this._user) {
      if (isSlot(item)) {
        const isEmpty = !item.value.trim()
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

    if (debug) {
      console.group('[PromptBuilder] Debug')
      for (const r of debugRecords) {
        const status = r.included ? '✓' : '✗'
        console.log(`${status} ${r.section} (${r.charCount ?? 0} chars)${r.reason ? ` — ${r.reason}` : ''}`)
      }
      console.groupEnd()
    }

    return {
      system: systemParts.join('\n\n'),
      user: userParts.join('\n\n---\n\n'),
      debug: debugRecords,
    }
  }
}
