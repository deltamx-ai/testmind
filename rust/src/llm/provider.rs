use std::process::Command;

use anyhow::{bail, Result};

use crate::types::{AuthSource, LLMProviderKind, ResolvedLLMProvider, TestMindConfig};

const DEFAULT_ANTHROPIC_MODEL: &str = "claude-sonnet-4-20250514";
const DEFAULT_COPILOT_MODEL: &str = "gpt-4.1";
const DEFAULT_COPILOT_BASE_URL: &str = "https://api.githubcopilot.com";

pub fn resolve_llm_provider(config: &TestMindConfig) -> Result<ResolvedLLMProvider> {
    let requested_provider = get_requested_provider(config);
    let requested_model = get_requested_model(config);

    // Step 1: If provider is explicitly set, resolve it directly
    if requested_provider == "anthropic" {
        return resolve_anthropic_provider(config, requested_model.as_deref());
    }
    if requested_provider == "copilot" {
        return resolve_copilot_provider_or_throw(config, requested_model.as_deref());
    }

    // Step 2: Infer from model name
    if let Some(ref model) = requested_model {
        if let Some(inferred) = infer_provider_from_model(model) {
            match inferred {
                LLMProviderKind::Anthropic => {
                    return resolve_anthropic_provider(config, requested_model.as_deref());
                }
                LLMProviderKind::Copilot => {
                    return resolve_copilot_provider_or_throw(config, requested_model.as_deref());
                }
            }
        }
    }

    // Step 3: Auto-detect — try Anthropic first, then Copilot
    if let Some(api_key) = get_anthropic_api_key(config) {
        let model = requested_model
            .as_deref()
            .unwrap_or(DEFAULT_ANTHROPIC_MODEL);
        return Ok(ResolvedLLMProvider {
            provider: LLMProviderKind::Anthropic,
            model: model.to_string(),
            display_name: format!("anthropic/{}", model),
            api_key: Some(api_key),
            base_url: None,
            token: None,
            auth_source: Some(if config.anthropic_api_key.is_some() {
                AuthSource::Config
            } else {
                AuthSource::Env
            }),
        });
    }

    if let Some(copilot) = try_resolve_copilot_provider(config, requested_model.as_deref()) {
        return Ok(copilot);
    }

    bail!(
        "未找到可用的 LLM provider。\n\
         可选方式:\n\
         1. 设置 ANTHROPIC_API_KEY 使用 Anthropic\n\
         2. 设置 TESTMIND_COPILOT_TOKEN 使用 Copilot\n\
         3. 通过 --provider 或配置文件显式指定"
    );
}

fn get_requested_provider(config: &TestMindConfig) -> String {
    config
        .provider
        .clone()
        .or_else(|| std::env::var("TESTMIND_PROVIDER").ok())
        .unwrap_or_else(|| "auto".to_string())
}

fn get_requested_model(config: &TestMindConfig) -> Option<String> {
    config
        .model
        .clone()
        .or_else(|| std::env::var("TESTMIND_MODEL").ok())
}

fn infer_provider_from_model(model: &str) -> Option<LLMProviderKind> {
    if model.starts_with("claude") {
        return Some(LLMProviderKind::Anthropic);
    }
    if model.starts_with("gpt")
        || model.starts_with("o1")
        || model.starts_with("o3")
        || model.starts_with("gemini")
        || model.starts_with("grok")
        || model.starts_with("raptor")
    {
        return Some(LLMProviderKind::Copilot);
    }
    None
}

fn resolve_anthropic_provider(
    config: &TestMindConfig,
    model: Option<&str>,
) -> Result<ResolvedLLMProvider> {
    let api_key = get_anthropic_api_key(config).ok_or_else(|| {
        anyhow::anyhow!(
            "已指定 provider=anthropic，但未设置 ANTHROPIC_API_KEY。\n\
             请设置: export ANTHROPIC_API_KEY=your-key-here"
        )
    })?;

    let resolved_model = model.unwrap_or(DEFAULT_ANTHROPIC_MODEL);
    Ok(ResolvedLLMProvider {
        provider: LLMProviderKind::Anthropic,
        model: resolved_model.to_string(),
        display_name: format!("anthropic/{}", resolved_model),
        api_key: Some(api_key),
        base_url: None,
        token: None,
        auth_source: Some(if config.anthropic_api_key.is_some() {
            AuthSource::Config
        } else {
            AuthSource::Env
        }),
    })
}

fn resolve_copilot_provider_or_throw(
    config: &TestMindConfig,
    model: Option<&str>,
) -> Result<ResolvedLLMProvider> {
    try_resolve_copilot_provider(config, model).ok_or_else(|| {
        anyhow::anyhow!(
            "已指定 provider=copilot，但未获取到 Copilot token。\n\
             请设置 TESTMIND_COPILOT_TOKEN，或通过 copilotTokenCommand 配置获取命令。"
        )
    })
}

fn try_resolve_copilot_provider(
    config: &TestMindConfig,
    model: Option<&str>,
) -> Option<ResolvedLLMProvider> {
    // Try direct token
    if let Some((token, source)) = get_direct_copilot_token(config) {
        return Some(build_copilot_provider(config, model, &token, source));
    }

    // Try command-based token
    if let Some((token, source)) = get_command_copilot_token(config) {
        return Some(build_copilot_provider(config, model, &token, source));
    }

    // Try copilot-auth Python module
    if let Some(token) = get_copilot_auth_token(config) {
        return Some(build_copilot_provider(
            config,
            model,
            &token,
            AuthSource::CopilotAuth,
        ));
    }

    None
}

fn build_copilot_provider(
    config: &TestMindConfig,
    model: Option<&str>,
    token: &str,
    auth_source: AuthSource,
) -> ResolvedLLMProvider {
    let resolved_model = model
        .map(String::from)
        .or_else(|| std::env::var("TESTMIND_COPILOT_MODEL").ok())
        .unwrap_or_else(|| DEFAULT_COPILOT_MODEL.to_string());

    let base_url = config
        .copilot_base_url
        .clone()
        .or_else(|| std::env::var("TESTMIND_COPILOT_BASE_URL").ok())
        .unwrap_or_else(|| DEFAULT_COPILOT_BASE_URL.to_string());

    ResolvedLLMProvider {
        provider: LLMProviderKind::Copilot,
        model: resolved_model.clone(),
        display_name: format!("copilot/{}", resolved_model),
        api_key: None,
        base_url: Some(base_url),
        token: Some(token.to_string()),
        auth_source: Some(auth_source),
    }
}

fn get_anthropic_api_key(config: &TestMindConfig) -> Option<String> {
    clean_token(
        config
            .anthropic_api_key
            .clone()
            .or_else(|| std::env::var("ANTHROPIC_API_KEY").ok()),
    )
}

fn get_direct_copilot_token(config: &TestMindConfig) -> Option<(String, AuthSource)> {
    if let Some(token) = clean_token(config.copilot_token.clone()) {
        return Some((token, AuthSource::Config));
    }

    let env_token = clean_token(
        std::env::var("TESTMIND_COPILOT_TOKEN")
            .ok()
            .or_else(|| std::env::var("GITHUB_COPILOT_TOKEN").ok())
            .or_else(|| std::env::var("COPILOT_TOKEN").ok()),
    );

    env_token.map(|t| (t, AuthSource::Env))
}

fn get_command_copilot_token(config: &TestMindConfig) -> Option<(String, AuthSource)> {
    let command = config
        .copilot_token_command
        .clone()
        .or_else(|| std::env::var("TESTMIND_COPILOT_TOKEN_CMD").ok())?;

    let output = Command::new("sh")
        .arg("-c")
        .arg(&command)
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let token = parse_token_output(&stdout)?;
    Some((token, AuthSource::Command))
}

fn get_copilot_auth_token(config: &TestMindConfig) -> Option<String> {
    let python = config
        .copilot_python
        .clone()
        .or_else(|| std::env::var("TESTMIND_COPILOT_PYTHON").ok())
        .unwrap_or_else(|| "python3".to_string());

    let code = "import sys\nimport copilot_auth as ca\ndef handle(token):\n    print(token)\nca.authenticate_copilot_token([handle])";

    let result = Command::new(&python)
        .arg("-c")
        .arg(code)
        .output()
        .ok()?;

    if !result.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&result.stdout).to_string();
    parse_token_output(&stdout)
}

fn parse_token_output(output: &str) -> Option<String> {
    let trimmed = output.trim();
    if trimmed.is_empty() {
        return None;
    }

    // Try JSON parse
    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(trimmed) {
        let token = parsed
            .get("token")
            .or_else(|| parsed.get("access_token"))
            .or_else(|| parsed.get("copilot_token"))
            .and_then(|v| v.as_str())
            .map(String::from);
        if let Some(t) = clean_token(token) {
            return Some(t);
        }
    }

    // Take last non-empty line
    let last_line = trimmed
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .last();

    clean_token(last_line.map(String::from))
}

fn clean_token(value: Option<String>) -> Option<String> {
    let trimmed = value?.trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}
