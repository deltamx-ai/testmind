use anyhow::Result;

use crate::llm::provider::resolve_llm_provider;
use crate::reporter::generate_report;
use crate::stages::context_builder::build_context;
use crate::stages::dependency_tracer::trace_dependencies;
use crate::stages::git_analyzer::analyze_git;
use crate::stages::history_analyzer::analyze_history;
use crate::stages::llm_analyzer::analyze_llm;
use crate::stages::test_scanner::scan_test_coverage;
use crate::types::{
    AnalysisContext, DependencyAnalysis, FileCategory, HistoryAnalysis, TestCoverage, TestMindConfig,
};

fn log(stage: &str, message: &str) {
    eprintln!("  [{}] {}", stage, message);
}

fn verbose(config: &TestMindConfig, message: &str) {
    if config.verbose.unwrap_or(false) {
        eprintln!("  [verbose] {}", message);
    }
}

pub async fn run_pipeline(
    cwd: &str,
    base_branch: &str,
    head_branch: &str,
    config: &TestMindConfig,
) -> Result<String> {
    // Stage 1: Git analysis
    log("1/6", "分析 Git 变更...");
    let git = analyze_git(
        cwd,
        base_branch,
        head_branch,
        config.max_diff_lines_per_file,
        config.max_diff_lines,
    )
    .await?;

    if git.changed_files.is_empty() {
        return Ok(format!(
            "没有发现 {} 相对于 {} 的变更。",
            head_branch, base_branch
        ));
    }

    let source_count = git
        .changed_files
        .iter()
        .filter(|f| f.category == FileCategory::Source)
        .count();
    log(
        "1/6",
        &format!(
            "发现 {} 个变更文件 ({} 个源码文件)",
            git.changed_files.len(),
            source_count
        ),
    );

    // Stage 2 & 3 & 4: Run in parallel
    log("2/6", "追踪依赖关系...");
    log("3/6", "分析历史风险...");
    log("4/6", "扫描测试覆盖...");

    let mut stage_warnings: Vec<String> = Vec::new();

    let exclude_patterns = config.exclude_patterns.clone().unwrap_or_default();
    let max_impacted = config.max_impacted_files.unwrap_or(30);
    let history_days = config.history_days.unwrap_or(90);

    let changed_files = &git.changed_files;

    let (dep_result, hist_result, test_result) = tokio::join!(
        trace_dependencies(changed_files, cwd, &exclude_patterns, max_impacted),
        analyze_history(changed_files, cwd, history_days),
        scan_test_coverage(changed_files, cwd),
    );

    let dependencies = dep_result.unwrap_or_else(|err| {
        stage_warnings.push(format!(
            "[依赖追踪] 分析失败，数据可能不完整: {}",
            err
        ));
        DependencyAnalysis {
            impacted_files: Vec::new(),
            shared_modules: Vec::new(),
            entry_points: Vec::new(),
        }
    });

    let history = hist_result.unwrap_or_else(|err| {
        stage_warnings.push(format!(
            "[历史分析] 分析失败，数据可能不完整: {}",
            err
        ));
        HistoryAnalysis {
            hotspots: Vec::new(),
            recent_fix_commits: Vec::new(),
        }
    });

    let test_coverage = test_result.unwrap_or_else(|err| {
        stage_warnings.push(format!(
            "[测试扫描] 分析失败，数据可能不完整: {}",
            err
        ));
        TestCoverage {
            covered: Vec::new(),
            uncovered: Vec::new(),
            related_tests: Vec::new(),
            coverage_ratio: 0.0,
        }
    });

    log(
        "2/6",
        &format!(
            "{} 个受影响文件, {} 个入口",
            dependencies.impacted_files.len(),
            dependencies.entry_points.len()
        ),
    );
    log(
        "3/6",
        &format!(
            "{} 个风险热区",
            history
                .hotspots
                .iter()
                .filter(|h| h.risk_level != crate::types::RiskLevel::Low)
                .count()
        ),
    );
    log(
        "4/6",
        &format!(
            "覆盖率 {:.0}%, {} 个无覆盖",
            test_coverage.coverage_ratio * 100.0,
            test_coverage.uncovered.len()
        ),
    );

    // Stage 5: Build context
    log("5/6", "组装分析上下文...");
    let ctx = AnalysisContext {
        git,
        dependencies,
        history,
        test_coverage,
        stage_warnings,
    };
    let context_text = build_context(&ctx, config.max_context_chars);
    verbose(
        config,
        &format!(
            "上下文大小: {} 字符 (~{} tokens)",
            context_text.len(),
            context_text.len() / 4
        ),
    );

    // Dry run
    if config.dry_run.unwrap_or(false) {
        let mut lines = vec![
            "# TestMind Dry Run — 分析范围".to_string(),
            String::new(),
            format!("> 分支: {} → {}", head_branch, base_branch),
            format!(
                "> 变更: {} 文件 (+{} -{})",
                ctx.git.stats.files_changed, ctx.git.stats.additions, ctx.git.stats.deletions
            ),
            String::new(),
            "## 变更文件".to_string(),
        ];
        for f in &ctx.git.changed_files {
            lines.push(format!(
                "- `{}` [{:?}] ({:?}, +{} -{})",
                f.path, f.category, f.status, f.additions, f.deletions
            ));
        }
        lines.push(String::new());
        lines.push("## 依赖影响".to_string());
        lines.push(format!(
            "- 受影响文件: {}",
            ctx.dependencies.impacted_files.len()
        ));
        lines.push(format!(
            "- 入口文件: {}",
            ctx.dependencies.entry_points.len()
        ));
        lines.push(format!(
            "- 共享模块: {}",
            ctx.dependencies.shared_modules.len()
        ));
        lines.push(String::new());
        lines.push("## 历史风险".to_string());
        for h in ctx
            .history
            .hotspots
            .iter()
            .filter(|h| h.risk_level != crate::types::RiskLevel::Low)
        {
            lines.push(format!(
                "- `{}` — {} ({} commits, {} fixes)",
                h.path, h.risk_level, h.commit_count, h.fix_count
            ));
        }
        lines.push(String::new());
        lines.push("## 测试覆盖".to_string());
        lines.push(format!(
            "- 覆盖率: {:.0}%",
            ctx.test_coverage.coverage_ratio * 100.0
        ));
        lines.push(format!(
            "- 无覆盖: {} 文件",
            ctx.test_coverage.uncovered.len()
        ));
        lines.push(String::new());
        lines.push(format!(
            "> 上下文大小: {} 字符 (~{} tokens)",
            context_text.len(),
            context_text.len() / 4
        ));
        lines.push("> 使用 --dry-run 模式，已跳过 LLM 分析。".to_string());

        if !ctx.stage_warnings.is_empty() {
            lines.push(String::new());
            lines.push("## 警告".to_string());
            for w in &ctx.stage_warnings {
                lines.push(format!("- {}", w));
            }
        }

        return Ok(lines.join("\n"));
    }

    // Stage 6: LLM analysis
    let provider = resolve_llm_provider(config)?;
    verbose(
        config,
        &format!(
            "Provider: {:?}, Model: {}, AuthSource: {:?}",
            provider.provider, provider.model, provider.auth_source
        ),
    );
    log(
        "6/6",
        &format!("调用 LLM 分析 ({})...", provider.display_name),
    );
    let llm_result = analyze_llm(&context_text, &provider).await?;
    log(
        "6/6",
        &format!("生成 {} 条检查项", llm_result.checklist.len()),
    );

    // Generate report
    Ok(generate_report(&ctx, &llm_result))
}
