// ---- Git Analysis ----

export interface ChangedFile {
  path: string
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  additions: number
  deletions: number
  diff: string
  language: string
  category: FileCategory
}

export type FileCategory =
  | 'source'
  | 'test'
  | 'config'
  | 'style'
  | 'migration'
  | 'api-schema'
  | 'ci'
  | 'docs'
  | 'other'

export interface CommitInfo {
  hash: string
  message: string
  date: string
  author: string
}

export interface GitAnalysis {
  baseBranch: string
  headBranch: string
  changedFiles: ChangedFile[]
  stats: { additions: number; deletions: number; filesChanged: number }
  commits: CommitInfo[]
}

// ---- Dependency Tracing ----

export interface ImpactedFile {
  path: string
  reason: string
  depth: number
}

export interface DependencyAnalysis {
  impactedFiles: ImpactedFile[]
  sharedModules: string[]
  entryPoints: string[]
}

// ---- History Analysis ----

export interface Hotspot {
  path: string
  commitCount: number
  fixCount: number
  riskLevel: 'high' | 'medium' | 'low'
}

export interface FixCommit {
  hash: string
  message: string
  date: string
  files: string[]
}

export interface HistoryAnalysis {
  hotspots: Hotspot[]
  recentFixCommits: FixCommit[]
}

// ---- Test Coverage ----

export interface CoverageItem {
  sourcePath: string
  testPaths: string[]
}

export interface TestCoverage {
  covered: CoverageItem[]
  uncovered: string[]
  relatedTests: string[]
  coverageRatio: number
}

// ---- LLM Output ----

export interface CheckItem {
  id: string
  priority: 'critical' | 'high' | 'medium' | 'low'
  category: string
  title: string
  description: string
  relatedFiles: string[]
  verificationMethod: 'manual' | 'unit-test' | 'e2e-test' | 'api-test'
}

export interface TestSuggestion {
  type: 'existing' | 'new'
  path?: string
  description: string
  reason: string
}

export interface LLMOutput {
  summary: string
  riskLevel: 'high' | 'medium' | 'low'
  checklist: CheckItem[]
  testSuggestions: TestSuggestion[]
  warnings: string[]
}

export type LLMProviderKind = 'anthropic' | 'copilot'

export interface ResolvedLLMProvider {
  provider: LLMProviderKind
  model: string
  displayName: string
  apiKey?: string
  baseUrl?: string
  token?: string
  authSource?: 'env' | 'config' | 'command' | 'copilot-auth'
}

// ---- Pipeline Context ----

export interface AnalysisContext {
  git: GitAnalysis
  dependencies: DependencyAnalysis
  history: HistoryAnalysis
  testCoverage: TestCoverage
}

// ---- Config ----

export interface TestMindConfig {
  baseBranch?: string
  provider?: LLMProviderKind | 'auto'
  model?: string
  maxDiffLines?: number
  historyDays?: number
  language?: string
  excludePatterns?: string[]
  anthropicApiKey?: string
  copilotToken?: string
  copilotBaseUrl?: string
  copilotTokenCommand?: string
  copilotPython?: string
}
