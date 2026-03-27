use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

use anyhow::Result;
use regex::Regex;

use crate::types::{ChangedFile, DependencyAnalysis, FileCategory, ImpactedFile};
use crate::utils::git_lines;

lazy_static! {
    static ref ENTRY_PATTERNS: Vec<Regex> = vec![
        Regex::new(r"^(src/)?pages/").unwrap(),
        Regex::new(r"^(src/)?app/.*/page\.").unwrap(),
        Regex::new(r"^(src/)?app/.*/route\.").unwrap(),
        Regex::new(r"^(src/)?routes/").unwrap(),
        Regex::new(r"^(src/)?api/").unwrap(),
        Regex::new(r"^(src/)?server/routes/").unwrap(),
    ];
}

fn get_import_stem(file_path: &str) -> String {
    let base = Path::new(file_path)
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    let without_ext = Regex::new(r"\.(ts|tsx|js|jsx|vue|svelte)$")
        .unwrap()
        .replace(&base, "")
        .to_string();

    if without_ext == "index" {
        Path::new(file_path)
            .parent()
            .and_then(|p| p.file_name())
            .unwrap_or_default()
            .to_string_lossy()
            .to_string()
    } else {
        without_ext
    }
}

fn build_import_patterns(file_path: &str) -> Vec<Regex> {
    let without_ext = Regex::new(r"\.(ts|tsx|js|jsx|vue|svelte)$")
        .unwrap()
        .replace(file_path, "")
        .to_string();
    let stem = get_import_stem(file_path);
    let escaped_stem = regex::escape(&stem);
    let mut patterns = Vec::new();

    patterns.push(Regex::new(&format!(r#"from\s+['"].*{}['"]"#, escaped_stem)).unwrap());
    patterns.push(Regex::new(&format!(r#"require\s*\(\s*['"].*{}['"]\s*\)"#, escaped_stem)).unwrap());
    patterns.push(Regex::new(&format!(r#"import\s*\(\s*['"].*{}['"]\s*\)"#, escaped_stem)).unwrap());

    // Also match by directory path segments
    let parts: Vec<&str> = without_ext.split('/').collect();
    if parts.len() >= 2 {
        let path_segments = parts[parts.len() - 2..].join("/");
        let escaped_path = regex::escape(&path_segments);
        patterns.push(Regex::new(&format!(r#"from\s+['"].*{}['"]"#, escaped_path)).unwrap());
    }

    patterns
}

fn is_entry_point(file_path: &str) -> bool {
    ENTRY_PATTERNS.iter().any(|p| p.is_match(file_path))
}

pub async fn trace_dependencies(
    changed_files: &[ChangedFile],
    cwd: &str,
    exclude_patterns: &[String],
    max_impacted_files: usize,
) -> Result<DependencyAnalysis> {
    let _ = exclude_patterns; // reserved for future use

    let source_files: Vec<&ChangedFile> = changed_files
        .iter()
        .filter(|f| f.category == FileCategory::Source)
        .collect();

    if source_files.is_empty() {
        return Ok(DependencyAnalysis {
            impacted_files: Vec::new(),
            shared_modules: Vec::new(),
            entry_points: Vec::new(),
        });
    }

    // Get all source files in the repo
    let all_files = git_lines(
        &["ls-files", "*.ts", "*.tsx", "*.js", "*.jsx", "*.vue", "*.svelte"],
        cwd,
    )
    .unwrap_or_default();

    let mut impacted_map: HashMap<String, ImpactedFile> = HashMap::new();
    let mut import_counts: HashMap<String, usize> = HashMap::new();
    let mut entry_points: HashSet<String> = HashSet::new();

    let changed_paths: HashSet<&str> = changed_files.iter().map(|f| f.path.as_str()).collect();

    for changed in &source_files {
        let patterns = build_import_patterns(&changed.path);
        let mut importer_count = 0;

        for candidate in &all_files {
            if candidate == &changed.path || changed_paths.contains(candidate.as_str()) {
                continue;
            }

            let file_path = Path::new(cwd).join(candidate);
            if let Ok(content) = fs::read_to_string(&file_path) {
                for pattern in &patterns {
                    if pattern.is_match(&content) {
                        importer_count += 1;
                        impacted_map.entry(candidate.clone()).or_insert_with(|| ImpactedFile {
                            path: candidate.clone(),
                            reason: format!("imports from {}", changed.path),
                            depth: 1,
                        });
                        if is_entry_point(candidate) {
                            entry_points.insert(candidate.clone());
                        }
                        break;
                    }
                }
            }
        }

        if importer_count > 2 {
            import_counts.insert(changed.path.clone(), importer_count);
        }
    }

    // Check if changed files themselves are entry points
    for changed in &source_files {
        if is_entry_point(&changed.path) {
            entry_points.insert(changed.path.clone());
        }
    }

    // Sort shared modules by import count descending
    let mut shared_modules: Vec<(String, usize)> = import_counts.into_iter().collect();
    shared_modules.sort_by(|a, b| b.1.cmp(&a.1));
    let shared_modules: Vec<String> = shared_modules.into_iter().map(|(path, _)| path).collect();

    let mut impacted_files: Vec<ImpactedFile> = impacted_map.into_values().collect();
    impacted_files.truncate(max_impacted_files);

    Ok(DependencyAnalysis {
        impacted_files,
        shared_modules,
        entry_points: entry_points.into_iter().collect(),
    })
}
