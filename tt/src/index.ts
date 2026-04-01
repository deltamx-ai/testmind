#!/usr/bin/env node
/**
 * src/index.ts — TestMind CLI
 *
 * Usage examples:
 *
 *   # Using mock Jira (built-in fixture tickets: PROJ-101, PROJ-210, PROJ-315)
 *   testmind run --ticket PROJ-101 --base main --head feature/reset-password --repo .
 *
 *   # Using real Jira
 *   testmind run --ticket PROJ-101 --base main --head HEAD \
 *     --jira-url https://mycompany.atlassian.net \
 *     --jira-token <PAT>
 *
 *   # With project config file
 *   testmind run --ticket PROJ-101 --base main --config .testmindrc.json
 */

import { Command } from 'commander'
import chalk from 'chalk'
import ora from 'ora'
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { createJiraClient, MOCK_TICKET_KEYS } from './jira/client.js'
import { runPipeline } from './pipeline.js'
import type { ProjectConfig } from './types/index.js'

const program = new Command()

program
  .name('testmind')
  .description('Pre-test code reviewer: compare Jira requirements vs code implementation')
  .version('0.1.0')

// ─── run command ─────────────────────────────────────────────────────────────

program
  .command('run')
  .description('Run the full TestMind pipeline for a ticket + branch')
  .requiredOption('-t, --ticket <key>', 'Jira ticket key (e.g. PROJ-101)')
  .requiredOption('-b, --base <branch>', 'Base branch to diff from (e.g. main)')
  .option('-H, --head <branch>', 'Head branch/ref to diff to (default: HEAD)', 'HEAD')
  .option('-r, --repo <path>', 'Path to git repository root (default: current directory)', '.')
  .option('-o, --output <dir>', 'Output directory for reports (default: .testmind/)', '.testmind')
  .option('--jira-url <url>', 'Jira base URL for real API mode (skips mock)')
  .option('--jira-token <token>', 'Jira Personal Access Token')
  .option('--config <file>', 'Path to .testmindrc.json project config')
  .option('--json', 'Also write raw JSON output alongside markdown reports')
  .action(async (opts) => {
    console.log('')
    console.log(chalk.bold.cyan('  🧠 TestMind') + chalk.gray(' — Pre-test code reviewer'))
    console.log(chalk.gray('  ─────────────────────────────────────'))
    console.log('')

    // ─ Config
    let config: ProjectConfig | undefined
    if (opts.config) {
      const cfgPath = resolve(opts.config)
      if (!existsSync(cfgPath)) {
        console.error(chalk.red(`Config file not found: ${cfgPath}`))
        process.exit(1)
      }
      try {
        config = JSON.parse(readFileSync(cfgPath, 'utf8')) as ProjectConfig
        console.log(chalk.gray(`  Config loaded: ${cfgPath}`))
      } catch {
        console.error(chalk.red('Failed to parse config file as JSON'))
        process.exit(1)
      }
    }

    // ─ Jira client
    const jiraMode = opts.jiraUrl ? 'real' : 'mock'
    const jira = createJiraClient({
      mode: jiraMode,
      baseUrl: opts.jiraUrl,
      token: opts.jiraToken,
    })

    if (jiraMode === 'mock') {
      console.log(
        chalk.yellow(`  ⚠  Using mock Jira. Available tickets: ${MOCK_TICKET_KEYS.join(', ')}`),
      )
    }

    // ─ Fetch ticket
    const ticketSpinner = ora(`  Fetching Jira ticket ${opts.ticket}…`).start()
    let ticket
    try {
      ticket = await jira.getTicket(opts.ticket)
      ticketSpinner.succeed(chalk.green(`  Ticket: ${ticket.key} — ${ticket.summary}`))
    } catch (err) {
      ticketSpinner.fail(chalk.red(`  Failed to fetch ticket: ${err}`))
      process.exit(1)
    }

    console.log('')

    // ─ Run pipeline with progress spinners
    const spinners: Map<number, ReturnType<typeof ora>> = new Map()

    const stageLabels: Record<number, string> = {
      0: '  [0] Git diff analysis',
      1: '  [1] Jira analysis (LLM)',
      2: '  [2] Code analysis (LLM)',
      3: '  [3] Cross-check (LLM)',
      4: '  [4] Report generation',
    }

    let result
    try {
      result = await runPipeline(
        {
          jiraTicket: ticket,
          baseBranch: opts.base,
          headBranch: opts.head,
          repoPath: opts.repo,
          config,
        },
        (stage, _name, status, detail) => {
          if (status === 'start') {
            const s = ora(chalk.gray(stageLabels[stage] ?? `  [${stage}]`)).start()
            spinners.set(stage, s)
          } else if (status === 'done') {
            const s = spinners.get(stage)
            s?.succeed(
              chalk.green(stageLabels[stage] ?? `  [${stage}]`) +
                (detail ? chalk.gray(` — ${detail}`) : ''),
            )
          } else {
            const s = spinners.get(stage)
            s?.fail(
              chalk.red(stageLabels[stage] ?? `  [${stage}]`) +
                (detail ? chalk.gray(` — ${detail}`) : ''),
            )
          }
        },
      )
    } catch (err) {
      console.error('')
      console.error(chalk.red('Pipeline failed:'), err)
      process.exit(1)
    }

    // ─ Write outputs
    const outDir = resolve(opts.output)
    mkdirSync(outDir, { recursive: true })

    const prefix = `${ticket.key}-${Date.now()}`

    const reportAPath = join(outDir, `${prefix}-A-requirements.md`)
    const reportBPath = join(outDir, `${prefix}-B-bugs.md`)
    const reportCPath = join(outDir, `${prefix}-C-checklist.md`)

    writeFileSync(reportAPath, result.finalReports.requirementReport, 'utf8')
    writeFileSync(reportBPath, result.finalReports.bugReport, 'utf8')
    writeFileSync(reportCPath, result.finalReports.checklist, 'utf8')

    if (opts.json) {
      const jsonPath = join(outDir, `${prefix}-raw.json`)
      writeFileSync(
        jsonPath,
        JSON.stringify(
          {
            jiraReport: result.jiraReport,
            codeReport: result.codeReport,
            crossCheckReport: result.crossCheckReport,
          },
          null,
          2,
        ),
        'utf8',
      )
      console.log(chalk.gray(`\n  Raw JSON: ${jsonPath}`))
    }

    // ─ Summary
    const r = result.crossCheckReport
    const riskColor =
      r.riskLevel === 'high' ? chalk.red : r.riskLevel === 'medium' ? chalk.yellow : chalk.green
    const riskLabel = riskColor(r.riskLevel.toUpperCase())

    console.log('')
    console.log(chalk.bold('  ── Results ─────────────────────────────'))
    console.log(`  Risk level:        ${riskLabel}`)
    console.log(`  Requirements:      ${r.requirementCoverage.filter((x) => x.status === 'implemented').length}/${r.requirementCoverage.length} implemented`)
    console.log(`  Potential bugs:    ${r.potentialBugs.filter((b) => b.severity === 'critical').length} critical, ${r.potentialBugs.filter((b) => b.severity === 'high').length} high, ${r.potentialBugs.filter((b) => b.severity === 'medium').length} medium`)
    console.log(`  Missing impl:      ${r.missingImplementations.length}`)
    console.log(`  Unexpected changes: ${r.unexpectedChanges.length}`)
    console.log('')
    console.log(chalk.bold('  ── Reports saved to: ' + chalk.cyan(outDir)))
    console.log(`    A  ${chalk.cyan(reportAPath)}`)
    console.log(`    B  ${chalk.cyan(reportBPath)}`)
    console.log(`    C  ${chalk.cyan(reportCPath)}`)
    console.log('')
    console.log(
      chalk.gray(
        `  LLM: ${result.tokenUsage.calls} calls, ${result.tokenUsage.inputTokens} in / ${result.tokenUsage.outputTokens} out tokens — ${(result.durationMs / 1000).toFixed(1)}s`,
      ),
    )
    console.log('')
  })

// ─── mock-tickets command ─────────────────────────────────────────────────────

program
  .command('mock-tickets')
  .description('List available mock Jira ticket keys')
  .action(() => {
    console.log('\nAvailable mock tickets:\n')
    for (const key of MOCK_TICKET_KEYS) {
      console.log(`  ${chalk.cyan(key)}`)
    }
    console.log()
  })

// ─── parse & run ─────────────────────────────────────────────────────────────

program.parse(process.argv)

// ─── inspect command (prompt debugger) ───────────────────────────────────────

program
  .command('inspect')
  .description('Inspect assembled prompts without calling the LLM')
  .requiredOption('-t, --ticket <key>', 'Mock Jira ticket key (e.g. PROJ-101)')
  .option('-s, --stage <n>', 'Stage to inspect: 1, 2, or 3 (default: 1)', '1')
  .option('--show-chars', 'Show character + token counts per block')
  .option('--show-debug', 'Print block-level include/skip log')
  .option('--max-chars <n>', 'Max chars to print per section', '5000')
  .action(async (opts) => {
    const { createJiraClient } = await import('./jira/client.js')
    const { inspectStage1, inspectStage3 } = await import('./prompt/inspect.js')

    const jira = createJiraClient({ mode: 'mock' })
    const ticket = await jira.getTicket(opts.ticket)
    const inspectOpts = {
      showChars: opts.showChars,
      showDebug: opts.showDebug,
      maxPrintChars: parseInt(opts.maxChars, 10),
    }

    const stage = parseInt(opts.stage, 10)

    if (stage === 1) {
      inspectStage1(ticket, inspectOpts)
    } else if (stage === 3) {
      // Stage 3 needs Stage 1 output — run it first (no LLM needed for mock display)
      console.log(chalk.gray('  Stage 3 needs JiraReport + CodeReport.'))
      console.log(chalk.gray('  Showing with minimal placeholder data.\n'))
      const { runStage1 } = await import('./stages/stage1-jira.js')
      const jiraReport = await import('./prompt/inspect.js').then(() =>
        ({ ticketKey: ticket.key, summary: ticket.summary, requirements: [], acceptanceCriteria: [],
           outOfScope: [], riskFlags: [], ambiguities: [], hasExplicitAC: false })
      )
      const codeReport = {
        implementedFeatures: ['(placeholder)'], modifiedBehaviors: [],
        deletedBehaviors: [], sideEffects: [], testCoverage: { covered: [], uncovered: [] },
        codeSmells: [], affectedFiles: [],
      }
      inspectStage3(jiraReport as any, codeReport, undefined, inspectOpts)
    } else {
      console.log(chalk.yellow('  Stage 2 inspect requires a real git repo. Use --stage 1 or --stage 3.'))
    }
  })
