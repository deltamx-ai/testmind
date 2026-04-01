/**
 * stages/stage3-crosscheck.ts  (重写版)
 *
 * Stage 3 是整个 pipeline 中 prompt 最复杂的一步：
 *   - 两份结构化数据（JiraReport + CodeReport）同时注入
 *   - businessRules 条件注入（有配置才加）
 *   - 多个规则约束块叠加
 */

import type {
  JiraReport, CodeReport, CrossCheckReport,
  RequirementCheck, PotentialBug, RiskLevel,
} from '../types/index.js'
import { callLLM, extractJSON } from '../llm/client.js'
import { PromptBuilder } from '../prompt/builder.js'
import {
  ROLE_GAP_ANALYST,
  TASK_CROSSCHECK,
  RULE_CROSSCHECK_EVIDENCE,
  RULE_BUG_SEVERITY,
  RULE_RISK_LEVEL,
  RULE_CONCISE,
  RULE_JSON_ONLY,
  SCHEMA_CROSSCHECK_REPORT,
} from '../prompt/blocks.js'
import { jiraReportSlot, codeReportSlot, businessRulesSlot } from '../prompt/slots.js'

interface LLMCrossCheck {
  requirementCoverage: Array<{
    requirementId: string; requirementDescription: string
    status: 'implemented' | 'partial' | 'missing' | 'unclear'
    evidence: string; concern: string
  }>
  potentialBugs: Array<{
    id: string; severity: 'critical' | 'high' | 'medium' | 'low'
    description: string; location: string[]
    triggerCondition: string; suggestion: string
  }>
  missingImplementations: string[]
  unexpectedChanges: string[]
  riskLevel: 'high' | 'medium' | 'low'
}

export async function runStage3(
  jiraReport: JiraReport,
  codeReport: CodeReport,
  businessRules?: string[],
): Promise<CrossCheckReport> {

  // ── Prompt 组装 ───────────────────────────────────────────────────────────
  //
  // System:
  //   角色 → 任务 → 证据规则 → severity 分级 → 风险分级 → 简洁规则 → schema → JSON约束
  //
  // User:
  //   JiraReport（已结构化，LLM 不需要解析原始 Jira）
  //   CodeReport（已结构化，LLM 不需要解析原始 diff）
  //   businessRules（条件注入，为空时整个 slot 被跳过）

  const { system, user } = new PromptBuilder()
    .system(ROLE_GAP_ANALYST)
    .system(TASK_CROSSCHECK)
    .system(RULE_CROSSCHECK_EVIDENCE)
    .system(RULE_BUG_SEVERITY)
    .system(RULE_RISK_LEVEL)
    .system(RULE_CONCISE)
    .system(SCHEMA_CROSSCHECK_REPORT)
    .system(RULE_JSON_ONLY)
    // Jira spec — 来自 Stage 1 输出（已经是干净的结构化文本）
    .user(jiraReportSlot(jiraReport))
    // Code summary — 来自 Stage 2 输出（同上）
    .user(codeReportSlot(codeReport))
    // 业务规则 — 只有 .testmindrc.json 配置了才注入，否则 slot 被跳过
    .user(businessRulesSlot(businessRules))
    .build()

  // Stage 3 内容最多，给更大的 token 预算
  const raw = await callLLM({
    system,
    userPrompt: user,
    maxTokens: 5000,
    temperature: 0.15,
  })

  const parsed = extractJSON<LLMCrossCheck>(raw)

  const requirementCoverage: RequirementCheck[] = (parsed.requirementCoverage ?? []).map(r => ({
    requirementId: r.requirementId ?? '',
    requirementDescription: r.requirementDescription ?? '',
    status: r.status ?? 'unclear',
    evidence: r.evidence ?? '',
    concern: r.concern ?? '',
  }))

  const potentialBugs: PotentialBug[] = (parsed.potentialBugs ?? []).map(b => ({
    id: b.id ?? 'BUG-???',
    severity: b.severity ?? 'medium',
    description: b.description ?? '',
    location: Array.isArray(b.location) ? b.location : [b.location ?? ''],
    triggerCondition: b.triggerCondition ?? '',
    suggestion: b.suggestion ?? '',
  }))

  const riskLevel: RiskLevel = (['high', 'medium', 'low'] as const)
    .includes(parsed.riskLevel as RiskLevel)
    ? (parsed.riskLevel as RiskLevel)
    : 'medium'

  return {
    requirementCoverage,
    potentialBugs,
    missingImplementations: parsed.missingImplementations ?? [],
    unexpectedChanges: parsed.unexpectedChanges ?? [],
    riskLevel,
  }
}
