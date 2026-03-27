use std::collections::HashMap;

use anyhow::Result;
use regex::Regex;

use crate::types::{ChangedFile, FileCategory, FixCommit, HistoryAnalysis, Hotspot, RiskLevel};
use crate::utils::git_lines;

pub async fn analyze_history(
    changed_files: &[ChangedFile],
    cwd: &str,
    history_days: usize,
) -> Result<HistoryAnalysis> {
    let fix_keywords =
        Regex::new(r"(?i)\b(fix|bug|hotfix|patch|resolve|revert|regression|crash|broken|issue)\b")
            .unwrap();

    let source_files: Vec<&ChangedFile> = changed_files
        .iter()
        .filter(|f| f.category == FileCategory::Source || f.category == FileCategory::Config)
        .collect();

    let mut hotspots: Vec<Hotspot> = Vec::new();
    let mut fix_commit_map: HashMap<String, FixCommit> = HashMap::new();

    for file in &source_files {
        if file.status == crate::types::FileStatus::Added {
            continue;
        }

        let since_arg = format!("{} days ago", history_days);
        let log_lines = match git_lines(
            &["log", &format!("--since={}", since_arg), "--format=%H|%s|%ai", "--", &file.path],
            cwd,
        ) {
            Ok(lines) => lines,
            Err(_) => continue,
        };

        let commit_count = log_lines.len();
        let mut fix_count = 0;

        for line in &log_lines {
            let parts: Vec<&str> = line.splitn(3, '|').collect();
            let hash = parts.first().unwrap_or(&"").to_string();
            let message = parts.get(1).unwrap_or(&"").to_string();
            let date = parts.get(2).unwrap_or(&"").to_string();

            if fix_keywords.is_match(&message) {
                fix_count += 1;
                fix_commit_map
                    .entry(hash.clone())
                    .and_modify(|fc| fc.files.push(file.path.clone()))
                    .or_insert_with(|| FixCommit {
                        hash,
                        message,
                        date,
                        files: vec![file.path.clone()],
                    });
            }
        }

        let risk_level = if commit_count > 10 || fix_count > 3 {
            RiskLevel::High
        } else if commit_count > 5 || fix_count > 1 {
            RiskLevel::Medium
        } else {
            RiskLevel::Low
        };

        hotspots.push(Hotspot {
            path: file.path.clone(),
            commit_count,
            fix_count,
            risk_level,
        });
    }

    // Sort by risk: high > medium > low, then by fix_count desc
    hotspots.sort_by(|a, b| {
        a.risk_level
            .order()
            .cmp(&b.risk_level.order())
            .then_with(|| b.fix_count.cmp(&a.fix_count))
    });

    // Only keep recent fix commits, sorted by date desc
    let mut recent_fix_commits: Vec<FixCommit> = fix_commit_map.into_values().collect();
    recent_fix_commits.sort_by(|a, b| b.date.cmp(&a.date));
    recent_fix_commits.truncate(10);

    Ok(HistoryAnalysis {
        hotspots,
        recent_fix_commits,
    })
}
