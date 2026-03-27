use crate::types::{
    AnalysisContext, LLMOutput, RiskLevel, TestSuggestionType,
};

const PRIORITY_ORDER: [&str; 4] = ["critical", "high", "medium", "low"];

pub fn generate_report(ctx: &AnalysisContext, llm_result: &LLMOutput) -> String {
    let git = &ctx.git;
    let history = &ctx.history;
    let test_coverage = &ctx.test_coverage;
    let mut lines: Vec<String> = Vec::new();

    // Header
    lines.push("# TestMind 自测检查清单".to_string());
    lines.push(String::new());
    lines.push(format!(
        "> 分支: {} → {} | 变更: {} files (+{} -{}) | 风险等级: **{}**",
        git.head_branch,
        git.base_branch,
        git.stats.files_changed,
        git.stats.additions,
        git.stats.deletions,
        llm_result.risk_level
    ));
    lines.push(String::new());

    // Summary
    lines.push("## 概要".to_string());
    lines.push(String::new());
    lines.push(llm_result.summary.clone());
    lines.push(String::new());

    // Checklist grouped by priority
    if !llm_result.checklist.is_empty() {
        lines.push("## 检查清单".to_string());
        lines.push(String::new());

        for priority_str in &PRIORITY_ORDER {
            let items: Vec<_> = llm_result
                .checklist
                .iter()
                .filter(|c| c.priority.as_str() == *priority_str)
                .collect();

            if items.is_empty() {
                continue;
            }

            let title = format!(
                "{}{}",
                priority_str[..1].to_uppercase(),
                &priority_str[1..]
            );
            lines.push(format!("### {}", title));
            lines.push(String::new());

            for item in items {
                lines.push(format!("- [ ] **{}** [{}] {}", item.id, item.category, item.title));
                lines.push(format!("  - {}", item.description));
                if !item.related_files.is_empty() {
                    let files: Vec<String> =
                        item.related_files.iter().map(|f| format!("`{}`", f)).collect();
                    lines.push(format!("  - 文件: {}", files.join(", ")));
                }
                lines.push(format!("  - 验证方式: {}", item.verification_method));
                lines.push(String::new());
            }
        }
    }

    // Test suggestions
    let existing: Vec<_> = llm_result
        .test_suggestions
        .iter()
        .filter(|t| matches!(t.suggestion_type, TestSuggestionType::Existing))
        .collect();
    let new_tests: Vec<_> = llm_result
        .test_suggestions
        .iter()
        .filter(|t| matches!(t.suggestion_type, TestSuggestionType::New))
        .collect();

    if !existing.is_empty() || !new_tests.is_empty() {
        lines.push("## 测试建议".to_string());
        lines.push(String::new());

        if !existing.is_empty() {
            lines.push("### 建议运行的已有测试".to_string());
            lines.push(String::new());
            for t in &existing {
                let path = t.path.as_deref().unwrap_or("unknown");
                lines.push(format!("- `{}` — {}", path, t.description));
                lines.push(format!("  - 原因: {}", t.reason));
            }
            lines.push(String::new());
        }

        if !new_tests.is_empty() {
            lines.push("### 建议新增的测试".to_string());
            lines.push(String::new());
            for t in &new_tests {
                lines.push(format!("- {}", t.description));
                lines.push(format!("  - 原因: {}", t.reason));
            }
            lines.push(String::new());
        }
    }

    // Risk hotspots
    let risky_hotspots: Vec<_> = history
        .hotspots
        .iter()
        .filter(|h| h.risk_level != RiskLevel::Low)
        .collect();

    if !risky_hotspots.is_empty() {
        lines.push("## 风险热区".to_string());
        lines.push(String::new());
        lines.push("| 文件 | 近 90 天修改 | Bug 修复 | 风险 |".to_string());
        lines.push("|------|-------------|---------|------|".to_string());
        for h in &risky_hotspots {
            lines.push(format!(
                "| `{}` | {} 次 | {} 次 | {} |",
                h.path, h.commit_count, h.fix_count, h.risk_level
            ));
        }
        lines.push(String::new());
    }

    // Test coverage gaps
    if !test_coverage.uncovered.is_empty() {
        lines.push("## 测试覆盖缺口".to_string());
        lines.push(String::new());
        lines.push("以下变更文件没有找到对应测试:".to_string());
        lines.push(String::new());
        for p in &test_coverage.uncovered {
            lines.push(format!("- `{}`", p));
        }
        lines.push(String::new());
    }

    // Stage warnings
    if !ctx.stage_warnings.is_empty() {
        lines.push("## 数据完整性警告".to_string());
        lines.push(String::new());
        lines.push("> 以下分析阶段出现问题，报告数据可能不完整：".to_string());
        lines.push(String::new());
        for w in &ctx.stage_warnings {
            lines.push(format!("- {}", w));
        }
        lines.push(String::new());
    }

    // Warnings
    if !llm_result.warnings.is_empty() {
        lines.push("## 注意事项".to_string());
        lines.push(String::new());
        for w in &llm_result.warnings {
            lines.push(format!("- {}", w));
        }
        lines.push(String::new());
    }

    // Footer
    lines.push("---".to_string());
    lines.push(format!(
        "Generated by TestMind MVP-0 (Rust) | {}",
        chrono::Utc::now().format("%Y-%m-%d %H:%M:%S")
    ));
    lines.push(String::new());

    lines.join("\n")
}
