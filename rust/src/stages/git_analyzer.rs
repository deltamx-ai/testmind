use anyhow::Result;
use regex::Regex;

use crate::types::{ChangedFile, CommitInfo, FileCategory, FileStatus, GitAnalysis, GitStats};
use crate::utils::{get_language_from_path, git, git_lines, truncate_diff};

const DEFAULT_MAX_DIFF_LINES_PER_FILE: usize = 200;
const DEFAULT_MAX_TOTAL_DIFF_LINES: usize = 3000;

fn categorize_file(path: &str) -> FileCategory {
    let lower = path.to_lowercase();

    if Regex::new(r"\.(test|spec)\.[^.]+$")
        .unwrap()
        .is_match(&lower)
        || lower.contains("__tests__/")
        || lower.contains("/test/")
    {
        return FileCategory::Test;
    }
    if Regex::new(r"\.(config|rc)\.[^.]+$")
        .unwrap()
        .is_match(&lower)
        || Regex::new(r"/\.[^/]*rc").unwrap().is_match(&lower)
        || lower.contains("tsconfig")
    {
        return FileCategory::Config;
    }
    if Regex::new(r"\.(css|scss|less|sass|styl)$")
        .unwrap()
        .is_match(&lower)
    {
        return FileCategory::Style;
    }
    if lower.contains("migration") || Regex::new(r"\.migration\.[^.]+$").unwrap().is_match(&lower) {
        return FileCategory::Migration;
    }
    if lower.contains("openapi") || lower.contains("swagger") || lower.ends_with(".graphql") {
        return FileCategory::ApiSchema;
    }
    if lower.starts_with(".github/")
        || lower.contains("jenkinsfile")
        || lower.contains("dockerfile")
        || lower.contains(".gitlab-ci")
        || lower.contains(".circleci")
    {
        return FileCategory::Ci;
    }
    if lower.ends_with(".md") || lower.contains("/docs/") {
        return FileCategory::Docs;
    }
    if Regex::new(r"\.(ts|tsx|js|jsx|py|go|rs|java|kt|rb|php|cs|swift|vue|svelte)$")
        .unwrap()
        .is_match(&lower)
    {
        return FileCategory::Source;
    }
    FileCategory::Other
}

fn parse_status(letter: char) -> FileStatus {
    match letter {
        'A' => FileStatus::Added,
        'D' => FileStatus::Deleted,
        'R' => FileStatus::Renamed,
        _ => FileStatus::Modified,
    }
}

pub async fn analyze_git(
    cwd: &str,
    base_branch: &str,
    head_branch: &str,
    max_diff_lines_per_file: Option<usize>,
    max_diff_lines: Option<usize>,
) -> Result<GitAnalysis> {
    let max_per_file = max_diff_lines_per_file.unwrap_or(DEFAULT_MAX_DIFF_LINES_PER_FILE);
    let max_total = max_diff_lines.unwrap_or(DEFAULT_MAX_TOTAL_DIFF_LINES);

    // Get merge base
    let merge_base = git(&["merge-base", base_branch, head_branch], cwd)
        .unwrap_or_else(|_| base_branch.to_string());

    let range = format!("{}...{}", merge_base, head_branch);

    // Get changed files with name-status
    let name_status_lines = git_lines(&["diff", "--name-status", &range], cwd).unwrap_or_default();

    // Get numstat
    let numstat_lines = git_lines(&["diff", "--numstat", &range], cwd).unwrap_or_default();

    // Build numstat map
    let mut numstat_map = std::collections::HashMap::new();
    for line in &numstat_lines {
        let parts: Vec<&str> = line.splitn(3, '\t').collect();
        if parts.len() >= 3 {
            let additions = if parts[0] == "-" {
                0
            } else {
                parts[0].parse::<usize>().unwrap_or(0)
            };
            let deletions = if parts[1] == "-" {
                0
            } else {
                parts[1].parse::<usize>().unwrap_or(0)
            };
            numstat_map.insert(parts[2].to_string(), (additions, deletions));
        }
    }

    // Build changed files
    let mut changed_files: Vec<ChangedFile> = Vec::new();
    for line in &name_status_lines {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.is_empty() {
            continue;
        }
        let status_letter = parts[0].chars().next().unwrap_or('M');
        let file_path = if status_letter == 'R' {
            parts.get(2).unwrap_or(&"")
        } else {
            parts.get(1).unwrap_or(&"")
        };
        if file_path.is_empty() {
            continue;
        }

        let (additions, deletions) = numstat_map
            .get(*file_path)
            .or_else(|| {
                let joined = parts[1..].join("\t");
                numstat_map.get(&joined)
            })
            .copied()
            .unwrap_or((0, 0));

        let diff = match git(&["diff", &range, "--", file_path], cwd) {
            Ok(d) => truncate_diff(&d, max_per_file),
            Err(_) => "(unable to retrieve diff)".to_string(),
        };

        changed_files.push(ChangedFile {
            path: file_path.to_string(),
            status: parse_status(status_letter),
            additions,
            deletions,
            diff,
            language: get_language_from_path(file_path),
            category: categorize_file(file_path),
        });
    }

    // Truncate total diff if needed
    let mut total_lines = 0;
    for f in &mut changed_files {
        let line_count = f.diff.lines().count();
        total_lines += line_count;
        if total_lines > max_total {
            let new_max = max_per_file.saturating_sub(total_lines - max_total).max(20);
            f.diff = truncate_diff(&f.diff, new_max);
        }
    }

    // Get commits
    let commit_lines =
        git_lines(&["log", "--format=%H|%s|%ai|%an", &range], cwd).unwrap_or_default();

    let commits: Vec<CommitInfo> = commit_lines
        .iter()
        .map(|line| {
            let parts: Vec<&str> = line.splitn(4, '|').collect();
            CommitInfo {
                hash: parts.first().unwrap_or(&"").to_string(),
                message: parts.get(1).unwrap_or(&"").to_string(),
                date: parts.get(2).unwrap_or(&"").to_string(),
                author: parts.get(3).unwrap_or(&"").to_string(),
            }
        })
        .collect();

    // Aggregate stats
    let stats = changed_files.iter().fold(
        GitStats {
            additions: 0,
            deletions: 0,
            files_changed: 0,
        },
        |acc, f| GitStats {
            additions: acc.additions + f.additions,
            deletions: acc.deletions + f.deletions,
            files_changed: acc.files_changed + 1,
        },
    );

    Ok(GitAnalysis {
        base_branch: base_branch.to_string(),
        head_branch: head_branch.to_string(),
        changed_files,
        stats,
        commits,
    })
}
