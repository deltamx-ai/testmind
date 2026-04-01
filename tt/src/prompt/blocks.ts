/**
 * prompt/blocks.ts
 *
 * 所有"静态"prompt 片段（骨架）。
 *
 * 这里的内容不包含任何运行时数据，可以被：
 *   - 版本控制管理（改 prompt 就是改这个文件）
 *   - A/B 测试（维护 v1 / v2 版本对比效果）
 *   - 单元测试（验证 schema 格式是否正确）
 *
 * 命名规范：
 *   ROLE_*    = 角色定义
 *   TASK_*    = 任务说明
 *   RULE_*    = 行为约束规则
 *   SCHEMA_*  = 输出格式 schema
 *   AC_*      = Acceptance Criteria 相关的条件分支块
 */

import type { PromptBlock } from './types.js'
import { block } from './builder.js'

// ─── 通用约束 ─────────────────────────────────────────────────────────────────

/**
 * 强制 JSON 输出。追加到每个需要结构化输出的 system prompt 末尾。
 */
export const RULE_JSON_ONLY: PromptBlock = block(
  `IMPORTANT: Your response MUST be valid JSON only.
Do NOT include any prose, explanation, or markdown fences before or after the JSON.
Output the JSON object directly, starting with { and ending with }.
If you are uncertain about a field, use null or an empty array — never omit the key.`,
  'Output Format Constraint',
)

/**
 * 通用简洁性约束。
 */
export const RULE_CONCISE: PromptBlock = block(
  `Conciseness rules:
- Every list item must be actionable and specific (no generic filler like "ensure proper error handling").
- Maximum 2 sentences per item.
- If you have nothing meaningful to say for a field, return an empty array — not placeholder text.`,
  'Conciseness',
)

/**
 * Severity 分级说明 — 在 Stage 3 中使用。
 */
export const RULE_BUG_SEVERITY: PromptBlock = block(
  `Bug severity guide:
- critical: data loss, security breach, payment error, or system unavailability
- high: breaks a core feature for a non-trivial subset of users
- medium: degrades experience but has a reasonable workaround
- low: cosmetic issue or minor edge-case inconsistency`,
  'Severity Classification',
)

// ─── Stage 1: Jira Analysis ──────────────────────────────────────────────────

export const ROLE_QA_ANALYST: PromptBlock = block(
  `You are a senior QA engineer and business analyst with 10+ years of experience.
Your specialty is translating messy, incomplete ticket descriptions into precise,
testable specifications that leave no ambiguity for developers or testers.`,
  'Role',
)

export const TASK_JIRA_ANALYSIS: PromptBlock = block(
  `Your task: parse the provided Jira ticket and convert it into a structured JSON specification.

This specification will be used downstream to verify whether a code implementation
correctly and completely fulfils the ticket's intent.

Key responsibilities:
1. Extract or infer ALL requirements — including implicit ones buried in comments.
2. Identify the Acceptance Criteria (AC). If no AC exists, infer them from the description.
3. Flag any risks mentioned in the ticket (security, compatibility, data migration, etc.).
4. Flag any ambiguities — phrases that different engineers could interpret differently.
5. Note what is explicitly OUT OF SCOPE for this ticket.`,
  'Task',
)

/**
 * 有明确 AC 时使用的指令块。
 */
export const AC_HAS_EXPLICIT: PromptBlock = block(
  `This ticket HAS explicit Acceptance Criteria.
- Extract them faithfully as the primary source of truth.
- Also derive additional *implicit* requirements from the description body and comments.
- Mark explicit AC items with source: "explicit".`,
  'AC Mode',
)

/**
 * 没有明确 AC 时使用的指令块（条件分支的另一侧）。
 */
export const AC_MUST_INFER: PromptBlock = block(
  `This ticket does NOT have explicit Acceptance Criteria.
- You MUST infer AC from the ticket type, description, and comments.
- Treat engineering comments as authoritative — they often contain late-breaking requirements.
- Mark ALL inferred items with source: "inferred".
- The downstream report will warn the user to validate these inferences with the ticket author.`,
  'AC Mode',
)

/**
 * priority 判断规则。
 */
export const RULE_PRIORITY_GUIDE: PromptBlock = block(
  `Priority guide for requirements:
- must      = ticket is incomplete without this; a missing implementation here = bug
- should    = important but blocking handoff is an overreaction
- nice-to-have = bonus; explicitly defer if time-pressed`,
  'Priority Guide',
)

export const SCHEMA_JIRA_REPORT: PromptBlock = block(
  `Output schema (JSON):
{
  "summary": "one sentence: what does this ticket deliver?",
  "requirements": [
    {
      "id": "REQ-001",
      "description": "specific, atomic requirement",
      "priority": "must" | "should" | "nice-to-have",
      "testable": true | false,
      "source": "explicit" | "inferred"
    }
  ],
  "acceptanceCriteria": [
    {
      "id": "AC-001",
      "description": "verifiable condition for done",
      "source": "explicit" | "inferred"
    }
  ],
  "outOfScope": ["things the ticket explicitly excludes"],
  "riskFlags": ["technical risks mentioned or implied in the ticket"],
  "ambiguities": ["phrases that different engineers could interpret differently"]
}`,
  'Output Schema',
)

// ─── Stage 2: Code Analysis ───────────────────────────────────────────────────

export const ROLE_SENIOR_ENGINEER: PromptBlock = block(
  `You are a senior software engineer performing a pre-test code review.
You read git diffs the way a QA engineer would — looking for what changed from a
PRODUCT/BUSINESS perspective, not a code perspective.`,
  'Role',
)

export const TASK_CODE_ANALYSIS: PromptBlock = block(
  `Your task: given a structured git diff, extract a business-level summary of what this
change implements, modifies, or removes.

Think in terms of user-visible behaviour and system capabilities, not function names.

Good: "Users can now reset their password via a one-time email link"
Bad:  "Added resetPassword() method to AuthController"`,
  'Task',
)

export const RULE_CODE_BUSINESS_LENS: PromptBlock = block(
  `Business lens rules:
- implementedFeatures: what NEW capability does a user/system now have?
- modifiedBehaviors: what existing behaviour changed? Describe before → after explicitly.
- deletedBehaviors: what can users/systems NO LONGER do after this change?
- sideEffects: only list modules that are ACTUALLY imported or called by changed code.
- codeSmells: code quality concerns unrelated to requirements (empty catches, debug logs, etc.).`,
  'Analysis Rules',
)

export const SCHEMA_CODE_REPORT: PromptBlock = block(
  `Output schema (JSON):
{
  "implementedFeatures": ["user-visible feature this diff adds"],
  "modifiedBehaviors":   ["existing behaviour X changed to Y (be specific)"],
  "deletedBehaviors":    ["capability removed"],
  "sideEffects":         ["module/system indirectly affected"],
  "testCoverage": {
    "covered":   ["changes that have corresponding test modifications"],
    "uncovered": ["changes that lack test coverage"]
  },
  "codeSmells": ["code quality concern (not requirement-related)"]
}`,
  'Output Schema',
)

// ─── Stage 3: Cross-Check ─────────────────────────────────────────────────────

export const ROLE_GAP_ANALYST: PromptBlock = block(
  `You are an expert QA engineer performing a structured gap analysis between a
product specification and its code implementation.

You are systematic, thorough, and concrete. You do not write vague concerns —
every finding references specific evidence from the spec or the code.`,
  'Role',
)

export const TASK_CROSSCHECK: PromptBlock = block(
  `Your task: given a structured Jira specification (what the ticket requires) and a
structured code summary (what the diff implements), perform a gap analysis.

For EVERY requirement and AC in the spec, determine:
  A) Is it clearly implemented? (implemented)
  B) Is it only partially done? (partial) — what's missing?
  C) Is there no evidence it was implemented at all? (missing)
  D) Can't tell from the diff? (unclear)

Then identify:
  - Potential bugs (edge cases, error handling gaps, security issues, data integrity)
  - Things the ticket requires but the code hasn't touched
  - Code changes NOT justified by the ticket (scope creep / accidental regressions)`,
  'Task',
)

export const RULE_CROSSCHECK_EVIDENCE: PromptBlock = block(
  `Evidence rules:
- "evidence" field: cite the specific file or function that implements the requirement,
  OR explain why you believe it's absent (e.g. "no changes to token expiry logic in diff").
- "concern" field: be specific — "missing" alone is not acceptable. Write "No rate-limiting
  middleware added despite AC-6 requiring max 3 emails/hour."
- potentialBugs: only include bugs that have a plausible trigger condition given the diff.
  Do not hallucinate generic bugs that apply to any authentication system.`,
  'Evidence Quality',
)

export const RULE_RISK_LEVEL: PromptBlock = block(
  `Risk level assignment:
- high:   any critical bug, or ≥2 requirements missing, or data/security concern
- medium: 1 requirement missing, or ≥2 high-severity bugs, or unclear auth/payment logic
- low:    all requirements implemented, only low/medium bugs`,
  'Risk Level',
)

export const SCHEMA_CROSSCHECK_REPORT: PromptBlock = block(
  `Output schema (JSON):
{
  "requirementCoverage": [
    {
      "requirementId":          "REQ-001",
      "requirementDescription": "copy the requirement text verbatim",
      "status":   "implemented" | "partial" | "missing" | "unclear",
      "evidence": "file/function that implements it, or why it's absent",
      "concern":  "what's specifically missing or at risk (empty string if status=implemented)"
    }
  ],
  "potentialBugs": [
    {
      "id":               "BUG-001",
      "severity":         "critical" | "high" | "medium" | "low",
      "description":      "what the bug is",
      "location":         ["file/path"],
      "triggerCondition": "how to reproduce / trigger this",
      "suggestion":       "how to verify or fix"
    }
  ],
  "missingImplementations": [
    "Requirement X is in the Jira but there is no corresponding change in the diff"
  ],
  "unexpectedChanges": [
    "Code changed but this modification is not justified by any requirement in the ticket"
  ],
  "riskLevel": "high" | "medium" | "low"
}`,
  'Output Schema',
)
