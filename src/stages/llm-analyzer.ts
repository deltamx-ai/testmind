import Anthropic from '@anthropic-ai/sdk'
import type { LLMOutput, ResolvedLLMProvider } from '../types.js'

const SYSTEM_PROMPT = `你是一个资深的代码审查专家和测试顾问。你的任务是分析代码变更，帮助开发者在提交测试前发现潜在问题。

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
}`

const USER_PROMPT_PREFIX = `请分析以下代码变更，输出 JSON 格式的自测检查清单。

`

export async function analyzeLLM(
  contextText: string,
  provider: ResolvedLLMProvider,
): Promise<LLMOutput> {
  if (provider.provider === 'anthropic') {
    return analyzeWithAnthropic(contextText, provider)
  }

  return analyzeWithCopilot(contextText, provider)
}

async function analyzeWithAnthropic(
  contextText: string,
  provider: ResolvedLLMProvider,
): Promise<LLMOutput> {
  if (!provider.apiKey) {
    throw new Error('Anthropic provider 缺少 API Key')
  }

  const client = new Anthropic({ apiKey: provider.apiKey })

  const response = await client.messages.create({
    model: provider.model,
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    messages: [
      { role: 'user', content: USER_PROMPT_PREFIX + contextText },
    ],
  })

  const text = response.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')

  return parseLLMOutput(text)
}

async function analyzeWithCopilot(
  contextText: string,
  provider: ResolvedLLMProvider,
): Promise<LLMOutput> {
  if (!provider.token) {
    throw new Error('Copilot provider 缺少访问 token')
  }

  const response = await fetch(`${provider.baseUrl ?? 'https://api.githubcopilot.com'}/chat/completions`, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${provider.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: provider.model,
      stream: false,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: USER_PROMPT_PREFIX + contextText },
      ],
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Copilot 请求失败 (${response.status}): ${truncateError(errorText)}`)
  }

  const data = await response.json() as CopilotChatCompletionResponse
  const text = data.choices
    ?.map(choice => extractCopilotText(choice.message?.content))
    .join('')
    .trim()

  if (!text) {
    throw new Error('Copilot 返回了空响应')
  }

  return parseLLMOutput(text)
}

interface CopilotChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>
    }
  }>
}

function extractCopilotText(content: string | Array<{ type?: string; text?: string }> | undefined): string {
  if (typeof content === 'string') {
    return content
  }

  if (Array.isArray(content)) {
    return content
      .filter(item => item.type === 'text' && typeof item.text === 'string')
      .map(item => item.text)
      .join('')
  }

  return ''
}

function parseLLMOutput(text: string): LLMOutput {
  // Try to extract JSON from the response
  let jsonStr = text.trim()

  // Handle markdown code blocks
  const jsonMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim()
  }

  try {
    const parsed = JSON.parse(jsonStr)
    return validateOutput(parsed)
  } catch {
    // Fallback: return raw text as a single warning
    return {
      summary: '无法解析 LLM 输出，请查看原始结果',
      riskLevel: 'medium',
      checklist: [],
      testSuggestions: [],
      warnings: [`LLM 输出解析失败。原始输出:\n\n${text}`],
    }
  }
}

function validateOutput(parsed: Record<string, unknown>): LLMOutput {
  return {
    summary: typeof parsed.summary === 'string' ? parsed.summary : '无摘要',
    riskLevel: (['high', 'medium', 'low'] as const).includes(parsed.riskLevel as 'high') ? parsed.riskLevel as LLMOutput['riskLevel'] : 'medium',
    checklist: Array.isArray(parsed.checklist) ? parsed.checklist : [],
    testSuggestions: Array.isArray(parsed.testSuggestions) ? parsed.testSuggestions : [],
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
  }
}

function truncateError(text: string): string {
  return text.length > 400 ? `${text.slice(0, 400)}...` : text
}
