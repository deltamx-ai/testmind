# TestMind MVP-0: Code-Change-Driven Self-Test Advisor

## 定位

一个 CLI 工具。开发者提交 PR 前运行一次，自动分析代码变更，输出结构化的自测检查清单。

不依赖 Jira，不需要数据库，不需要 Web UI。唯一的输入是一个 git 分支。

## 核心假设

> 代码变更本身包含了足够的信息来推断"什么可能出问题"。
> Jira 是可选补充，不是必要前提。

## 使用方式

```bash
# 基本用法：分析当前分支相对于 main 的变更
testmind

# 指定基准分支
testmind --base develop

# 指定目标分支
testmind --branch feature/login-refactor

# 指定仓库路径
testmind --repo /path/to/project

# 输出到文件
testmind --output checklist.md
```

默认行为：
- `--base`: 自动检测主分支 (main/master/develop)
- `--branch`: 当前分支
- `--repo`: 当前工作目录
- 输出到 stdout

## 分析管道

```
┌─────────────┐
│  CLI 入口    │  解析参数，校验 git 仓库
└──────┬──────┘
       │
┌──────▼──────┐
│ 1. Git Diff  │  获取变更文件列表、diff 内容、变更统计
└──────┬──────┘
       │
┌──────▼──────────┐
│ 2. 依赖追踪      │  分析变更文件的 import/export，找出受影响的消费方
└──────┬──────────┘
       │
┌──────▼──────────┐
│ 3. 历史风险分析   │  git log 统计同区域的修改频率和 fix commit 密度
└──────┬──────────┘
       │
┌──────▼──────────┐
│ 4. 测试覆盖扫描   │  匹配变更文件与已有测试文件的对应关系
└──────┬──────────┘
       │
┌──────▼──────────┐
│ 5. 上下文组装     │  把以上结果打包成结构化 context
└──────┬──────────┘
       │
┌──────▼──────────┐
│ 6. LLM 分析      │  调用 Claude，生成结构化检查清单
└──────┬──────────┘
       │
┌──────▼──────────┐
│ 7. 报告生成      │  输出 Markdown 格式的自测清单
└─────────────────┘
```

## 各阶段详细设计

### Stage 1: Git Diff 采集

输入：base branch, head branch, repo path

输出：
```typescript
interface GitAnalysis {
  baseBranch: string
  headBranch: string
  changedFiles: ChangedFile[]
  stats: { additions: number; deletions: number; filesChanged: number }
  commits: CommitInfo[]
}

interface ChangedFile {
  path: string
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  additions: number
  deletions: number
  diff: string           // 裁剪后的 diff 内容（控制 token）
  language: string       // 通过扩展名推断
  category: FileCategory // 见下方分类
}

type FileCategory =
  | 'source'       // 业务源码
  | 'test'         // 测试文件
  | 'config'       // 配置文件
  | 'style'        // 样式文件
  | 'migration'    // 数据库迁移
  | 'api-schema'   // API 定义 (OpenAPI, GraphQL schema)
  | 'ci'           // CI/CD 配置
  | 'docs'         // 文档
  | 'other'
```

文件分类规则：
- `**/*.test.*`, `**/*.spec.*`, `**/__tests__/**` → test
- `**/*.config.*`, `**/.*rc*`, `**/tsconfig*` → config
- `**/*.css`, `**/*.scss`, `**/*.less` → style
- `**/migrations/**`, `**/migrate*` → migration
- `**/openapi*`, `**/*.graphql` → api-schema
- `.github/**`, `Jenkinsfile`, `Dockerfile` → ci
- `**/*.md`, `**/docs/**` → docs
- 其余 → source

Diff 裁剪策略：
- 单文件 diff 超过 200 行时，只保留前 100 行 + 后 50 行 + "... 省略 N 行"
- 总 diff 超过 3000 行时，按文件重要性排序截断（source > config > test > 其余）

### Stage 2: 依赖追踪

输入：changedFiles (source 类型), repo path

输出：
```typescript
interface DependencyAnalysis {
  impactedFiles: ImpactedFile[]
  sharedModules: string[]     // 被多处引用的变更文件
  entryPoints: string[]       // 受影响的入口文件（页面、API route）
}

interface ImpactedFile {
  path: string
  reason: string              // "imports ChangedModule from './changed-file'"
  depth: number               // 依赖层级（1=直接，2=间接）
}
```

实现策略：
- 对变更的 source 文件，用正则扫描项目中哪些文件 import 了它
- 只追踪 1-2 层深度，避免爆炸
- 识别入口文件模式：`pages/**`, `app/**/page.*`, `src/routes/**`, `api/**`

扫描方式（轻量，不做 AST）：
```
正则匹配: from ['"].*<changed-file-stem>['"]
正则匹配: require\(['"].*<changed-file-stem>['"]\)
正则匹配: import\(['"].*<changed-file-stem>['"]\)
```

### Stage 3: 历史风险分析

输入：changedFiles, repo path

输出：
```typescript
interface HistoryAnalysis {
  hotspots: Hotspot[]
  recentFixCommits: FixCommit[]
}

interface Hotspot {
  path: string
  commitCount: number         // 最近 90 天的修改次数
  fixCount: number            // 含 fix/bug/hotfix 关键词的 commit 数
  riskLevel: 'high' | 'medium' | 'low'
}

interface FixCommit {
  hash: string
  message: string
  date: string
  files: string[]             // 与当前变更文件的交集
}
```

实现：
- `git log --since="90 days ago" --format=... -- <file>` 统计每个变更文件的修改频率
- 用关键词匹配 fix/bug/hotfix/patch/resolve/revert 识别修复类 commit
- commitCount > 10 或 fixCount > 3 → high risk
- commitCount > 5 或 fixCount > 1 → medium risk
- 其余 → low risk

### Stage 4: 测试覆盖扫描

输入：changedFiles (source 类型), repo path

输出：
```typescript
interface TestCoverage {
  covered: CoverageItem[]     // 有对应测试的变更文件
  uncovered: string[]         // 没有对应测试的变更文件
  relatedTests: string[]      // 所有相关测试文件路径
  coverageRatio: number       // covered / total source files
}

interface CoverageItem {
  sourcePath: string
  testPaths: string[]
}
```

匹配策略（不需要跑 coverage 工具，做文件名匹配）：
- `src/utils/auth.ts` → 查找 `**/*auth*.test.*`, `**/*auth*.spec.*`, `**/__tests__/*auth*.*`
- `src/components/LoginForm.tsx` → 查找 `**/*LoginForm*.test.*`, `**/*login-form*.test.*`
- 匹配规则：文件名 stem（忽略大小写和连字符/驼峰转换）

### Stage 5: 上下文组装

把前四个阶段的结果组装成 LLM 可消费的结构化上下文。

关键原则：
- 控制总 token 量在 30K 以内（留空间给输出）
- 按重要性排序裁剪
- 结构化，不要堆砌原文

组装优先级：
1. 变更统计摘要（必含）
2. 高风险文件的 diff（必含）
3. 受影响的入口文件列表（必含）
4. 测试覆盖缺口（必含）
5. 历史热区信息（必含）
6. 中低风险文件的 diff（按空间裁剪）
7. 依赖关系详情（按空间裁剪）

### Stage 6: LLM 分析

模型：Claude (Sonnet 或 Opus，可配置)

Prompt 结构：

```
System Prompt:
你是一个资深的代码审查专家和测试顾问。你的任务是分析代码变更，
帮助开发者在提交测试前发现潜在问题。

你必须输出严格的 JSON 格式（schema 见下方）。

输出要求：
- 每条建议必须具体、可操作，不要说"请注意边界情况"这种废话
- 建议必须直接关联到具体的代码变更
- 优先级必须区分清楚
- 如果没有明显风险，不要硬凑建议

User Prompt:
## 变更概要
{stats summary}

## 变更文件与 Diff
{diffs, truncated}

## 受影响的消费方
{impacted files}

## 历史风险热区
{hotspots}

## 测试覆盖情况
{coverage info}

请分析以上变更，输出 JSON 格式的自测检查清单。
```

输出 Schema：
```typescript
interface LLMOutput {
  summary: string                    // 一句话总结这次变更的风险概况
  riskLevel: 'high' | 'medium' | 'low'
  checklist: CheckItem[]
  testSuggestions: TestSuggestion[]
  warnings: string[]                 // 需要特别注意的事项
}

interface CheckItem {
  id: string                         // "CHK-001"
  priority: 'critical' | 'high' | 'medium' | 'low'
  category: string                   // "数据一致性" / "权限" / "边界值" / "兼容性" 等
  title: string                      // 简短标题
  description: string                // 具体要检查什么、怎么检查
  relatedFiles: string[]             // 关联的变更文件
  verificationMethod: 'manual' | 'unit-test' | 'e2e-test' | 'api-test'
}

interface TestSuggestion {
  type: 'existing' | 'new'
  path?: string                      // existing: 已有测试路径
  description: string                // new: 建议写什么测试
  reason: string                     // 为什么需要这个测试
}
```

### Stage 7: 报告生成

输出 Markdown 格式：

```markdown
# TestMind 自测检查清单

> 分支: feature/xxx → main | 变更: 12 files (+234 -56) | 风险等级: MEDIUM

## 概要
{LLM summary}

## 检查清单

### Critical
- [ ] **CHK-001** [数据一致性] 验证订单金额计算在折扣为 0 时的行为
  - 文件: `src/services/order.ts`
  - 验证方式: 单元测试

### High
- [ ] **CHK-002** [权限] 确认管理员和普通用户分别访问 /admin/settings 的结果
  - 文件: `src/middleware/auth.ts`, `src/pages/admin/settings.tsx`
  - 验证方式: 手动测试

### Medium
...

## 测试建议

### 建议运行的已有测试
- `tests/services/order.test.ts` — 覆盖了订单计算逻辑的变更
- `tests/e2e/checkout.spec.ts` — 覆盖了结账流程的完整路径

### 建议新增的测试
- 为 `src/utils/discount.ts` 添加边界值测试（折扣率 0%、100%、负数）
  - 原因: 该文件无任何测试覆盖，且处于高修改频率区域

## 风险热区
| 文件 | 近 90 天修改 | Bug 修复 | 风险 |
|------|-------------|---------|------|
| src/services/order.ts | 14 次 | 5 次 | HIGH |
| src/utils/discount.ts | 8 次 | 2 次 | MEDIUM |

## 测试覆盖缺口
以下变更文件没有找到对应测试：
- `src/utils/discount.ts`
- `src/components/PriceDisplay.tsx`

## 注意事项
{warnings}

---
Generated by TestMind MVP-0 | {timestamp}
```

## 技术实现

### 技术栈
- **语言**: TypeScript
- **运行时**: Node.js (>=18)
- **包管理**: pnpm
- **CLI 框架**: commander
- **LLM SDK**: @anthropic-ai/sdk
- **构建**: tsup (简单打包)

### 项目结构

```
src/
├── cli.ts                    # CLI 入口，参数解析
├── pipeline.ts               # 管道编排，串联各阶段
├── stages/
│   ├── git-analyzer.ts       # Stage 1: diff 采集
│   ├── dependency-tracer.ts  # Stage 2: 依赖追踪
│   ├── history-analyzer.ts   # Stage 3: 历史风险
│   ├── test-scanner.ts       # Stage 4: 测试覆盖
│   ├── context-builder.ts    # Stage 5: 上下文组装
│   └── llm-analyzer.ts       # Stage 6: LLM 分析
├── reporter.ts               # Stage 7: Markdown 报告
├── types.ts                  # 类型定义
└── utils.ts                  # 工具函数（git 命令封装等）
```

### 配置

支持项目级配置文件 `.testmindrc.json`（可选）：

```json
{
  "baseBranch": "develop",
  "model": "claude-sonnet-4-20250514",
  "maxDiffLines": 3000,
  "historyDays": 90,
  "language": "zh-CN",
  "excludePatterns": [
    "**/*.lock",
    "**/generated/**"
  ]
}
```

环境变量：
- `ANTHROPIC_API_KEY`: Claude API 密钥（必须）
- `TESTMIND_MODEL`: 模型覆盖
- `TESTMIND_BASE_BRANCH`: 默认基准分支覆盖

### 错误处理

- 非 git 仓库 → 明确报错退出
- 无 API Key → 提示设置方法后退出
- 无变更 → 提示"没有变更需要分析"后退出
- LLM 返回格式异常 → 降级输出原文 + 警告
- diff 过大 → 自动裁剪 + 提示被截断的文件

## 不做的事情

- 不接 Jira（MVP-0 不需要）
- 不做 Web UI
- 不做数据库存储
- 不做测试执行
- 不做历史结果对比
- 不做团队协作功能

## 成功标准

1. 在一个真实项目上运行，30 秒内输出结果
2. 生成的检查清单中 >60% 的条目被开发者认为"有用"
3. 能正确识别测试覆盖缺口
4. 能识别高风险修改区域
