/**
 * prompt/inspect.ts
 *
 * Prompt 调试工具 — 把某个 Stage 的 prompt 组装好之后打印出来，
 * 不实际调用 LLM。
 *
 * 用法（加到 CLI）：
 *   testmind inspect --stage 1 --ticket PROJ-101
 *   testmind inspect --stage 3 --ticket PROJ-210 --show-chars
 *
 * 主要用途：
 *   1. 迭代 prompt 时快速看效果（不花 token）
 *   2. 调试某个 stage 为什么输出不对（看实际传给 LLM 的内容）
 *   3. 估算 token 数（1 token ≈ 4 chars）
 */

import chalk from 'chalk'
import type { JiraTicket } from '../types/index.js'
import { PromptBuilder } from './builder.js'
import {
  ROLE_QA_ANALYST, TASK_JIRA_ANALYSIS, AC_HAS_EXPLICIT, AC_MUST_INFER,
  RULE_PRIORITY_GUIDE, RULE_CONCISE, RULE_JSON_ONLY, SCHEMA_JIRA_REPORT,
  ROLE_SENIOR_ENGINEER, TASK_CODE_ANALYSIS, RULE_CODE_BUSINESS_LENS,
  SCHEMA_CODE_REPORT,
  ROLE_GAP_ANALYST, TASK_CROSSCHECK, RULE_CROSSCHECK_EVIDENCE,
  RULE_BUG_SEVERITY, RULE_RISK_LEVEL, SCHEMA_CROSSCHECK_REPORT,
} from './blocks.js'
import {
  jiraTicketSlot, gitDiffSlot, staticAnalysisSlot,
  techStackSlot, businessRulesSlot,
  jiraReportSlot, codeReportSlot,
} from './slots.js'
import type { GitDiffResult, JiraReport, CodeReport } from '../types/index.js'
import type { StaticAnalysisResult } from '../stages/stage2-code.js'

export interface InspectOptions {
  showChars?: boolean
  showDebug?: boolean
  maxPrintChars?: number
}

function printSection(title: string, content: string, opts: InspectOptions) {
  const { maxPrintChars = 4000, showChars = false } = opts
  const chars = content.length
  const tokens = Math.round(chars / 4)

  console.log(chalk.bold.yellow(`\n${'─'.repeat(60)}`))
  console.log(chalk.bold.yellow(`  ${title}`) + (showChars ? chalk.gray(` [${chars} chars ≈ ${tokens} tokens]`) : ''))
  console.log(chalk.bold.yellow(`${'─'.repeat(60)}`))

  if (content.length > maxPrintChars) {
    console.log(content.slice(0, maxPrintChars))
    console.log(chalk.gray(`\n…[${content.length - maxPrintChars} more chars omitted. Pass --max-chars N to see more]`))
  } else {
    console.log(content)
  }
}

// ─── Stage 1 inspect ─────────────────────────────────────────────────────────

export function inspectStage1(ticket: JiraTicket, opts: InspectOptions = {}) {
  const hasExplicitAC = ['acceptance criteria', 'done when', '验收标准']
    .some(kw => ticket.description?.toLowerCase().includes(kw))

  console.log(chalk.bold.cyan('\n  🔍 Stage 1 Prompt Inspection'))
  console.log(chalk.gray(`  Ticket: ${ticket.key} | hasExplicitAC: ${hasExplicitAC}`))

  const built = new PromptBuilder()
    .system(ROLE_QA_ANALYST)
    .system(TASK_JIRA_ANALYSIS)
    .systemIf(hasExplicitAC, AC_HAS_EXPLICIT, AC_MUST_INFER)
    .system(RULE_PRIORITY_GUIDE)
    .system(RULE_CONCISE)
    .system(SCHEMA_JIRA_REPORT)
    .system(RULE_JSON_ONLY)
    .user(jiraTicketSlot(ticket))
    .build(opts.showDebug)

  printSection('SYSTEM PROMPT', built.system, opts)
  printSection('USER PROMPT', built.user, opts)
  printTotals(built.system, built.user)
}

// ─── Stage 2 inspect ─────────────────────────────────────────────────────────

export function inspectStage2(
  diff: GitDiffResult,
  staticResult: StaticAnalysisResult,
  techStack?: string,
  opts: InspectOptions = {},
) {
  console.log(chalk.bold.cyan('\n  🔍 Stage 2 Prompt Inspection'))
  console.log(chalk.gray(`  Files: ${diff.files.length} | techStack: ${techStack ?? 'none'}`))

  const built = new PromptBuilder()
    .system(ROLE_SENIOR_ENGINEER)
    .system(TASK_CODE_ANALYSIS)
    .system(RULE_CODE_BUSINESS_LENS)
    .system(RULE_CONCISE)
    .system(SCHEMA_CODE_REPORT)
    .system(RULE_JSON_ONLY)
    .user(techStackSlot(techStack))
    .user(gitDiffSlot(diff, 1200))
    .user(staticAnalysisSlot(staticResult))
    .build(opts.showDebug)

  printSection('SYSTEM PROMPT', built.system, opts)
  printSection('USER PROMPT', built.user, opts)
  printTotals(built.system, built.user)
}

// ─── Stage 3 inspect ─────────────────────────────────────────────────────────

export function inspectStage3(
  jiraReport: JiraReport,
  codeReport: CodeReport,
  businessRules?: string[],
  opts: InspectOptions = {},
) {
  console.log(chalk.bold.cyan('\n  🔍 Stage 3 Prompt Inspection'))
  console.log(chalk.gray(
    `  Requirements: ${jiraReport.requirements.length} | ` +
    `BusinessRules: ${businessRules?.length ?? 0}`
  ))

  const built = new PromptBuilder()
    .system(ROLE_GAP_ANALYST)
    .system(TASK_CROSSCHECK)
    .system(RULE_CROSSCHECK_EVIDENCE)
    .system(RULE_BUG_SEVERITY)
    .system(RULE_RISK_LEVEL)
    .system(RULE_CONCISE)
    .system(SCHEMA_CROSSCHECK_REPORT)
    .system(RULE_JSON_ONLY)
    .user(jiraReportSlot(jiraReport))
    .user(codeReportSlot(codeReport))
    .user(businessRulesSlot(businessRules))
    .build(opts.showDebug)

  printSection('SYSTEM PROMPT', built.system, opts)
  printSection('USER PROMPT', built.user, opts)
  printTotals(built.system, built.user)
}

// ─── token 预算总结 ───────────────────────────────────────────────────────────

function printTotals(system: string, user: string) {
  const sysChars = system.length
  const userChars = user.length
  const total = sysChars + userChars
  const estTokens = Math.round(total / 4)

  // Claude Sonnet context window: ~200k tokens
  const ctxPct = ((estTokens / 200_000) * 100).toFixed(1)

  console.log(chalk.bold(`\n  ── Token Budget ─────────────────────────────────`))
  console.log(`  System:  ${sysChars.toLocaleString()} chars ≈ ${Math.round(sysChars / 4).toLocaleString()} tokens`)
  console.log(`  User:    ${userChars.toLocaleString()} chars ≈ ${Math.round(userChars / 4).toLocaleString()} tokens`)
  console.log(`  Total:   ${total.toLocaleString()} chars ≈ ${estTokens.toLocaleString()} tokens`)

  const color = estTokens > 50_000 ? chalk.red : estTokens > 20_000 ? chalk.yellow : chalk.green
  console.log(color(`  Context: ${ctxPct}% of Sonnet's 200k window`))
  console.log('')
}
