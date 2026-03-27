use anyhow::{bail, Result};
use serde::Deserialize;

use crate::types::{LLMOutput, ResolvedLLMProvider, LLMProviderKind, RiskLevel};

const SYSTEM_PROMPT: &str = r#"你是一个资深的代码审查专家和测试顾问。你的任务是分析代码变更，帮助开发者在提交测试前发现潜在问题。

你必须输出严格的 JSON 格式，不要输出任何其他内容。

输出要求：
- 每条建议必须具体、可操作，直接关联到具体的代码变更
- 不要说"请注意边界情况"这种笼统废话，要说"验证 calculatePrice() 在 discount=0 时是否返回原价"
- 优先级必须区分清楚：critical 表示很可能出 bug，low 表示只是建议
- 如果没有明显风险，不要硬凑建议
- 根据变更的实际内容给出检查项，不要给出和变更无关的通用建议
- 测试建议要具体：说明测试什么场景、验证什么预期结果

JSON Schema:
{
  "summary": "一句话总结这次变更的风险概况",
  "riskLevel": "high | medium | low",
  "checklist": [
    {
      "id": "CHK-001",
      "priority": "critical | high | medium | low",
      "category": "数据一致性 | 权限 | 边界值 | 兼容性 | 并发 | 性能 | 安全 | UI/交互 | API契约 | 配置 | 其他",
      "title": "简短标题",
      "description": "具体要检查什么、怎么检查",
      "relatedFiles": ["相关文件路径"],
      "verificationMethod": "manual | unit-test | e2e-test | api-test"
    }
  ],
  "testSuggestions": [
    {
      "type": "existing | new",
      "path": "已有测试路径(type=existing时)",
      "description": "测试描述",
      "reason": "为什么需要这个测试"
    }
  ],
  "warnings": ["需要特别注意的事项"]
}"#;

const USER_PROMPT_PREFIX: &str = "请分析以下代码变更，输出 JSON 格式的自测检查清单。\n\n";

pub async fn analyze_llm(
    context_text: &str,
    provider: &ResolvedLLMProvider,
) -> Result<LLMOutput> {
    match provider.provider {
        LLMProviderKind::Anthropic => analyze_with_anthropic(context_text, provider).await,
        LLMProviderKind::Copilot => analyze_with_copilot(context_text, provider).await,
    }
}

async fn analyze_with_anthropic(
    context_text: &str,
    provider: &ResolvedLLMProvider,
) -> Result<LLMOutput> {
    let api_key = provider
        .api_key
        .as_ref()
        .ok_or_else(|| anyhow::anyhow!("Anthropic provider 缺少 API Key"))?;

    let client = reqwest::Client::new();
    let body = serde_json::json!({
        "model": provider.model,
        "max_tokens": 8192,
        "system": SYSTEM_PROMPT,
        "messages": [
            { "role": "user", "content": format!("{}{}", USER_PROMPT_PREFIX, context_text) }
        ]
    });

    let response = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        bail!("Anthropic 请求失败 ({}): {}", status, truncate_error(&error_text));
    }

    let data: AnthropicResponse = response.json().await?;
    let text: String = data
        .content
        .iter()
        .filter(|b| b.block_type == "text")
        .filter_map(|b| b.text.as_ref())
        .cloned()
        .collect();

    parse_llm_output(&text)
}

async fn analyze_with_copilot(
    context_text: &str,
    provider: &ResolvedLLMProvider,
) -> Result<LLMOutput> {
    let token = provider
        .token
        .as_ref()
        .ok_or_else(|| anyhow::anyhow!("Copilot provider 缺少访问 token"))?;

    let base_url = provider
        .base_url
        .as_deref()
        .unwrap_or("https://api.githubcopilot.com");

    let client = reqwest::Client::new();
    let body = serde_json::json!({
        "model": provider.model,
        "stream": false,
        "messages": [
            { "role": "system", "content": SYSTEM_PROMPT },
            { "role": "user", "content": format!("{}{}", USER_PROMPT_PREFIX, context_text) }
        ]
    });

    let response = client
        .post(format!("{}/chat/completions", base_url))
        .header("authorization", format!("Bearer {}", token))
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        bail!("Copilot 请求失败 ({}): {}", status, truncate_error(&error_text));
    }

    let data: CopilotResponse = response.json().await?;
    let text: String = data
        .choices
        .unwrap_or_default()
        .iter()
        .filter_map(|c| c.message.as_ref())
        .filter_map(|m| extract_copilot_text(&m.content))
        .collect();

    if text.is_empty() {
        bail!("Copilot 返回了空响应");
    }

    parse_llm_output(&text)
}

#[derive(Debug, Deserialize)]
struct AnthropicResponse {
    content: Vec<AnthropicContentBlock>,
}

#[derive(Debug, Deserialize)]
struct AnthropicContentBlock {
    #[serde(rename = "type")]
    block_type: String,
    text: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CopilotResponse {
    choices: Option<Vec<CopilotChoice>>,
}

#[derive(Debug, Deserialize)]
struct CopilotChoice {
    message: Option<CopilotMessage>,
}

#[derive(Debug, Deserialize)]
struct CopilotMessage {
    content: Option<serde_json::Value>,
}

fn extract_copilot_text(content: &Option<serde_json::Value>) -> Option<String> {
    match content {
        Some(serde_json::Value::String(s)) => Some(s.clone()),
        Some(serde_json::Value::Array(arr)) => {
            let text: String = arr
                .iter()
                .filter_map(|item| {
                    if item.get("type")?.as_str()? == "text" {
                        item.get("text")?.as_str().map(String::from)
                    } else {
                        None
                    }
                })
                .collect();
            Some(text)
        }
        _ => None,
    }
}

fn parse_llm_output(text: &str) -> Result<LLMOutput> {
    let json_str = text.trim();

    // Handle markdown code blocks
    let re = regex::Regex::new(r"```(?:json)?\s*\n?([\s\S]*?)\n?```").unwrap();
    let extracted = if let Some(caps) = re.captures(json_str) {
        caps.get(1).map(|m| m.as_str().trim()).unwrap_or(json_str)
    } else {
        json_str
    };

    // Try direct parse
    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(extracted) {
        return Ok(validate_output(&parsed));
    }

    // Try to find JSON object in mixed text
    let re2 = regex::Regex::new(r#"\{[\s\S]*"summary"[\s\S]*"checklist"[\s\S]*\}"#).unwrap();
    if let Some(m) = re2.find(text) {
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(m.as_str()) {
            return Ok(validate_output(&parsed));
        }
    }

    // Fallback
    Ok(LLMOutput {
        summary: "无法解析 LLM 输出，请查看原始结果".to_string(),
        risk_level: RiskLevel::Medium,
        checklist: Vec::new(),
        test_suggestions: Vec::new(),
        warnings: vec![format!("LLM 输出解析失败。原始输出:\n\n{}", text)],
    })
}

fn validate_output(parsed: &serde_json::Value) -> LLMOutput {
    let summary = parsed
        .get("summary")
        .and_then(|v| v.as_str())
        .unwrap_or("无摘要")
        .to_string();

    let risk_level = parsed
        .get("riskLevel")
        .and_then(|v| v.as_str())
        .map(|s| match s {
            "high" => RiskLevel::High,
            "low" => RiskLevel::Low,
            _ => RiskLevel::Medium,
        })
        .unwrap_or(RiskLevel::Medium);

    let checklist = parsed
        .get("checklist")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    let test_suggestions = parsed
        .get("testSuggestions")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    let warnings = parsed
        .get("warnings")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();

    LLMOutput {
        summary,
        risk_level,
        checklist,
        test_suggestions,
        warnings,
    }
}

fn truncate_error(text: &str) -> String {
    if text.len() > 400 {
        format!("{}...", &text[..400])
    } else {
        text.to_string()
    }
}
