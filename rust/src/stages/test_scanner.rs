use std::collections::HashSet;
use std::fs;
use std::path::Path;

use anyhow::Result;

use crate::types::{ChangedFile, CoverageItem, FileCategory, TestCoverage};
use crate::utils::git_lines;

fn to_search_variants(stem: &str) -> Vec<String> {
    let mut variants = vec![stem.to_lowercase()];

    // camelCase → kebab-case
    let mut kebab = String::new();
    for (i, c) in stem.chars().enumerate() {
        if c.is_uppercase() && i > 0 {
            kebab.push('-');
            kebab.push(c.to_lowercase().next().unwrap());
        } else {
            kebab.push(c.to_lowercase().next().unwrap());
        }
    }
    if kebab != stem.to_lowercase() {
        variants.push(kebab);
    }

    // kebab-case → camelCase
    let mut camel = String::new();
    let mut capitalize_next = false;
    for c in stem.chars() {
        if c == '-' {
            capitalize_next = true;
        } else if capitalize_next {
            camel.push(c.to_uppercase().next().unwrap());
            capitalize_next = false;
        } else {
            camel.push(c);
        }
    }
    let camel_lower = camel.to_lowercase();
    if camel_lower != stem.to_lowercase() {
        variants.push(camel_lower);
    }

    variants.sort();
    variants.dedup();
    variants
}

fn get_file_stem(file_path: &str) -> String {
    Path::new(file_path)
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string()
}

pub async fn scan_test_coverage(changed_files: &[ChangedFile], cwd: &str) -> Result<TestCoverage> {
    let source_files: Vec<&ChangedFile> = changed_files
        .iter()
        .filter(|f| f.category == FileCategory::Source)
        .collect();

    if source_files.is_empty() {
        return Ok(TestCoverage {
            covered: Vec::new(),
            uncovered: Vec::new(),
            related_tests: Vec::new(),
            coverage_ratio: 0.0,
        });
    }

    // Get all test files in repo
    let test_files =
        git_lines(&["ls-files", "*.test.*", "*.spec.*", "*/__tests__/*"], cwd).unwrap_or_default();

    let test_files_lower: Vec<String> = test_files.iter().map(|f| f.to_lowercase()).collect();

    let mut covered: Vec<CoverageItem> = Vec::new();
    let mut uncovered: Vec<String> = Vec::new();
    let mut all_related_tests: HashSet<String> = HashSet::new();

    for source in &source_files {
        let stem = get_file_stem(&source.path);
        let variants = to_search_variants(&stem);
        let mut matched_tests: Vec<String> = Vec::new();

        for (i, test_file) in test_files.iter().enumerate() {
            let test_lower = &test_files_lower[i];
            let test_stem = get_file_stem(test_file)
                .replace(".test", "")
                .replace(".spec", "")
                .to_lowercase();

            for variant in &variants {
                if test_stem == *variant || test_lower.contains(variant.as_str()) {
                    matched_tests.push(test_file.clone());
                    all_related_tests.insert(test_file.clone());
                    break;
                }
            }
        }

        // Semantic matching: check if any test file imports this source file
        if matched_tests.is_empty() {
            for test_file in &test_files {
                if matched_tests.contains(test_file) {
                    continue;
                }
                let test_path = Path::new(cwd).join(test_file);
                if let Ok(content) = fs::read_to_string(&test_path) {
                    let source_without_ext = source
                        .path
                        .rsplit_once('.')
                        .map(|(base, _)| base)
                        .unwrap_or(&source.path);
                    let source_stem = get_file_stem(&source.path);

                    if content.contains(source_without_ext)
                        || content.contains(&format!("./{}", source_stem))
                        || content.contains(&format!("../{}", source_stem))
                    {
                        matched_tests.push(test_file.clone());
                        all_related_tests.insert(test_file.clone());
                    }
                }
            }
        }

        if !matched_tests.is_empty() {
            covered.push(CoverageItem {
                source_path: source.path.clone(),
                test_paths: matched_tests,
            });
        } else {
            uncovered.push(source.path.clone());
        }
    }

    let total = source_files.len();
    let coverage_ratio = if total > 0 {
        covered.len() as f64 / total as f64
    } else {
        0.0
    };

    Ok(TestCoverage {
        covered,
        uncovered,
        related_tests: all_related_tests.into_iter().collect(),
        coverage_ratio,
    })
}
