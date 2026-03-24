import type { AnalysisContext } from '../types.js'

const MAX_CONTEXT_CHARS = 80_000 // ~20K tokens

export function buildContext(ctx: AnalysisContext): string {
  const sections: string[] = []
  let totalChars = 0

  function addSection(title: string, content: string, required: boolean = false) {
    const section = `## ${title}\n\n${content}\n`
    if (required || totalChars + section.length < MAX_CONTEXT_CHARS) {
      sections.push(section)
      totalChars += section.length
    }
  }

  // 1. Change summary (required)
  const { git } = ctx
  const summaryLines = [
    `分支: ${git.headBranch} → ${git.baseBranch}`,
    `变更: ${git.stats.filesChanged} 个文件 (+${git.stats.additions} -${git.stats.deletions})`,
    `提交: ${git.commits.length} 个`,
    '',
    '### 变更文件列表',
    '',
    ...git.changedFiles.map(f => {
      const risk = ctx.history.hotspots.find(h => h.path === f.path)
      const riskTag = risk?.riskLevel === 'high' ? ' [HIGH RISK]' :
        risk?.riskLevel === 'medium' ? ' [MEDIUM RISK]' : ''
      return `- \`${f.path}\` (${f.status}, +${f.additions} -${f.deletions}) [${f.category}]${riskTag}`
    }),
  ]
  addSection('变更概要', summaryLines.join('\n'), true)

  // 2. Commits (required)
  if (git.commits.length > 0) {
    const commitList = git.commits.slice(0, 20).map(c => `- ${c.hash.slice(0, 7)} ${c.message}`)
    addSection('提交记录', commitList.join('\n'), true)
  }

  // 3. High-risk file diffs (required)
  const highRiskFiles = git.changedFiles.filter(f => {
    const hotspot = ctx.history.hotspots.find(h => h.path === f.path)
    return f.category === 'source' && (hotspot?.riskLevel === 'high' || hotspot?.riskLevel === 'medium')
  })
  const normalFiles = git.changedFiles.filter(f =>
    f.category === 'source' && !highRiskFiles.includes(f),
  )

  if (highRiskFiles.length > 0) {
    const diffs = highRiskFiles.map(f => `### ${f.path}\n\`\`\`diff\n${f.diff}\n\`\`\``).join('\n\n')
    addSection('高风险文件 Diff', diffs, true)
  }

  // 4. Test coverage gaps (required)
  const { testCoverage } = ctx
  const coverageContent = [
    `覆盖率: ${(testCoverage.coverageRatio * 100).toFixed(0)}% (${testCoverage.covered.length}/${testCoverage.covered.length + testCoverage.uncovered.length})`,
    '',
  ]
  if (testCoverage.uncovered.length > 0) {
    coverageContent.push('### 无测试覆盖的变更文件')
    coverageContent.push(...testCoverage.uncovered.map(p => `- \`${p}\``))
  }
  if (testCoverage.covered.length > 0) {
    coverageContent.push('', '### 已有测试覆盖')
    for (const item of testCoverage.covered) {
      coverageContent.push(`- \`${item.sourcePath}\` → ${item.testPaths.map(t => `\`${t}\``).join(', ')}`)
    }
  }
  addSection('测试覆盖情况', coverageContent.join('\n'), true)

  // 5. History hotspots (required)
  const riskyHotspots = ctx.history.hotspots.filter(h => h.riskLevel !== 'low')
  if (riskyHotspots.length > 0) {
    const table = [
      '| 文件 | 近期修改 | Bug修复 | 风险 |',
      '|------|---------|---------|------|',
      ...riskyHotspots.map(h => `| \`${h.path}\` | ${h.commitCount} | ${h.fixCount} | ${h.riskLevel.toUpperCase()} |`),
    ]
    addSection('历史风险热区', table.join('\n'), true)
  }

  // 6. Impacted files
  if (ctx.dependencies.impactedFiles.length > 0) {
    const deps = ctx.dependencies.impactedFiles.map(f =>
      `- \`${f.path}\` — ${f.reason}`,
    )
    if (ctx.dependencies.entryPoints.length > 0) {
      deps.unshift(
        '### 受影响的入口文件',
        ...ctx.dependencies.entryPoints.map(e => `- \`${e}\``),
        '',
        '### 受影响的消费方',
      )
    }
    addSection('依赖影响面', deps.join('\n'))
  }

  // 7. Normal file diffs (truncated to fit)
  if (normalFiles.length > 0) {
    const diffs = normalFiles.map(f => `### ${f.path}\n\`\`\`diff\n${f.diff}\n\`\`\``).join('\n\n')
    addSection('其他变更文件 Diff', diffs)
  }

  // 8. Config/migration changes
  const configFiles = git.changedFiles.filter(f =>
    f.category === 'config' || f.category === 'migration' || f.category === 'api-schema',
  )
  if (configFiles.length > 0) {
    const list = configFiles.map(f => `### ${f.path} [${f.category}]\n\`\`\`diff\n${f.diff}\n\`\`\``).join('\n\n')
    addSection('配置/迁移/Schema 变更', list)
  }

  return sections.join('\n')
}
