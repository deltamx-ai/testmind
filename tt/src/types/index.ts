// ============================================================
// Core domain types for TestMind pipeline
// ============================================================

// ---------- Jira types ----------

export interface JiraTicket {
  key: string
  summary: string
  description: string
  type: 'Story' | 'Bug' | 'Task' | 'Subtask'
  status: string
  priority: 'Highest' | 'High' | 'Medium' | 'Low' | 'Lowest'
  assignee?: string
  reporter?: string
  acceptanceCriteria?: string   // raw text extracted from description
  subtasks: string[]
  linkedIssues: string[]
  comments: JiraComment[]
  labels: string[]
  createdAt: string
  updatedAt: string
}

export interface JiraComment {
  author: string
  body: string
  createdAt: string
}

// ---------- Stage 1 output: JiraReport ----------

export interface Requirement {
  id: string              // REQ-001, REQ-002 …
  description: string     // what exactly needs to be implemented
  priority: 'must' | 'should' | 'nice-to-have'
  testable: boolean       // can this be verified by a test?
  source: 'explicit' | 'inferred'  // from AC or inferred by LLM
}

export interface AcceptanceCriteria {
  id: string              // AC-001 …
  description: string
  source: 'explicit' | 'inferred'
}

export interface JiraReport {
  ticketKey: string
  summary: string
  requirements: Requirement[]
  acceptanceCriteria: AcceptanceCriteria[]
  outOfScope: string[]
  riskFlags: string[]
  ambiguities: string[]
  hasExplicitAC: boolean  // did the ticket have AC written already?
}

// ---------- Stage 2 inputs: Git types ----------

export type FileCategory =
  | 'source'
  | 'test'
  | 'config'
  | 'migration'
  | 'api-schema'
  | 'docs'
  | 'other'

export type ChangeKind =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'

export interface HunkLine {
  type: '+' | '-' | ' '  // added / removed / context
  content: string
  lineNumber: number
}

export interface Hunk {
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  lines: HunkLine[]
}

export interface FileDiff {
  path: string
  oldPath?: string          // set when renamed
  category: FileCategory
  changeKind: ChangeKind
  additions: number
  deletions: number
  hunks: Hunk[]
  isBinary: boolean
}

export interface CommitInfo {
  hash: string
  shortHash: string
  message: string
  author: string
  date: string
}

export interface GitDiffResult {
  baseBranch: string
  headBranch: string
  commits: CommitInfo[]
  files: FileDiff[]
  totalAdditions: number
  totalDeletions: number
  /** True if any file's diff was truncated due to line limits */
  truncated: boolean
}

// ---------- Stage 2 output: CodeReport ----------

export interface TestCoverageInfo {
  covered: string[]     // change descriptions that have test coverage
  uncovered: string[]   // change descriptions without test coverage
}

export interface CodeReport {
  implementedFeatures: string[]   // business features this diff implements
  modifiedBehaviors: string[]     // existing behaviors that changed
  deletedBehaviors: string[]      // removed functionality
  sideEffects: string[]           // likely impact on other modules
  testCoverage: TestCoverageInfo
  codeSmells: string[]            // code quality issues (not requirement-related)
  affectedFiles: string[]         // source files (not tests/config)
  criticalPathFiles: string[]     // files matching criticalPaths globs
}

// ---------- Stage 3 output: CrossCheckReport ----------

export type RequirementStatus =
  | 'implemented'   // clearly done
  | 'partial'       // partially done, something missing
  | 'missing'       // not done at all
  | 'unclear'       // can't determine from diff

export interface RequirementCheck {
  requirementId: string
  requirementDescription: string
  status: RequirementStatus
  evidence: string      // which file/function implements it
  concern: string       // what's missing or unclear (empty if implemented)
}

export type BugSeverity = 'critical' | 'high' | 'medium' | 'low'

export interface PotentialBug {
  id: string              // BUG-001 …
  severity: BugSeverity
  description: string
  location: string[]      // file paths
  triggerCondition: string
  suggestion: string
}

export type RiskLevel = 'high' | 'medium' | 'low'

export interface CrossCheckReport {
  requirementCoverage: RequirementCheck[]
  potentialBugs: PotentialBug[]
  missingImplementations: string[]
  unexpectedChanges: string[]
  riskLevel: RiskLevel
}

// ---------- Stage 4 output: Final reports ----------

export type ChecklistPriority = 'critical' | 'high' | 'medium' | 'low'

export interface ChecklistItem {
  priority: ChecklistPriority
  text: string
  checked: boolean
}

export interface FinalReports {
  ticketKey: string
  generatedAt: string
  riskLevel: RiskLevel

  /** Report A: requirement completeness — for developer self-review */
  requirementReport: string

  /** Report B: bug risk list — review before testing */
  bugReport: string

  /** Report C: self-test checklist — paste into PR description */
  checklist: string
}

// ---------- Pipeline config ----------

export interface ProjectConfig {
  techStack?: string            // e.g. "React frontend, Node.js + PostgreSQL backend"
  businessRules?: string[]      // e.g. ["Payment flows must check idempotency"]
  criticalPaths?: string[]      // file globs that are high-risk
}

export interface PipelineInput {
  jiraTicket: JiraTicket
  baseBranch: string
  headBranch: string
  repoPath: string
  config?: ProjectConfig
}
