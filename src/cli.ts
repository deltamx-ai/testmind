import { resolve } from 'node:path'
import { writeFileSync } from 'node:fs'
import { Command } from 'commander'
import { branchExists, isGitRepo, detectBaseBranch, getCurrentBranch, loadConfig } from './utils.js'
import { runPipeline } from './pipeline.js'

const program = new Command()

program
  .name('testmind')
  .description('Code-change-driven self-test advisor')
  .version('0.1.0')
  .option('-b, --base <branch>', 'base branch to compare against')
  .option('--head <branch>', 'head branch to analyze')
  .option('--branch <branch>', 'target branch to analyze (deprecated alias of --head)')
  .option('-p, --provider <provider>', 'llm provider: auto | anthropic | copilot')
  .option('-m, --model <model>', 'llm model id')
  .option('-r, --repo <path>', 'repository path', '.')
  .option('-o, --output <file>', 'output to file instead of stdout')
  .option('-v, --verbose', 'show detailed analysis process')
  .option('--dry-run', 'show analysis scope without calling LLM')
  .action(async (opts) => {
    const cwd = resolve(opts.repo)

    // Validate git repo
    if (!isGitRepo(cwd)) {
      console.error(`错误: ${cwd} 不是一个 Git 仓库`)
      process.exit(1)
    }

    // Load config
    const fileConfig = loadConfig(cwd)
    const config = {
      ...fileConfig,
      provider: opts.provider ?? fileConfig.provider,
      model: opts.model ?? fileConfig.model,
      verbose: opts.verbose ?? fileConfig.verbose ?? false,
      dryRun: opts.dryRun ?? false,
    }

    // Determine branches
    const baseBranch = opts.base ?? config.baseBranch ?? process.env.TESTMIND_BASE_BRANCH ?? detectBaseBranch(cwd)
    const headBranch = opts.head ?? opts.branch ?? config.headBranch ?? process.env.TESTMIND_HEAD_BRANCH ?? getCurrentBranch(cwd)

    if (!branchExists(cwd, baseBranch)) {
      console.error(`错误: 基准分支不存在 (${baseBranch})。请通过 --base 指定有效分支。`)
      process.exit(1)
    }

    if (!branchExists(cwd, headBranch)) {
      console.error(`错误: 目标分支不存在 (${headBranch})。请通过 --head 指定有效分支。`)
      process.exit(1)
    }

    if (baseBranch === headBranch) {
      console.error(`错误: 基准分支和目标分支相同 (${baseBranch})。请传入两个不同分支，例如 --base main --head feature/foo。`)
      process.exit(1)
    }

    console.error(`\nTestMind MVP-0`)
    console.error(`${'─'.repeat(40)}`)
    console.error(`仓库: ${cwd}`)
    console.error(`分析: ${headBranch} → ${baseBranch}`)
    console.error('')

    try {
      const report = await runPipeline({ cwd, baseBranch, headBranch, config })

      if (opts.output) {
        const outPath = resolve(opts.output)
        writeFileSync(outPath, report, 'utf-8')
        console.error(`\n报告已保存到: ${outPath}`)
      } else {
        console.log(report)
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`\n错误: ${message}`)
      process.exit(1)
    }
  })

program.parse()
