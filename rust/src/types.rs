use serde::{Deserialize, Serialize};

// ---- Git Analysis ----

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FileStatus {
    Added,
    Modified,
    Deleted,
    Renamed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum FileCategory {
    Source,
    Test,
    Config,
    Style,
    Migration,
    ApiSchema,
    Ci,
    Docs,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ChangedFile {
    pub path: String,
    pub status: FileStatus,
    pub additions: usize,
    pub deletions: usize,
    pub diff: String,
    pub language: String,
    pub category: FileCategory,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitInfo {
    pub hash: String,
    pub message: String,
    pub date: String,
    pub author: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitStats {
    pub additions: usize,
    pub deletions: usize,
    pub files_changed: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitAnalysis {
    pub base_branch: String,
    pub head_branch: String,
    pub changed_files: Vec<ChangedFile>,
    pub stats: GitStats,
    pub commits: Vec<CommitInfo>,
}

// ---- Dependency Tracing ----

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImpactedFile {
    pub path: String,
    pub reason: String,
    pub depth: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DependencyAnalysis {
    pub impacted_files: Vec<ImpactedFile>,
    pub shared_modules: Vec<String>,
    pub entry_points: Vec<String>,
}

// ---- History Analysis ----

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
pub enum RiskLevel {
    High,
    Medium,
    Low,
}

impl RiskLevel {
    pub fn as_str(&self) -> &str {
        match self {
            RiskLevel::High => "high",
            RiskLevel::Medium => "medium",
            RiskLevel::Low => "low",
        }
    }

    pub fn order(&self) -> u8 {
        match self {
            RiskLevel::High => 0,
            RiskLevel::Medium => 1,
            RiskLevel::Low => 2,
        }
    }
}

impl std::fmt::Display for RiskLevel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str().to_uppercase())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Hotspot {
    pub path: String,
    pub commit_count: usize,
    pub fix_count: usize,
    pub risk_level: RiskLevel,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FixCommit {
    pub hash: String,
    pub message: String,
    pub date: String,
    pub files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryAnalysis {
    pub hotspots: Vec<Hotspot>,
    pub recent_fix_commits: Vec<FixCommit>,
}

// ---- Test Coverage ----

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoverageItem {
    pub source_path: String,
    pub test_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestCoverage {
    pub covered: Vec<CoverageItem>,
    pub uncovered: Vec<String>,
    pub related_tests: Vec<String>,
    pub coverage_ratio: f64,
}

// ---- Requirements ----

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RequirementItem {
    pub id: String,
    pub text: String,
}

// ---- Knowledge Base ----

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum KnowledgeKind {
    Requirement,
    BugPattern,
    Decision,
}

impl std::fmt::Display for KnowledgeKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            KnowledgeKind::Requirement => write!(f, "requirement"),
            KnowledgeKind::BugPattern => write!(f, "bug-pattern"),
            KnowledgeKind::Decision => write!(f, "decision"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeSource {
    pub source_type: Option<String>,
    pub key: Option<String>,
    pub url: Option<String>,
    pub title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeItem {
    pub id: String,
    pub kind: KnowledgeKind,
    pub title: String,
    pub summary: Option<String>,
    pub module: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub file_patterns: Vec<String>,
    #[serde(default)]
    pub acceptance: Vec<String>,
    #[serde(default)]
    pub checks: Vec<String>,
    pub source: Option<KnowledgeSource>,
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnowledgeMatch {
    pub item: KnowledgeItem,
    pub score: usize,
    pub reasons: Vec<String>,
}

// ---- LLM Output ----

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Priority {
    Critical,
    High,
    Medium,
    Low,
}

impl Priority {
    pub fn as_str(&self) -> &str {
        match self {
            Priority::Critical => "critical",
            Priority::High => "high",
            Priority::Medium => "medium",
            Priority::Low => "low",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VerificationMethod {
    Manual,
    #[serde(rename = "unit-test")]
    UnitTest,
    #[serde(rename = "e2e-test")]
    E2eTest,
    #[serde(rename = "api-test")]
    ApiTest,
}

impl std::fmt::Display for VerificationMethod {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            VerificationMethod::Manual => write!(f, "manual"),
            VerificationMethod::UnitTest => write!(f, "unit-test"),
            VerificationMethod::E2eTest => write!(f, "e2e-test"),
            VerificationMethod::ApiTest => write!(f, "api-test"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckItem {
    pub id: String,
    pub priority: Priority,
    pub category: String,
    pub title: String,
    pub description: String,
    pub related_files: Vec<String>,
    pub verification_method: VerificationMethod,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TestSuggestionType {
    Existing,
    New,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestSuggestion {
    #[serde(rename = "type")]
    pub suggestion_type: TestSuggestionType,
    pub path: Option<String>,
    pub description: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RequirementStatus {
    Covered,
    Partial,
    Missing,
    Unclear,
}

impl RequirementStatus {
    pub fn as_str(&self) -> &str {
        match self {
            RequirementStatus::Covered => "covered",
            RequirementStatus::Partial => "partial",
            RequirementStatus::Missing => "missing",
            RequirementStatus::Unclear => "unclear",
        }
    }
}

impl std::fmt::Display for RequirementStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str().to_uppercase())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequirementCoverage {
    pub id: String,
    pub requirement: String,
    pub status: RequirementStatus,
    pub evidence: String,
    pub related_files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LLMOutput {
    pub summary: String,
    pub risk_level: RiskLevel,
    pub checklist: Vec<CheckItem>,
    pub test_suggestions: Vec<TestSuggestion>,
    pub requirement_coverage: Vec<RequirementCoverage>,
    pub warnings: Vec<String>,
}

// ---- LLM Provider ----

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LLMProviderKind {
    Anthropic,
    Copilot,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AuthSource {
    Env,
    Config,
    Command,
    CopilotAuth,
}

#[derive(Debug, Clone)]
pub struct ResolvedLLMProvider {
    pub provider: LLMProviderKind,
    pub model: String,
    pub display_name: String,
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    pub token: Option<String>,
    pub auth_source: Option<AuthSource>,
}

// ---- Pipeline Context ----

#[derive(Debug, Clone)]
pub struct AnalysisContext {
    pub git: GitAnalysis,
    pub dependencies: DependencyAnalysis,
    pub history: HistoryAnalysis,
    pub test_coverage: TestCoverage,
    pub requirements: Vec<RequirementItem>,
    pub knowledge_matches: Vec<KnowledgeMatch>,
    pub stage_warnings: Vec<String>,
}

// ---- Test Execution ----

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CommandStatus {
    Passed,
    Failed,
    Skipped,
}

impl std::fmt::Display for CommandStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CommandStatus::Passed => write!(f, "PASSED"),
            CommandStatus::Failed => write!(f, "FAILED"),
            CommandStatus::Skipped => write!(f, "SKIPPED"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandExecution {
    pub command: String,
    pub status: CommandStatus,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

// ---- Gate Evaluation ----

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum GateStatus {
    Pass,
    Warn,
    Fail,
}

impl GateStatus {
    pub fn order(&self) -> u8 {
        match self {
            GateStatus::Fail => 0,
            GateStatus::Warn => 1,
            GateStatus::Pass => 2,
        }
    }
}

impl std::fmt::Display for GateStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GateStatus::Pass => write!(f, "PASS"),
            GateStatus::Warn => write!(f, "WARN"),
            GateStatus::Fail => write!(f, "FAIL"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GateFinding {
    pub status: GateStatus,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GateReport {
    pub status: GateStatus,
    pub findings: Vec<GateFinding>,
}

// ---- Config ----

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestMindConfig {
    pub base_branch: Option<String>,
    pub head_branch: Option<String>,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub knowledge_dir: Option<String>,
    pub max_knowledge_items: Option<usize>,
    pub requirements_file: Option<String>,
    pub requirements_text: Option<String>,
    pub requirement_items: Option<Vec<String>>,
    pub test_commands: Option<Vec<String>>,
    pub max_diff_lines: Option<usize>,
    pub max_diff_lines_per_file: Option<usize>,
    pub max_impacted_files: Option<usize>,
    pub max_context_chars: Option<usize>,
    pub history_days: Option<usize>,
    pub min_coverage_ratio: Option<f64>,
    pub fail_on_missing_requirements: Option<bool>,
    pub fail_on_uncovered_high_risk: Option<bool>,
    pub fail_on_stage_warnings: Option<bool>,
    pub strict: Option<bool>,
    pub language: Option<String>,
    pub exclude_patterns: Option<Vec<String>>,
    pub anthropic_api_key: Option<String>,
    pub copilot_token: Option<String>,
    pub copilot_base_url: Option<String>,
    pub copilot_token_command: Option<String>,
    pub copilot_python: Option<String>,
    pub verbose: Option<bool>,
    pub dry_run: Option<bool>,
}
