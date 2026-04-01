use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use globset::{Glob, GlobSet, GlobSetBuilder};
use walkdir::WalkDir;

use crate::types::{ChangedFile, FileCategory, KnowledgeItem, KnowledgeKind, KnowledgeMatch};

fn default_knowledge_dir(cwd: &str) -> PathBuf {
    Path::new(cwd).join("knowledge")
}

fn compile_globset(patterns: &[String]) -> Option<GlobSet> {
    if patterns.is_empty() {
        return None;
    }

    let mut builder = GlobSetBuilder::new();
    for pattern in patterns {
        if let Ok(glob) = Glob::new(pattern) {
            builder.add(glob);
        }
    }

    builder.build().ok()
}

fn load_item(path: &Path) -> Result<Option<KnowledgeItem>> {
    let content =
        fs::read_to_string(path).with_context(|| format!("Failed to read {}", path.display()))?;
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default();

    let mut item = match ext {
        "yaml" | "yml" => serde_yaml::from_str::<KnowledgeItem>(&content)
            .with_context(|| format!("Failed to parse YAML {}", path.display()))?,
        "json" => serde_json::from_str::<KnowledgeItem>(&content)
            .with_context(|| format!("Failed to parse JSON {}", path.display()))?,
        _ => return Ok(None),
    };

    item.path = Some(path.to_string_lossy().to_string());
    Ok(Some(item))
}

pub fn load_knowledge_base(cwd: &str, knowledge_dir: Option<&str>) -> Result<Vec<KnowledgeItem>> {
    let root = knowledge_dir
        .map(|dir| {
            let path = PathBuf::from(dir);
            if path.is_absolute() {
                path
            } else {
                Path::new(cwd).join(path)
            }
        })
        .unwrap_or_else(|| default_knowledge_dir(cwd));

    if !root.exists() {
        return Ok(Vec::new());
    }

    let mut items = Vec::new();
    for entry in WalkDir::new(&root)
        .into_iter()
        .filter_map(|entry| entry.ok())
    {
        if !entry.file_type().is_file() {
            continue;
        }

        if let Some(item) = load_item(entry.path())? {
            items.push(item);
        }
    }

    Ok(items)
}

fn normalize_path(path: &str) -> String {
    path.replace('\\', "/")
}

fn infer_modules(changed_files: &[ChangedFile]) -> Vec<String> {
    let mut modules = Vec::new();

    for file in changed_files {
        let normalized = normalize_path(&file.path);
        let segments: Vec<&str> = normalized.split('/').collect();
        let module = match segments.as_slice() {
            ["src", module, ..] => Some((*module).to_string()),
            ["app", module, ..] => Some((*module).to_string()),
            ["pages", module, ..] => Some((*module).to_string()),
            ["services", module, ..] => Some((*module).to_string()),
            [module, ..] if !module.contains('.') => Some((*module).to_string()),
            _ => None,
        };

        if let Some(module) = module {
            if !modules.contains(&module) {
                modules.push(module);
            }
        }
    }

    modules
}

fn score_item(
    item: &KnowledgeItem,
    changed_files: &[ChangedFile],
    changed_modules: &[String],
) -> Option<KnowledgeMatch> {
    let mut score = 0usize;
    let mut reasons = Vec::new();

    let matcher = compile_globset(&item.file_patterns);
    let normalized_paths: Vec<String> = changed_files
        .iter()
        .map(|f| normalize_path(&f.path))
        .collect();

    if let Some(globset) = matcher {
        let matched_paths: Vec<String> = normalized_paths
            .iter()
            .filter(|path| globset.is_match(path.as_str()))
            .cloned()
            .collect();

        if !matched_paths.is_empty() {
            score += matched_paths.len() * 4;
            reasons.push(format!("匹配文件模式: {}", matched_paths.join(", ")));
        }
    }

    if let Some(module) = item.module.as_ref() {
        if changed_modules.iter().any(|m| m == module) {
            score += 3;
            reasons.push(format!("匹配模块: {}", module));
        }
    }

    let lower_blob = normalized_paths.join(" ").to_lowercase();
    let matched_tags: Vec<String> = item
        .tags
        .iter()
        .filter(|tag| lower_blob.contains(&tag.to_lowercase()))
        .cloned()
        .collect();
    if !matched_tags.is_empty() {
        score += matched_tags.len() * 2;
        reasons.push(format!("匹配标签: {}", matched_tags.join(", ")));
    }

    if score == 0 {
        return None;
    }

    Some(KnowledgeMatch {
        item: item.clone(),
        score,
        reasons,
    })
}

pub fn retrieve_relevant_knowledge(
    changed_files: &[ChangedFile],
    knowledge_items: &[KnowledgeItem],
    max_items: usize,
) -> Vec<KnowledgeMatch> {
    let source_like_changes = changed_files
        .iter()
        .filter(|f| {
            matches!(
                f.category,
                FileCategory::Source
                    | FileCategory::Config
                    | FileCategory::Migration
                    | FileCategory::ApiSchema
            )
        })
        .cloned()
        .collect::<Vec<_>>();

    let changed_modules = infer_modules(&source_like_changes);
    let mut matches: Vec<KnowledgeMatch> = knowledge_items
        .iter()
        .filter_map(|item| score_item(item, &source_like_changes, &changed_modules))
        .collect();

    matches.sort_by(|a, b| {
        b.score
            .cmp(&a.score)
            .then_with(|| {
                let left = match a.item.kind {
                    KnowledgeKind::Requirement => 0,
                    KnowledgeKind::BugPattern => 1,
                    KnowledgeKind::Decision => 2,
                };
                let right = match b.item.kind {
                    KnowledgeKind::Requirement => 0,
                    KnowledgeKind::BugPattern => 1,
                    KnowledgeKind::Decision => 2,
                };
                left.cmp(&right)
            })
            .then_with(|| a.item.id.cmp(&b.item.id))
    });
    matches.truncate(max_items);
    matches
}

#[cfg(test)]
mod tests {
    use crate::types::{ChangedFile, FileCategory, FileStatus, KnowledgeItem, KnowledgeKind};

    use super::retrieve_relevant_knowledge;

    #[test]
    fn matches_by_pattern_and_module() {
        let changed_files = vec![ChangedFile {
            path: "src/auth/login.rs".to_string(),
            status: FileStatus::Modified,
            additions: 1,
            deletions: 1,
            diff: String::new(),
            language: "rust".to_string(),
            category: FileCategory::Source,
        }];

        let item = KnowledgeItem {
            id: "REQ-AUTH-001".to_string(),
            kind: KnowledgeKind::Requirement,
            title: "OTP expires".to_string(),
            summary: None,
            module: Some("auth".to_string()),
            tags: vec!["login".to_string()],
            file_patterns: vec!["src/auth/**/*.rs".to_string()],
            acceptance: vec!["Expired OTP rejected".to_string()],
            checks: Vec::new(),
            source: None,
            path: None,
        };

        let matches = retrieve_relevant_knowledge(&changed_files, &[item], 10);
        assert_eq!(matches.len(), 1);
        assert!(matches[0].score >= 7);
    }
}
