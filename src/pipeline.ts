import type { AnalysisContext, DependencyAnalysis, HistoryAnalysis, LLMOutput, TestCoverage, TestMindConfig } from './types.js'
import { analyzeGit } from './stages/git-analyzer.js'
import { traceDependencies } from './stages/dependency-tracer.js'
import { analyzeHistory } from './stages/history-analyzer.js'
import { scanTestCoverage } from './stages/test-scanner.js'
import { buildContext } from './stages/context-builder.js'
import { analyzeLLM } from './stages/llm-analyzer.js'
import { generateReport } from './reporter.js'
import { resolveLLMProvider } from './llm/provider.js'

interface PipelineOptions {
  cwd: string
  baseBranch: string
  headBranch: string
  config: TestMindConfig
}

function log(stage: string, message: string) {
  process.stderr.write(`  [${stage}] ${message}\n`)
}

function verbose(config: TestMindConfig, message: string) {
  if (config.verbose) {
    process.stderr.write(`  [verbose] ${message}\n`)
  }
}

export async function runPipeline(options: PipelineOptions): Promise<string> {
  const { cwd, baseBranch, headBranch, config } = options

  // Stage 1: Git analysis
  log('1/6', '分析 Git 变更...')
  const git = await analyzeGit(cwd, baseBranch, headBranch, {
    maxDiffLinesPerFile: config.maxDiffLinesPerFile,
    maxDiffLines: config.maxDiffLines,
  })

  if (git.changedFiles.length === 0) {
    return `没有发现 ${headBranch} 相对于 ${baseBranch} 的变更。`
  }

  const sourceCount = git.changedFiles.filter(f => f.category === 'source').length
  log('1/6', `发现 ${git.changedFiles.length} 个变更文件 (${sourceCount} 个源码文件)`)

  // Stage 2 & 3 & 4: Run in parallel
  log('2/6', '追踪依赖关系...')
  log('3/6', '分析历史风险...')
  log('4/6', '扫描测试覆盖...')

  const stageWarnings: string[] = []

  const [dependencies, history, testCoverage] = await Promise.all([
    traceDependencies(git.changedFiles, cwd, config.excludePatterns, config.maxImpactedFiles).catch(err => {
      stageWarnings.push(`[依赖追踪] 分析失败，数据可能不完整: ${err instanceof Error ? err.message : String(err)}`)
      return { impactedFiles: [], sharedModules: [], entryPoints: [] } satisfies DependencyAnalysis
    }),
    analyzeHistory(git.changedFiles, cwd, config.historyDays).catch(err => {
      stageWarnings.push(`[历史分析] 分析失败，数据可能不完整: ${err instanceof Error ? err.message : String(err)}`)
      return { hotspots: [], recentFixCommits: [] } satisfies HistoryAnalysis
    }),
    scanTestCoverage(git.changedFiles, cwd).catch(err => {
      stageWarnings.push(`[测试扫描] 分析失败，数据可能不完整: ${err instanceof Error ? err.message : String(err)}`)
      return { covered: [], uncovered: [], relatedTests: [], coverageRatio: 0 } satisfies TestCoverage
    }),
  ])

  log('2/6', `${dependencies.impactedFiles.length} 个受影响文件, ${dependencies.entryPoints.length} 个入口`)
  log('3/6', `${history.hotspots.filter(h => h.riskLevel !== 'low').length} 个风险热区`)
  log('4/6', `覆盖率 ${(testCoverage.coverageRatio * 100).toFixed(0)}%, ${testCoverage.uncovered.length} 个无覆盖`)

  // Stage 5: Build context
  log('5/6', '组装分析上下文...')
  const ctx: AnalysisContext = { git, dependencies, history, testCoverage, stageWarnings }
  const contextText = buildContext(ctx, config.maxContextChars)
  verbose(config, `上下文大小: ${contextText.length} 字符 (~${Math.round(contextText.length / 4)} tokens)`)

  // Dry run: output analysis scope without calling LLM
  if (config.dryRun) {
    const lines = [
      '# TestMind Dry Run — 分析范围',
      '',
      `> 分支: ${headBranch} → ${baseBranch}`,
      `> 变更: ${git.stats.filesChanged} 文件 (+${git.stats.additions} -${git.stats.deletions})`,
      '',
      '## 变更文件',
      ...git.changedFiles.map(f => `- \`${f.path}\` [${f.category}] (${f.status}, +${f.additions} -${f.deletions})`),
      '',
      '## 依赖影响',
      `- 受影响文件: ${dependencies.impactedFiles.length}`,
      `- 入口文件: ${dependencies.entryPoints.length}`,
      `- 共享模块: ${dependencies.sharedModules.length}`,
      '',
      '## 历史风险',
      ...history.hotspots.filter(h => h.riskLevel !== 'low').map(h => `- \`${h.path}\` — ${h.riskLevel.toUpperCase()} (${h.commitCount} commits, ${h.fixCount} fixes)`),
      '',
      '## 测试覆盖',
      `- 覆盖率: ${(testCoverage.coverageRatio * 100).toFixed(0)}%`,
      `- 无覆盖: ${testCoverage.uncovered.length} 文件`,
      '',
      `> 上下文大小: ${contextText.length} 字符 (~${Math.round(contextText.length / 4)} tokens)`,
      '> 使用 --dry-run 模式，已跳过 LLM 分析。',
    ]
    if (stageWarnings.length > 0) {
      lines.push('', '## 警告', ...stageWarnings.map(w => `- ${w}`))
    }
    return lines.join('\n')
  }

  // Stage 6: LLM analysis
  const provider = resolveLLMProvider(config)
  verbose(config, `Provider: ${provider.provider}, Model: ${provider.model}, AuthSource: ${provider.authSource ?? 'N/A'}`)
  log('6/6', `调用 LLM 分析 (${provider.displayName})...`)
  const llmResult = await analyzeLLM(contextText, provider)
  log('6/6', `生成 ${llmResult.checklist.length} 条检查项`)

  // Stage 7: Generate report
  return generateReport(ctx, llmResult)
}
