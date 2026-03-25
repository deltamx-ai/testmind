import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TestMindConfig } from './types.js'

export function exec(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }).trim()
}

export function execLines(cmd: string, cwd: string): string[] {
  const output = exec(cmd, cwd)
  return output ? output.split('\n').filter(Boolean) : []
}

export function isGitRepo(dir: string): boolean {
  try {
    exec('git rev-parse --is-inside-work-tree', dir)
    return true
  } catch {
    return false
  }
}

export function detectBaseBranch(cwd: string): string {
  const candidates = ['main', 'master', 'develop']
  for (const branch of candidates) {
    try {
      exec(`git rev-parse --verify ${branch}`, cwd)
      return branch
    } catch {
      continue
    }
  }
  // fallback: first remote HEAD
  try {
    const ref = exec('git symbolic-ref refs/remotes/origin/HEAD', cwd)
    return ref.replace('refs/remotes/origin/', '')
  } catch {
    return 'main'
  }
}

export function branchExists(cwd: string, branch: string): boolean {
  try {
    exec(`git rev-parse --verify ${branch}`, cwd)
    return true
  } catch {
    try {
      exec(`git rev-parse --verify origin/${branch}`, cwd)
      return true
    } catch {
      return false
    }
  }
}

export function getCurrentBranch(cwd: string): string {
  return exec('git rev-parse --abbrev-ref HEAD', cwd)
}

export function getLanguageFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin',
    rb: 'ruby', php: 'php', cs: 'csharp', swift: 'swift',
    vue: 'vue', svelte: 'svelte',
    css: 'css', scss: 'scss', less: 'less',
    sql: 'sql', graphql: 'graphql',
    json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
    md: 'markdown', html: 'html', xml: 'xml',
    sh: 'shell', bash: 'shell', zsh: 'shell',
    dockerfile: 'dockerfile',
  }
  return map[ext] ?? ext
}

export function loadConfig(cwd: string): TestMindConfig {
  const configPath = join(cwd, '.testmindrc.json')
  if (existsSync(configPath)) {
    try {
      return JSON.parse(readFileSync(configPath, 'utf-8'))
    } catch {
      return {}
    }
  }
  return {}
}

export function truncateDiff(diff: string, maxLines: number): string {
  const lines = diff.split('\n')
  if (lines.length <= maxLines) return diff
  const headCount = Math.floor(maxLines * 0.65)
  const tailCount = Math.floor(maxLines * 0.3)
  const omitted = lines.length - headCount - tailCount
  return [
    ...lines.slice(0, headCount),
    `\n... (${omitted} lines omitted) ...\n`,
    ...lines.slice(-tailCount),
  ].join('\n')
}
