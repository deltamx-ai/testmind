use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::process::Command;

use anyhow::{Context, Result};

use crate::types::TestMindConfig;

pub fn exec(command: &str, args: &[&str], cwd: &str) -> Result<String> {
    let output = Command::new(command)
        .args(args)
        .current_dir(cwd)
        .output()
        .with_context(|| format!("Failed to execute: {} {:?}", command, args))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!(
            "Command failed: {} {:?}\n{}",
            command,
            args,
            stderr.trim()
        );
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

pub fn exec_lines(command: &str, args: &[&str], cwd: &str) -> Result<Vec<String>> {
    let output = exec(command, args, cwd)?;
    Ok(if output.is_empty() {
        Vec::new()
    } else {
        output.lines().filter(|l| !l.is_empty()).map(String::from).collect()
    })
}

pub fn git(args: &[&str], cwd: &str) -> Result<String> {
    exec("git", args, cwd)
}

pub fn git_lines(args: &[&str], cwd: &str) -> Result<Vec<String>> {
    exec_lines("git", args, cwd)
}

pub fn is_git_repo(dir: &str) -> bool {
    git(&["rev-parse", "--is-inside-work-tree"], dir).is_ok()
}

pub fn detect_base_branch(cwd: &str) -> String {
    let candidates = ["main", "master", "develop"];
    for branch in &candidates {
        if git(&["rev-parse", "--verify", branch], cwd).is_ok() {
            return branch.to_string();
        }
    }
    // fallback: first remote HEAD
    if let Ok(ref_str) = git(&["symbolic-ref", "refs/remotes/origin/HEAD"], cwd) {
        return ref_str.replace("refs/remotes/origin/", "");
    }
    "main".to_string()
}

pub fn branch_exists(cwd: &str, branch: &str) -> bool {
    if git(&["rev-parse", "--verify", branch], cwd).is_ok() {
        return true;
    }
    let remote = format!("origin/{}", branch);
    git(&["rev-parse", "--verify", &remote], cwd).is_ok()
}

pub fn get_current_branch(cwd: &str) -> Result<String> {
    git(&["rev-parse", "--abbrev-ref", "HEAD"], cwd)
}

pub fn get_language_from_path(file_path: &str) -> String {
    let ext = file_path.rsplit('.').next().unwrap_or("").to_lowercase();
    let map: HashMap<&str, &str> = HashMap::from([
        ("ts", "typescript"), ("tsx", "typescript"), ("js", "javascript"), ("jsx", "javascript"),
        ("py", "python"), ("go", "go"), ("rs", "rust"), ("java", "java"), ("kt", "kotlin"),
        ("rb", "ruby"), ("php", "php"), ("cs", "csharp"), ("swift", "swift"),
        ("vue", "vue"), ("svelte", "svelte"),
        ("css", "css"), ("scss", "scss"), ("less", "less"),
        ("sql", "sql"), ("graphql", "graphql"),
        ("json", "json"), ("yaml", "yaml"), ("yml", "yaml"), ("toml", "toml"),
        ("md", "markdown"), ("html", "html"), ("xml", "xml"),
        ("sh", "shell"), ("bash", "shell"), ("zsh", "shell"),
        ("dockerfile", "dockerfile"),
    ]);
    map.get(ext.as_str()).unwrap_or(&ext.as_str()).to_string()
}

pub fn load_config(cwd: &str) -> TestMindConfig {
    let config_path = Path::new(cwd).join(".testmindrc.json");
    if config_path.exists() {
        if let Ok(content) = fs::read_to_string(&config_path) {
            if let Ok(config) = serde_json::from_str::<TestMindConfig>(&content) {
                return config;
            }
        }
    }
    TestMindConfig::default()
}

pub fn truncate_diff(diff: &str, max_lines: usize) -> String {
    let lines: Vec<&str> = diff.lines().collect();
    if lines.len() <= max_lines {
        return diff.to_string();
    }
    let head_count = (max_lines as f64 * 0.65) as usize;
    let tail_count = (max_lines as f64 * 0.3) as usize;
    let omitted = lines.len() - head_count - tail_count;

    let mut result: Vec<&str> = Vec::new();
    result.extend_from_slice(&lines[..head_count]);
    let omit_msg = format!("\n... ({} lines omitted) ...\n", omitted);
    let mut output = result.join("\n");
    output.push_str(&omit_msg);
    output.push_str(&lines[lines.len() - tail_count..].join("\n"));
    output
}
