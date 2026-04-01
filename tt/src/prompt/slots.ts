/**
 * prompt/slots.ts
 *
 * 运行时动态注入的 Slot 构建函数。
 *
 * 每个函数接收原始数据，返回压缩好的、适合注入到 prompt 的文本。
 * 压缩原则：
 *   1. 去掉对 LLM 无意义的格式（空行过多、markdown 嵌套）
 *   2. 超长内容截断（防止吃掉整个 context window）
 *   3. 高信息密度：每行都要有意义
 */

import type { JiraTicket, JiraReport, CodeReport } from '../types/index.js'
import { diffToPromptText } from '../git/analyzer.js'
import type { GitDiffResult } from '../types/index.js'
import type { StaticAnalysisResult } from '../stages/stage2-code.js'
import { slot } from './builder.js'
import type { PromptSlot } from './types.js'

// ─── Jira 相关 slots ──────────────────────────────────────────────────────────

/**
 * 把 JiraTicket 原始数据压缩成 LLM 友好的文本。
 *
 * 信息优先级：
 *   summary > acceptanceCriteria > description > comments > metadata
 */
export function jiraTicketSlot(ticket: JiraTicket, maxDescChars = 3000): PromptSlot {
  const lines: string[] = []

  lines.push(`Ticket: ${ticket.key} [${ticket.type}] Priority: ${ticket.priority}`)
  lines.push(`Summary: ${ticket.summary}`)
  lines.push('')

  // AC 最优先 — 如果有就放在最前面
  if (ticket.acceptanceCriteria?.trim()) {
    lines.push('=== Acceptance Criteria (explicitly written in ticket) ===')
    lines.push(ticket.acceptanceCriteria.trim())
    lines.push('')
  }

  // Description — 截断超长内容
  const desc = ticket.description?.trim() ?? ''
  if (desc) {
    lines.push('=== Description ===')
    lines.push(desc.length > maxDescChars ? desc.slice(0, maxDescChars) + '\n…[truncated]' : desc)
    lines.push('')
  }

  // Comments — 按时间排序，保留最新的（LLM 会优先看后面的）
  if (ticket.comments.length > 0) {
    lines.push('=== Comments (may contain requirement updates) ===')
    // 只保留最近 6 条，避免填满 context
    const recent = ticket.comments.slice(-6)
    for (const c of recent) {
      lines.push(`[${c.author} @ ${c.createdAt.slice(0, 10)}]: ${c.body.trim()}`)
    }
    lines.push('')
  }

  // Metadata
  const meta: string[] = []
  if (ticket.labels.length > 0)       meta.push(`Labels: ${ticket.labels.join(', ')}`)
  if (ticket.subtasks.length > 0)     meta.push(`Subtasks: ${ticket.subtasks.join(', ')}`)
  if (ticket.linkedIssues.length > 0) meta.push(`Linked: ${ticket.linkedIssues.join(', ')}`)
  if (meta.length > 0) lines.push(meta.join(' | '))

  return slot('Jira Ticket', lines.join('\n'))
}

/**
 * Stage 3 用：把 JiraReport（已结构化）注入给 LLM。
 * 此时 LLM 不需要解析原始 Jira 文本 — 直接对着 requirements 列表做 gap 分析。
 */
export function jiraReportSlot(report: JiraReport): PromptSlot {
  const lines: string[] = []

  lines.push(`Ticket: ${report.ticketKey}`)
  lines.push(`Summary: ${report.summary}`)
  lines.push('')

  if (!report.hasExplicitAC) {
    lines.push('⚠️  NOTE: No explicit AC in ticket — requirements below are INFERRED by AI.')
    lines.push('')
  }

  lines.push('=== Requirements ===')
  for (const r of report.requirements) {
    const inferred = r.source === 'inferred' ? ' [inferred]' : ''
    lines.push(`[${r.id}] (${r.priority}) ${r.description}${inferred}`)
  }
  lines.push('')

  lines.push('=== Acceptance Criteria ===')
  for (const ac of report.acceptanceCriteria) {
    const inferred = ac.source === 'inferred' ? ' [inferred]' : ''
    lines.push(`[${ac.id}] ${ac.description}${inferred}`)
  }
  lines.push('')

  if (report.outOfScope.length > 0) {
    lines.push('=== Out of Scope ===')
    report.outOfScope.forEach(o => lines.push(`- ${o}`))
    lines.push('')
  }

  if (report.riskFlags.length > 0) {
    lines.push('=== Risk Flags ===')
    report.riskFlags.forEach(r => lines.push(`- ${r}`))
    lines.push('')
  }

  if (report.ambiguities.length > 0) {
    lines.push('=== Ambiguities ===')
    report.ambiguities.forEach(a => lines.push(`- ${a}`))
  }

  return slot('Jira Specification', lines.join('\n'))
}

// ─── Git diff 相关 slots ──────────────────────────────────────────────────────

/**
 * 把 GitDiffResult 压缩成适合 LLM 的文本。
 * 使用 diffToPromptText 截断过大的 diff，只保留 source 文件的 hunk。
 */
export function gitDiffSlot(diff: GitDiffResult, maxSourceLines = 1200): PromptSlot {
  const text = diffToPromptText(diff, maxSourceLines)
  return slot('Git Diff', text)
}

/**
 * 把静态分析结果注入 Stage 2 prompt。
 * 给 LLM 提供已经计算好的测试覆盖缺口，避免 LLM 自己猜。
 */
export function staticAnalysisSlot(analysis: StaticAnalysisResult): PromptSlot {
  const lines: string[] = []

  lines.push(`Source files changed (${analysis.sourceFiles.length}):`)
  lines.push(analysis.sourceFiles.join(', ') || '  (none)')
  lines.push('')

  lines.push(`Test files changed (${analysis.testFiles.length}):`)
  lines.push(analysis.testFiles.join(', ') || '  (none)')
  lines.push('')

  lines.push(`Source files with NO test changes (coverage gap):`)
  lines.push(analysis.untestedSourceFiles.join(', ') || '  (all covered)')
  lines.push('')

  if (analysis.migrationFiles.length > 0) {
    lines.push(`DB migrations: ${analysis.migrationFiles.join(', ')}`)
  }

  if (analysis.apiSchemaFiles.length > 0) {
    lines.push(`API schema changes: ${analysis.apiSchemaFiles.join(', ')}`)
  }

  if (analysis.codeSmellHints.length > 0) {
    lines.push('')
    lines.push('Pre-detected code smells (static regex scan):')
    analysis.codeSmellHints.forEach(h => lines.push(`  - ${h}`))
  }

  return slot('Static Analysis Findings', lines.join('\n'))
}

// ─── Stage 3 用：CodeReport slot ─────────────────────────────────────────────

/**
 * 把 CodeReport（已结构化）注入给 Stage 3 的 LLM。
 */
export function codeReportSlot(report: CodeReport): PromptSlot {
  const lines: string[] = []

  lines.push('=== Implemented Features ===')
  if (report.implementedFeatures.length === 0) {
    lines.push('(none identified)')
  } else {
    report.implementedFeatures.forEach(f => lines.push(`- ${f}`))
  }
  lines.push('')

  lines.push('=== Modified Behaviors ===')
  if (report.modifiedBehaviors.length === 0) {
    lines.push('(none)')
  } else {
    report.modifiedBehaviors.forEach(b => lines.push(`- ${b}`))
  }
  lines.push('')

  lines.push('=== Deleted Behaviors ===')
  if (report.deletedBehaviors.length === 0) {
    lines.push('(none)')
  } else {
    report.deletedBehaviors.forEach(b => lines.push(`- ${b}`))
  }
  lines.push('')

  lines.push('=== Side Effects ===')
  if (report.sideEffects.length === 0) {
    lines.push('(none identified)')
  } else {
    report.sideEffects.forEach(s => lines.push(`- ${s}`))
  }
  lines.push('')

  lines.push('=== Test Coverage ===')
  lines.push('Covered:')
  if (report.testCoverage.covered.length === 0) {
    lines.push('  (none)')
  } else {
    report.testCoverage.covered.forEach(c => lines.push(`  - ${c}`))
  }
  lines.push('NOT covered:')
  if (report.testCoverage.uncovered.length === 0) {
    lines.push('  (all changes appear tested)')
  } else {
    report.testCoverage.uncovered.forEach(u => lines.push(`  - ${u}`))
  }

  return slot('Code Implementation Summary', lines.join('\n'))
}

// ─── 可选上下文 slots ─────────────────────────────────────────────────────────

/**
 * 注入技术栈信息（来自 .testmindrc.json 的 techStack 字段）。
 * 让 LLM 给出更精准的建议（比如"用 zod 校验"而不是"用某种方式校验"）。
 */
export function techStackSlot(techStack?: string): PromptSlot {
  return slot('Tech Stack Context', techStack ?? '', true)
}

/**
 * 注入业务规则（来自 .testmindrc.json 的 businessRules 字段）。
 * Stage 3 用 — LLM 会把这些规则当作额外的 checklist 去比对。
 */
export function businessRulesSlot(rules?: string[]): PromptSlot {
  if (!rules || rules.length === 0) return slot('Business Rules', '', true)
  const text = [
    'Always verify the following project-level rules apply to this change:',
    ...rules.map(r => `- ${r}`),
  ].join('\n')
  return slot('Project Business Rules', text)
}
