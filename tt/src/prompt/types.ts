/**
 * prompt/types.ts
 *
 * Prompt 系统的核心类型定义。
 *
 * 设计原则：
 *   - PromptBlock  = 一个可复用的 prompt 片段（角色/任务/schema/规则…）
 *   - PromptSlot   = 运行时注入的动态槽位
 *   - PromptTemplate = 由 Block + Slot 组合而成的完整 prompt
 *   - 任何 Block 都可以是条件的（condition 为 false 时整块跳过）
 */

// ─── 基础构建块 ───────────────────────────────────────────────────────────────

/**
 * 一个静态 prompt 片段。
 * `section` 是可选的 markdown 标题，方便调试时定位。
 */
export interface PromptBlock {
  section?: string
  content: string
  /** 如果 false，整块被跳过。默认 true。 */
  enabled?: boolean
}

/**
 * 运行时动态注入的槽位。
 * value 是纯文本（可以很长），section 是它在 prompt 里的标题。
 */
export interface PromptSlot {
  section: string
  value: string
  /** 如果 value 为空，是否整个槽位跳过。默认 true（跳过空槽）。 */
  skipIfEmpty?: boolean
}

/**
 * 一个完整的 prompt 由 system + user 两部分组成。
 * 两部分都是 Block 数组，最终按顺序 join('\n\n') 拼接。
 */
export interface PromptTemplate {
  /** 给 LLM 的"全局角色设定" */
  system: Array<PromptBlock>
  /** 给 LLM 的"具体本次任务" */
  user: Array<PromptBlock | PromptSlot>
}

// ─── 构建结果 ────────────────────────────────────────────────────────────────

export interface BuiltPrompt {
  system: string
  user: string
  /** 调试用：记录哪些 block/slot 被包含/跳过 */
  debug: DebugRecord[]
}

export interface DebugRecord {
  section: string
  included: boolean
  reason?: string
  charCount?: number
}

// ─── Token 预算 ──────────────────────────────────────────────────────────────

/**
 * 用于控制动态内容（diff、Jira 描述）的最大字符数，
 * 避免单个注入内容把 context window 撑爆。
 */
export interface TokenBudget {
  /** system prompt 部分大约的 token 上限（粗估 1 token ≈ 4 chars） */
  systemBudget?: number
  /** user prompt 里动态内容的最大字符数 */
  dynamicContentMaxChars?: number
}
