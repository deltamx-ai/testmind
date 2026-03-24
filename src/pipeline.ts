import type { AnalysisContext, LLMOutput, TestMindConfig } from './types.js'
import { analyzeGit } from './stages/git-analyzer.js'
import { traceDependencies } from './stages/dependency-tracer.js'
import { analyzeHistory } from './stages/history-analyzer.js'
import { scanTestCoverage } from './stages/test-scanner.js'
import { buildContext } from './stages/context-builder.js'
import { analyzeLLM } from './stages/llm-analyzer.js'
import { generateReport } from './reporter.js'

interface PipelineOptions {
  cwd: string
  baseBranch: string
  headBranch: string
  config: TestMindConfig
}

function log(stage: string, message: string) {
  process.stderr.write(`  [${stage}] ${message}\n`)
}

export async function runPipeline(options: PipelineOptions): Promise<string> {
  const { cwd, baseBranch, headBranch, config } = options

  // Stage 1: Git analysis
  log('1/6', '分析 Git 变更...')
  const git = await analyzeGit(cwd, baseBranch, headBranch)

  if (git.changedFiles.length === 0) {
    return `没有发现 ${headBranch} 相对于 ${baseBranch} 的变更。`
  }

  const sourceCount = git.changedFiles.filter(f => f.category === 'source').length
  log('1/6', `发现 ${git.changedFiles.length} 个变更文件 (${sourceCount} 个源码文件)`)

  // Stage 2 & 3 & 4: Run in parallel
  log('2/6', '追踪依赖关系...')
  log('3/6', '分析历史风险...')
  log('4/6', '扫描测试覆盖...')

  const [dependencies, history, testCoverage] = await Promise.all([
    traceDependencies(git.changedFiles, cwd, config.excludePatterns),
    analyzeHistory(git.changedFiles, cwd, config.historyDays),
    scanTestCoverage(git.changedFiles, cwd),
  ])

  log('2/6', `${dependencies.impactedFiles.length} 个受影响文件, ${dependencies.entryPoints.length} 个入口`)
  log('3/6', `${history.hotspots.filter(h => h.riskLevel !== 'low').length} 个风险热区`)
  log('4/6', `覆盖率 ${(testCoverage.coverageRatio * 100).toFixed(0)}%, ${testCoverage.uncovered.length} 个无覆盖`)

  // Stage 5: Build context
  log('5/6', '组装分析上下文...')
  const ctx: AnalysisContext = { git, dependencies, history, testCoverage }
  const contextText = buildContext(ctx)

  // Stage 6: LLM analysis
  const model = config.model ?? process.env.TESTMIND_MODEL ?? 'claude-sonnet-4-20250514'
  log('6/6', `调用 LLM 分析 (${model})...`)
  const llmResult = await analyzeLLM(contextText, model)
  log('6/6', `生成 ${llmResult.checklist.length} 条检查项`)

  // Stage 7: Generate report
  return generateReport(ctx, llmResult)
}
