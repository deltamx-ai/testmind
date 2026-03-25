import { execSync, spawnSync } from 'node:child_process'
import type { LLMProviderKind, ResolvedLLMProvider, TestMindConfig } from '../types.js'

const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-20250514'
const DEFAULT_COPILOT_MODEL = 'gpt-4.1'
const DEFAULT_COPILOT_BASE_URL = 'https://api.githubcopilot.com'

export function resolveLLMProvider(config: TestMindConfig): ResolvedLLMProvider {
  const requestedProvider = getRequestedProvider(config)
  const requestedModel = getRequestedModel(config)

  // Step 1: If provider is explicitly set, resolve it directly
  if (requestedProvider === 'anthropic') {
    return resolveAnthropicProvider(config, requestedModel)
  }
  if (requestedProvider === 'copilot') {
    return resolveCopilotProviderOrThrow(config, requestedModel)
  }

  // Step 2: Infer from model name
  const inferredProvider = inferProviderFromModel(requestedModel)
  if (inferredProvider === 'anthropic') {
    return resolveAnthropicProvider(config, requestedModel)
  }
  if (inferredProvider === 'copilot') {
    return resolveCopilotProviderOrThrow(config, requestedModel)
  }

  // Step 3: Auto-detect — try Anthropic first (simpler auth), then Copilot
  const anthropicKey = getAnthropicApiKey(config)
  if (anthropicKey) {
    return {
      provider: 'anthropic',
      model: requestedModel ?? DEFAULT_ANTHROPIC_MODEL,
      displayName: `anthropic/${requestedModel ?? DEFAULT_ANTHROPIC_MODEL}`,
      apiKey: anthropicKey,
      authSource: config.anthropicApiKey ? 'config' : 'env',
    }
  }

  const copilot = resolveCopilotProvider(config, requestedModel)
  if (copilot) return copilot

  throw new Error(
    '未找到可用的 LLM provider。\n' +
    '可选方式:\n' +
    '1. 设置 ANTHROPIC_API_KEY 使用 Anthropic\n' +
    '2. 设置 TESTMIND_COPILOT_TOKEN 使用 Copilot\n' +
    '3. 通过 --provider 或配置文件显式指定',
  )
}

function getRequestedProvider(config: TestMindConfig): LLMProviderKind | 'auto' {
  const value = config.provider ?? process.env.TESTMIND_PROVIDER ?? 'auto'
  return value === 'anthropic' || value === 'copilot' ? value : 'auto'
}

function getRequestedModel(config: TestMindConfig): string | undefined {
  return config.model ?? process.env.TESTMIND_MODEL
}

function inferProviderFromModel(model?: string): LLMProviderKind | undefined {
  if (!model) return undefined

  if (model.startsWith('claude')) return 'anthropic'
  if (
    model.startsWith('gpt') ||
    model.startsWith('o1') ||
    model.startsWith('o3') ||
    model.startsWith('gemini') ||
    model.startsWith('grok') ||
    model.startsWith('raptor')
  ) {
    return 'copilot'
  }

  return undefined
}

function resolveAnthropicProvider(config: TestMindConfig, model?: string): ResolvedLLMProvider {
  const apiKey = getAnthropicApiKey(config)
  if (!apiKey) {
    throw new Error(
      '已指定 provider=anthropic，但未设置 ANTHROPIC_API_KEY。\n' +
      '请设置: export ANTHROPIC_API_KEY=your-key-here',
    )
  }

  const resolvedModel = model ?? DEFAULT_ANTHROPIC_MODEL
  return {
    provider: 'anthropic',
    model: resolvedModel,
    displayName: `anthropic/${resolvedModel}`,
    apiKey,
    authSource: config.anthropicApiKey ? 'config' : 'env',
  }
}

function resolveCopilotProviderOrThrow(config: TestMindConfig, model?: string): ResolvedLLMProvider {
  const provider = resolveCopilotProvider(config, model)
  if (provider) return provider

  throw new Error(
    '已指定 provider=copilot，但未获取到 Copilot token。\n' +
    '请设置 TESTMIND_COPILOT_TOKEN，或通过 copilotTokenCommand 配置获取命令。',
  )
}

function resolveCopilotProvider(
  config: TestMindConfig,
  model?: string,
): ResolvedLLMProvider | undefined {
  // Try direct token (env var or config)
  const directToken = getDirectCopilotToken(config)
  if (directToken) {
    return buildCopilotProvider(config, model, directToken.token, directToken.source)
  }

  // Try command-based token
  const commandToken = getCommandCopilotToken(config)
  if (commandToken) {
    return buildCopilotProvider(config, model, commandToken.token, commandToken.source)
  }

  // Try copilot-auth Python module
  const authToken = getCopilotAuthToken(config)
  if (authToken) {
    return buildCopilotProvider(config, model, authToken, 'copilot-auth')
  }

  return undefined
}

function buildCopilotProvider(
  config: TestMindConfig,
  model: string | undefined,
  token: string,
  authSource: ResolvedLLMProvider['authSource'],
): ResolvedLLMProvider {
  const resolvedModel = model ?? process.env.TESTMIND_COPILOT_MODEL ?? DEFAULT_COPILOT_MODEL
  const baseUrl = config.copilotBaseUrl ?? process.env.TESTMIND_COPILOT_BASE_URL ?? DEFAULT_COPILOT_BASE_URL

  return {
    provider: 'copilot',
    model: resolvedModel,
    displayName: `copilot/${resolvedModel}`,
    token,
    baseUrl,
    authSource,
  }
}

function getAnthropicApiKey(config: TestMindConfig): string | undefined {
  return cleanToken(config.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY)
}

function getDirectCopilotToken(config: TestMindConfig): { token: string; source: ResolvedLLMProvider['authSource'] } | undefined {
  const configToken = cleanToken(config.copilotToken)
  if (configToken) {
    return { token: configToken, source: 'config' }
  }

  const envToken = cleanToken(
    process.env.TESTMIND_COPILOT_TOKEN ??
    process.env.GITHUB_COPILOT_TOKEN ??
    process.env.COPILOT_TOKEN,
  )

  if (envToken) {
    return { token: envToken, source: 'env' }
  }

  return undefined
}

function getCommandCopilotToken(config: TestMindConfig): { token: string; source: ResolvedLLMProvider['authSource'] } | undefined {
  const command = config.copilotTokenCommand ?? process.env.TESTMIND_COPILOT_TOKEN_CMD
  if (!command) return undefined

  try {
    const output = execSync(command, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
    })
    const token = parseTokenOutput(output)
    return token ? { token, source: 'command' } : undefined
  } catch {
    return undefined
  }
}

function getCopilotAuthToken(config: TestMindConfig): string | undefined {
  const python = config.copilotPython ?? process.env.TESTMIND_COPILOT_PYTHON ?? 'python3'
  const code = [
    'import sys',
    'import copilot_auth as ca',
    'def handle(token):',
    '    print(token)',
    'ca.authenticate_copilot_token([handle])',
  ].join('\n')

  try {
    const result = spawnSync(python, ['-c', code], {
      encoding: 'utf-8',
      timeout: 60_000,
    })

    if (result.status !== 0) {
      return undefined
    }

    return parseTokenOutput(result.stdout)
  } catch {
    return undefined
  }
}

function parseTokenOutput(output: string): string | undefined {
  const trimmed = output.trim()
  if (!trimmed) return undefined

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>
    return cleanToken(
      typeof parsed.token === 'string' ? parsed.token
        : typeof parsed.access_token === 'string' ? parsed.access_token
        : typeof parsed.copilot_token === 'string' ? parsed.copilot_token
        : undefined,
    )
  } catch {
    const lastLine = trimmed.split('\n').map(line => line.trim()).filter(Boolean).at(-1)
    return cleanToken(lastLine)
  }
}

function cleanToken(value?: string): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}
