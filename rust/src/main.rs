#[macro_use]
extern crate lazy_static;

mod gate;
mod llm;
mod pipeline;
mod reporter;
mod stages;
mod types;
mod utils;

use std::fs;
use std::path::PathBuf;
use std::process;

use clap::Parser;

use crate::pipeline::run_pipeline;
use crate::types::GateStatus;
use crate::utils::{
    branch_exists, detect_base_branch, get_current_branch, is_git_repo, load_config,
};

#[derive(Parser, Debug)]
#[command(
    name = "testmind",
    version = "0.1.0",
    about = "Code-change-driven self-test advisor"
)]
struct Cli {
    /// Base branch to compare against
    #[arg(short = 'b', long)]
    base: Option<String>,

    /// Head branch to analyze
    #[arg(long)]
    head: Option<String>,

    /// Target branch to analyze (deprecated alias of --head)
    #[arg(long)]
    branch: Option<String>,

    /// LLM provider: auto | anthropic | copilot
    #[arg(short = 'p', long)]
    provider: Option<String>,

    /// LLM model id
    #[arg(short = 'm', long)]
    model: Option<String>,

    /// Knowledge base directory
    #[arg(long)]
    knowledge_dir: Option<String>,

    /// Requirements file exported from Jira/PRD/issue tracker
    #[arg(long)]
    requirements_file: Option<String>,

    /// Inline requirements text
    #[arg(long)]
    requirements_text: Option<String>,

    /// One acceptance criterion, repeatable
    #[arg(long = "requirement")]
    requirements: Vec<String>,

    /// Validation command to execute, repeatable
    #[arg(long = "test-command")]
    test_commands: Vec<String>,

    /// Repository path
    #[arg(short = 'r', long, default_value = ".")]
    repo: String,

    /// Output to file instead of stdout
    #[arg(short = 'o', long)]
    output: Option<String>,

    /// Show detailed analysis process
    #[arg(short = 'v', long)]
    verbose: bool,

    /// Show analysis scope without calling LLM
    #[arg(long)]
    dry_run: bool,

    /// Enable stricter gate rules
    #[arg(long)]
    strict: bool,
}

#[tokio::main]
async fn main() {
    let cli = Cli::parse();

    let cwd = PathBuf::from(&cli.repo)
        .canonicalize()
        .unwrap_or_else(|_| PathBuf::from(&cli.repo));
    let cwd_str = cwd.to_string_lossy().to_string();

    // Validate git repo
    if !is_git_repo(&cwd_str) {
        eprintln!("错误: {} 不是一个 Git 仓库", cwd_str);
        process::exit(1);
    }

    // Load config
    let mut config = load_config(&cwd_str);
    if let Some(ref p) = cli.provider {
        config.provider = Some(p.clone());
    }
    if let Some(ref m) = cli.model {
        config.model = Some(m.clone());
    }
    if let Some(ref dir) = cli.knowledge_dir {
        config.knowledge_dir = Some(dir.clone());
    }
    if let Some(ref path) = cli.requirements_file {
        config.requirements_file = Some(path.clone());
    }
    if let Some(ref text) = cli.requirements_text {
        config.requirements_text = Some(text.clone());
    }
    if !cli.requirements.is_empty() {
        config.requirement_items = Some(cli.requirements.clone());
    }
    if !cli.test_commands.is_empty() {
        config.test_commands = Some(cli.test_commands.clone());
    }
    if cli.verbose {
        config.verbose = Some(true);
    }
    if cli.dry_run {
        config.dry_run = Some(true);
    }
    if cli.strict {
        config.strict = Some(true);
        if config.min_coverage_ratio.is_none() {
            config.min_coverage_ratio = Some(0.7);
        }
        if config.fail_on_stage_warnings.is_none() {
            config.fail_on_stage_warnings = Some(true);
        }
    }

    // Determine branches
    let base_branch = cli
        .base
        .or(config.base_branch.clone())
        .or_else(|| std::env::var("TESTMIND_BASE_BRANCH").ok())
        .unwrap_or_else(|| detect_base_branch(&cwd_str));

    let head_branch = cli
        .head
        .or(cli.branch)
        .or(config.head_branch.clone())
        .or_else(|| std::env::var("TESTMIND_HEAD_BRANCH").ok())
        .unwrap_or_else(|| get_current_branch(&cwd_str).unwrap_or_else(|_| "HEAD".to_string()));

    if !branch_exists(&cwd_str, &base_branch) {
        eprintln!(
            "错误: 基准分支不存在 ({})。请通过 --base 指定有效分支。",
            base_branch
        );
        process::exit(1);
    }

    if !branch_exists(&cwd_str, &head_branch) {
        eprintln!(
            "错误: 目标分支不存在 ({})。请通过 --head 指定有效分支。",
            head_branch
        );
        process::exit(1);
    }

    if base_branch == head_branch {
        eprintln!(
            "错误: 基准分支和目标分支相同 ({})。请传入两个不同分支，例如 --base main --head feature/foo。",
            base_branch
        );
        process::exit(1);
    }

    eprintln!("\nTestMind MVP-0 (Rust)");
    eprintln!("{}", "─".repeat(40));
    eprintln!("仓库: {}", cwd_str);
    eprintln!("分析: {} → {}", head_branch, base_branch);
    eprintln!();

    match run_pipeline(&cwd_str, &base_branch, &head_branch, &config).await {
        Ok(outcome) => {
            if let Some(ref output_file) = cli.output {
                let out_path = PathBuf::from(output_file)
                    .canonicalize()
                    .unwrap_or_else(|_| PathBuf::from(output_file));
                if let Err(e) = fs::write(&out_path, &outcome.report) {
                    eprintln!("\n错误: 无法写入文件 {}: {}", out_path.display(), e);
                    process::exit(1);
                }
                eprintln!("\n报告已保存到: {}", out_path.display());
            } else {
                println!("{}", outcome.report);
            }

            if matches!(outcome.gate_status, Some(GateStatus::Fail)) {
                process::exit(2);
            }
        }
        Err(err) => {
            eprintln!("\n错误: {}", err);
            process::exit(1);
        }
    }
}
