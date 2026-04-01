use crate::types::{AnalysisContext, FileCategory, RiskLevel};

const DEFAULT_MAX_CONTEXT_CHARS: usize = 80_000; // ~20K tokens

pub fn build_context(ctx: &AnalysisContext, max_context_chars: Option<usize>) -> String {
    let max_chars = max_context_chars.unwrap_or(DEFAULT_MAX_CONTEXT_CHARS);
    let mut sections: Vec<String> = Vec::new();
    let mut total_chars: usize = 0;

    let mut add_section = |title: &str, content: &str, required: bool| {
        let section = format!("## {}\n\n{}\n", title, content);
        if required || total_chars + section.len() < max_chars {
            total_chars += section.len();
            sections.push(section);
        }
    };

    // 1. Change summary (required)
    let git = &ctx.git;
    let mut summary_lines = vec![
        format!("分支: {} → {}", git.head_branch, git.base_branch),
        format!(
            "变更: {} 个文件 (+{} -{})",
            git.stats.files_changed, git.stats.additions, git.stats.deletions
        ),
        format!("提交: {} 个", git.commits.len()),
        String::new(),
        "### 变更文件列表".to_string(),
        String::new(),
    ];

    for f in &git.changed_files {
        let risk = ctx.history.hotspots.iter().find(|h| h.path == f.path);
        let risk_tag = match risk.map(|r| &r.risk_level) {
            Some(RiskLevel::High) => " [HIGH RISK]",
            Some(RiskLevel::Medium) => " [MEDIUM RISK]",
            _ => "",
        };
        summary_lines.push(format!(
            "- `{}` ({:?}, +{} -{}) [{:?}]{}",
            f.path, f.status, f.additions, f.deletions, f.category, risk_tag
        ));
    }
    add_section("变更概要", &summary_lines.join("\n"), true);

    if !ctx.requirements.is_empty() {
        let requirement_lines: Vec<String> = ctx
            .requirements
            .iter()
            .map(|item| format!("- {}: {}", item.id, item.text))
            .collect();
        add_section("需求与验收标准", &requirement_lines.join("\n"), true);
    }

    if !ctx.knowledge_matches.is_empty() {
        let knowledge_lines: Vec<String> = ctx
            .knowledge_matches
            .iter()
            .map(|match_item| {
                let mut line = format!(
                    "- {} [{}] {}",
                    match_item.item.id, match_item.item.kind, match_item.item.title
                );
                if !match_item.reasons.is_empty() {
                    line.push_str(&format!(" | 命中原因: {}", match_item.reasons.join("; ")));
                }
                if !match_item.item.acceptance.is_empty() {
                    line.push_str(&format!(
                        " | 验收点: {}",
                        match_item.item.acceptance.join("; ")
                    ));
                } else if !match_item.item.checks.is_empty() {
                    line.push_str(&format!(" | 检查点: {}", match_item.item.checks.join("; ")));
                }
                line
            })
            .collect();
        add_section("相关知识库条目", &knowledge_lines.join("\n"), true);
    }

    // 2. Commits (required)
    if !git.commits.is_empty() {
        let commit_list: Vec<String> = git
            .commits
            .iter()
            .take(20)
            .map(|c| format!("- {} {}", &c.hash[..7.min(c.hash.len())], c.message))
            .collect();
        add_section("提交记录", &commit_list.join("\n"), true);
    }

    // 3. High-risk file diffs (required)
    let high_risk_files: Vec<&crate::types::ChangedFile> = git
        .changed_files
        .iter()
        .filter(|f| {
            let hotspot = ctx.history.hotspots.iter().find(|h| h.path == f.path);
            f.category == FileCategory::Source
                && matches!(
                    hotspot.map(|h| &h.risk_level),
                    Some(RiskLevel::High) | Some(RiskLevel::Medium)
                )
        })
        .collect();

    let normal_files: Vec<&crate::types::ChangedFile> = git
        .changed_files
        .iter()
        .filter(|f| f.category == FileCategory::Source && !high_risk_files.contains(f))
        .collect();

    if !high_risk_files.is_empty() {
        let diffs: Vec<String> = high_risk_files
            .iter()
            .map(|f| format!("### {}\n```diff\n{}\n```", f.path, f.diff))
            .collect();
        add_section("高风险文件 Diff", &diffs.join("\n\n"), true);
    }

    // 4. Test coverage gaps (required)
    let tc = &ctx.test_coverage;
    let mut coverage_content = vec![format!(
        "覆盖率: {:.0}% ({}/{})",
        tc.coverage_ratio * 100.0,
        tc.covered.len(),
        tc.covered.len() + tc.uncovered.len()
    )];

    if !tc.uncovered.is_empty() {
        coverage_content.push(String::new());
        coverage_content.push("### 无测试覆盖的变更文件".to_string());
        for p in &tc.uncovered {
            coverage_content.push(format!("- `{}`", p));
        }
    }
    if !tc.covered.is_empty() {
        coverage_content.push(String::new());
        coverage_content.push("### 已有测试覆盖".to_string());
        for item in &tc.covered {
            let tests: Vec<String> = item.test_paths.iter().map(|t| format!("`{}`", t)).collect();
            coverage_content.push(format!("- `{}` → {}", item.source_path, tests.join(", ")));
        }
    }
    add_section("测试覆盖情况", &coverage_content.join("\n"), true);

    // 5. History hotspots (required)
    let risky_hotspots: Vec<&crate::types::Hotspot> = ctx
        .history
        .hotspots
        .iter()
        .filter(|h| h.risk_level != RiskLevel::Low)
        .collect();

    if !risky_hotspots.is_empty() {
        let mut table = vec![
            "| 文件 | 近期修改 | Bug修复 | 风险 |".to_string(),
            "|------|---------|---------|------|".to_string(),
        ];
        for h in &risky_hotspots {
            table.push(format!(
                "| `{}` | {} | {} | {} |",
                h.path, h.commit_count, h.fix_count, h.risk_level
            ));
        }
        add_section("历史风险热区", &table.join("\n"), true);
    }

    // 6. Impacted files
    if !ctx.dependencies.impacted_files.is_empty() {
        let mut deps: Vec<String> = Vec::new();
        if !ctx.dependencies.entry_points.is_empty() {
            deps.push("### 受影响的入口文件".to_string());
            for e in &ctx.dependencies.entry_points {
                deps.push(format!("- `{}`", e));
            }
            deps.push(String::new());
            deps.push("### 受影响的消费方".to_string());
        }
        for f in &ctx.dependencies.impacted_files {
            deps.push(format!("- `{}` — {}", f.path, f.reason));
        }
        add_section("依赖影响面", &deps.join("\n"), false);
    }

    // 7. Normal file diffs (truncated to fit)
    if !normal_files.is_empty() {
        let diffs: Vec<String> = normal_files
            .iter()
            .map(|f| format!("### {}\n```diff\n{}\n```", f.path, f.diff))
            .collect();
        add_section("其他变更文件 Diff", &diffs.join("\n\n"), false);
    }

    // 8. Config/migration changes
    let config_files: Vec<&crate::types::ChangedFile> = git
        .changed_files
        .iter()
        .filter(|f| {
            matches!(
                f.category,
                FileCategory::Config | FileCategory::Migration | FileCategory::ApiSchema
            )
        })
        .collect();

    if !config_files.is_empty() {
        let list: Vec<String> = config_files
            .iter()
            .map(|f| {
                format!(
                    "### {} [{:?}]\n```diff\n{}\n```",
                    f.path, f.category, f.diff
                )
            })
            .collect();
        add_section("配置/迁移/Schema 变更", &list.join("\n\n"), false);
    }

    sections.join("\n")
}
