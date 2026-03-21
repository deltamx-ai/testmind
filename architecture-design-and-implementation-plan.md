# TestMind 架构设计与实施方案

## 设计哲学

**核心原则：帮助开发者是第一优先级，数据收集与可视化是水到渠成的亮点。**

所有设计决策都围绕一个问题：**开发者能否在 30 秒内获得有价值的自测指引？** 如果不能，其他一切都是空中楼阁。Dashboard 和统计不是目标，而是开发者持续使用后自然沉淀的副产品。

---

## 一、整体架构

```
                        开发者触发入口
                  ┌──────────┼──────────┐
                  │          │          │
              CLI 命令    Web 页面   CI/CD Hook
              (核心)     (增强)      (自动化)
                  │          │          │
                  └──────────┼──────────┘
                             │
                    ┌────────▼────────┐
                    │   Next.js 应用   │
                    │  (全栈单体架构)   │
                    │                  │
                    │  ┌────────────┐  │
                    │  │ API Layer  │  │
                    │  │ /api/*     │  │
                    │  └─────┬──────┘  │
                    │        │         │
                    │  ┌─────▼──────┐  │
                    │  │  核心引擎   │  │
                    │  │ (Engine)   │  │
                    │  └─────┬──────┘  │
                    │        │         │
                    └────────┼────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
      ┌───────▼──────┐ ┌────▼─────┐ ┌──────▼──────┐
      │  数据集成层   │ │  LLM 层  │ │  执行层     │
      │ Jira/Git/CI  │ │ Claude   │ │ Playwright  │
      └──────────────┘ └──────────┘ └─────────────┘
```

### 为什么是这个架构？

**单体优先，引擎可抽离。** 核心分析引擎（Engine）设计为独立模块，CLI 和 Web 共用同一套引擎代码。这意味着：
- CLI 可以直接调用引擎，不需要启动 Web 服务
- Web 通过 API 调用同一个引擎
- 未来如果需要微服务化，引擎可以独立部署
- 但在 MVP 阶段，一切都在一个 Next.js 项目里

---

## 二、核心引擎设计

引擎是整个系统的心脏，必须精心设计。

```
Engine
├── collector/          # 信息采集
│   ├── jira.ts         # Jira 需求采集
│   ├── git-diff.ts     # 代码变更采集
│   ├── codebase.ts     # 代码库上下文（路由、组件、测试文件）
│   └── history.ts      # 历史执行数据（后续加入）
│
├── analyzer/           # 智能分析
│   ├── impact.ts       # 影响范围分析（哪些页面/模块受影响）
│   ├── risk.ts         # 风险评估（变更复杂度、历史 bug 热区）
│   └── prompt.ts       # Prompt 构建与管理
│
├── generator/          # 输出生成
│   ├── checklist.ts    # 自测清单生成（核心产出）
│   ├── test-draft.ts   # Playwright 测试草稿（增值产出）
│   └── report.ts       # 结果报告格式化
│
├── executor/           # 测试执行（可选）
│   ├── runner.ts       # Playwright 执行器
│   ├── artifact.ts     # 截图/视频/trace 管理
│   └── result.ts       # 执行结果解析
│
└── engine.ts           # 引擎入口，编排上述模块
```

### 引擎核心流程

```
输入: { jiraId, branch?, projectConfig }
                │
                ▼
  ┌─────────────────────────────┐
  │  Step 1: 并行信息采集        │
  │  ┌─────────┐  ┌──────────┐  │
  │  │Jira 信息│  │Git Diff  │  │
  │  │标题/描述 │  │变更文件   │  │
  │  │验收标准 │  │变更内容   │  │
  │  └────┬────┘  └────┬─────┘  │
  │       └──────┬─────┘        │
  └──────────────┼──────────────┘
                 ▼
  ┌─────────────────────────────┐
  │  Step 2: 代码库上下文补充    │
  │  - 变更文件关联的路由/页面   │
  │  - 已有测试文件             │
  │  - Page Object / data-testid│
  │  - 相关组件依赖树           │
  └──────────────┬──────────────┘
                 ▼
  ┌─────────────────────────────┐
  │  Step 3: LLM 分析           │
  │  构建 Prompt:               │
  │  - 需求上下文               │
  │  - 代码变更摘要             │
  │  - 代码库结构信息           │
  │  - 项目特定规则（可配置）    │
  │                             │
  │  输出:                      │
  │  - 结构化自测清单           │
  │  - 影响范围判断             │
  │  - 风险等级评估             │
  │  - (可选) 测试草稿          │
  └──────────────┬──────────────┘
                 ▼
  ┌─────────────────────────────┐
  │  Step 4: 输出格式化          │
  │  - CLI: 终端彩色输出/Markdown│
  │  - Web: JSON → UI 渲染     │
  │  - CI: Markdown Comment     │
  └─────────────────────────────┘
                 ▼
  ┌─────────────────────────────┐
  │  Step 5: (可选) 测试执行     │
  │  - 运行生成的测试草稿       │
  │  - 运行已有的相关测试       │
  │  - 收集截图/视频/失败日志   │
  │  - 生成执行报告             │
  └─────────────────────────────┘
```

---

## 三、分步实施计划

### Phase 0：引擎原型验证（第 1-2 周）

**目标：证明 LLM 能生成有价值的自测建议**

#### 做什么

```
testmind/
├── package.json
├── tsconfig.json
├── src/
│   ├── cli.ts                  # CLI 入口
│   ├── engine/
│   │   ├── engine.ts           # 引擎编排
│   │   ├── collector/
│   │   │   ├── jira.ts         # 调 Jira REST API
│   │   │   └── git-diff.ts     # 调 git diff 命令
│   │   ├── analyzer/
│   │   │   └── prompt.ts       # Prompt 模板
│   │   └── generator/
│   │       └── checklist.ts    # 输出自测清单
│   └── config.ts               # 项目配置（Jira URL、LLM key 等）
└── .env
```

#### 具体实现

**CLI 交互设计：**
```bash
# 最简用法 —— 开发者日常使用
$ testmind check PROJ-1234
# 自动检测当前分支 diff，拉取 Jira 信息，生成自测清单

# 指定分支对比
$ testmind check PROJ-1234 --base main --head feature/login

# 输出到文件
$ testmind check PROJ-1234 --output checklist.md

# 只看影响范围，不生成完整清单
$ testmind impact PROJ-1234
```

**自测清单输出示例：**
```markdown
## PROJ-1234: 用户登录页面添加验证码功能

### 影响范围
- 📄 pages/login.tsx（主要变更）
- 📄 components/CaptchaInput.tsx（新增组件）
- 📄 api/auth/login.ts（接口变更）
- ⚠️ 可能影响: pages/register.tsx（共用 AuthLayout）

### 自测清单

#### 🔴 必测（核心路径）
- [ ] 正常登录流程：输入正确用户名密码 + 正确验证码 → 登录成功
- [ ] 验证码刷新：点击验证码图片 → 图片更新
- [ ] 验证码错误：输入错误验证码 → 提示"验证码错误"，不清空密码

#### 🟡 应测（边界情况）
- [ ] 验证码过期：等待超过 60s → 提示"验证码已过期，请刷新"
- [ ] 连续错误：连续 5 次验证码错误 → 账号锁定提示
- [ ] 空验证码：不填验证码直接提交 → 前端校验拦截

#### 🔵 建议测（回归风险）
- [ ] 注册页面：确认 AuthLayout 变更未影响注册流程
- [ ] 记住密码：确认"记住密码"功能与验证码共存正常
- [ ] 移动端适配：验证码组件在移动端的显示和操作

### 已有测试资产
- ✅ tests/login.spec.ts（已有登录测试，需更新）
- ❌ 无验证码相关测试（建议新增）

### 风险提示
- ⚠️ api/auth/login.ts 接口签名变更，需确认其他调用方是否受影响
```

#### 可行性分析

| 项目 | 评估 | 说明 |
|------|------|------|
| Jira API 调用 | ✅ 简单 | REST API，文档完善，只需读取权限 |
| Git diff 获取 | ✅ 简单 | 调用 git 命令即可，无外部依赖 |
| Prompt 工程 | ⚠️ 核心难点 | 需要反复迭代，输出质量直接决定产品价值 |
| Claude API 调用 | ✅ 简单 | SDK 成熟，结构化输出支持好 |
| CLI 工具打包 | ✅ 简单 | tsx 直接运行或用 tsup 打包 |
| **总体风险** | **中等** | **唯一不确定性在 LLM 输出质量，但这正是本阶段要验证的** |

#### 验证标准
- 拿 5-10 个真实 Jira ticket 测试
- 让 2-3 个开发者评价自测清单的有用程度
- 目标：>60% 的建议被开发者认为"有价值"

---

### Phase 1：CLI 工具完善 + 代码上下文增强（第 3-4 周）

**目标：CLI 工具达到日常可用水平，分析质量显著提升**

#### 做什么

```
新增/完善:
├── src/engine/
│   ├── collector/
│   │   └── codebase.ts         # 🆕 代码库上下文采集
│   ├── analyzer/
│   │   ├── impact.ts           # 🆕 影响范围分析
│   │   └── prompt.ts           # 升级 Prompt 策略
│   └── generator/
│       └── test-draft.ts       # 🆕 Playwright 测试草稿生成
├── src/
│   └── config/
│       └── project-config.ts   # 🆕 项目配置管理（.testmindrc）
└── .testmindrc.example         # 🆕 项目配置模板
```

#### 核心增强：代码上下文采集

```typescript
// codebase.ts 的职责
interface CodebaseContext {
  // 1. 路由映射：变更文件 → 对应页面 URL
  routes: RouteMapping[];

  // 2. 已有测试：变更文件关联的测试文件
  existingTests: TestFileInfo[];

  // 3. 可用选择器：页面中的 data-testid 属性
  testSelectors: SelectorInfo[];

  // 4. 组件依赖：变更组件被哪些页面引用
  componentUsages: ComponentUsage[];

  // 5. 最近变更频率：文件的 git log 热度
  changeFrequency: FileHeatMap;
}
```

**为什么这很重要？** Phase 0 只给 LLM 提供 Jira 描述和 diff，LLM 不知道这些代码在项目中的位置和关系。加入代码上下文后，LLM 可以：
- 知道改了哪个页面，而不只是改了哪个文件
- 知道有没有现成的测试可以复用
- 知道变更是否会影响其他页面
- 生成更精准的测试草稿（因为知道 data-testid）

#### 项目配置文件设计

```yaml
# .testmindrc.yml —— 放在项目根目录
project:
  name: "my-web-app"
  framework: "next.js"        # 帮助引擎理解路由结构
  testFramework: "playwright"

jira:
  baseUrl: "https://company.atlassian.net"
  projectKey: "PROJ"

context:
  # 引擎如何找到路由定义
  routePatterns:
    - "src/app/**/page.tsx"       # Next.js App Router
    - "src/pages/**/*.tsx"        # Next.js Pages Router

  # 引擎如何找到测试文件
  testPatterns:
    - "tests/**/*.spec.ts"
    - "e2e/**/*.test.ts"

  # 引擎如何找到 Page Object
  pageObjectPatterns:
    - "tests/pages/**/*.ts"

  # 排除的目录
  excludePatterns:
    - "node_modules"
    - ".next"
    - "dist"

rules:
  # 项目特定规则，会注入到 LLM prompt 中
  - "登录相关变更必须测试 SSO 和本地登录两种方式"
  - "涉及金额计算的变更必须测试精度问题"
  - "API 变更需确认向后兼容性"
```

#### 可行性分析

| 项目 | 评估 | 说明 |
|------|------|------|
| 路由解析 | ⚠️ 中等 | Next.js 的文件路由可以通过 glob 匹配，但动态路由需要额外处理 |
| 测试文件关联 | ✅ 简单 | 通过文件名约定或目录结构匹配 |
| data-testid 提取 | ✅ 简单 | AST 解析或正则匹配 |
| 组件依赖分析 | ⚠️ 中等 | 需要基本的 import 解析，不需要完整 AST |
| 项目配置管理 | ✅ 简单 | YAML 解析，配合 cosmiconfig |
| Playwright 草稿 | ⚠️ 中等 | LLM 生成质量依赖上下文，但"草稿"定位降低了质量要求 |
| **总体风险** | **低** | **主要是工程工作，没有技术不确定性** |

---

### Phase 2：Web 平台 + 持久化（第 5-8 周）

**目标：从个人 CLI 工具进化为团队可用的 Web 平台**

#### 做什么

```
testmind/
├── package.json
├── next.config.ts
├── prisma/
│   └── schema.prisma           # 🆕 数据模型
├── src/
│   ├── app/                    # 🆕 Next.js App Router
│   │   ├── layout.tsx
│   │   ├── page.tsx            # 首页/项目列表
│   │   ├── project/
│   │   │   └── [id]/
│   │   │       ├── page.tsx    # 项目详情
│   │   │       └── settings/
│   │   │           └── page.tsx
│   │   ├── analysis/
│   │   │   └── [id]/
│   │   │       └── page.tsx    # 分析结果页（核心页面）
│   │   └── api/
│   │       ├── analysis/
│   │       │   └── route.ts    # 触发分析
│   │       ├── projects/
│   │       │   └── route.ts    # 项目管理
│   │       └── webhook/
│   │           └── route.ts    # CI/Jira webhook
│   ├── engine/                 # 引擎代码（复用 Phase 0-1）
│   ├── cli.ts                  # CLI 入口（调用同一引擎）
│   └── lib/
│       ├── db.ts               # Prisma client
│       └── auth.ts             # 认证（简单 JWT）
└── docker-compose.yml
```

#### 数据模型设计

```prisma
// 精简到最少必要的模型

model Project {
  id          String   @id @default(cuid())
  name        String
  repoUrl     String
  jiraProject String
  config      Json     // .testmindrc 内容
  createdAt   DateTime @default(now())
  analyses    Analysis[]
}

model Analysis {
  id          String   @id @default(cuid())
  projectId   String
  project     Project  @relation(fields: [projectId], references: [id])
  jiraId      String           // PROJ-1234
  jiraTitle   String
  branch      String?
  commitSha   String?
  triggeredBy String           // "cli" | "web" | "ci"
  status      String           // "pending" | "analyzing" | "done" | "failed"

  // 核心产出
  impactScope   Json?          // 影响范围
  checklist     Json?          // 自测清单（结构化）
  testDrafts    Json?          // 测试草稿代码
  riskLevel     String?        // "low" | "medium" | "high"

  // 执行结果（可选）
  executionStatus  String?     // "pending" | "running" | "passed" | "failed"
  executionResult  Json?       // 测试执行详情
  artifactsPath    String?     // 截图/视频存储路径

  // 开发者反馈
  feedbacks     Feedback[]

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model Feedback {
  id          String   @id @default(cuid())
  analysisId  String
  analysis    Analysis @relation(fields: [analysisId], references: [id])
  itemIndex   Int              // 清单中第几项
  useful      Boolean          // 有用/没用
  comment     String?          // 可选文字反馈
  createdAt   DateTime @default(now())
}
```

**注意：没有 User 表。** 这是刻意的。Phase 2 用简单 JWT + 环境变量控制访问即可，不需要完整的用户系统。用户信息从 JWT token 中解码获取。

#### Web 页面设计

**只做 3 个核心页面：**

**1. 项目列表页（首页）**
```
┌────────────────────────────────────────────┐
│  TestMind                         [+ 接入] │
│────────────────────────────────────────────│
│                                            │
│  📁 my-web-app          最近分析: 2h ago   │
│     PROJ · 23 次分析 · 15 条建议被采纳     │
│                                            │
│  📁 admin-dashboard      最近分析: 1d ago   │
│     ADMIN · 8 次分析 · 6 条建议被采纳      │
│                                            │
└────────────────────────────────────────────┘
```

**2. 分析结果页（核心页面）**
```
┌────────────────────────────────────────────────┐
│  ← PROJ-1234: 登录页添加验证码                  │
│  🟢 分析完成 · 2min ago · CLI 触发              │
│────────────────────────────────────────────────│
│                                                │
│  📍 影响范围                                    │
│  ┌──────────────────────────────────────────┐  │
│  │ pages/login.tsx        主要变更          │  │
│  │ components/Captcha.tsx 新增组件          │  │
│  │ api/auth/login.ts      接口变更          │  │
│  │ ⚠️ pages/register.tsx   可能受影响       │  │
│  └──────────────────────────────────────────┘  │
│                                                │
│  ✅ 自测清单                                   │
│  🔴 必测                                       │
│  ☐ 正常登录 + 正确验证码      [👍] [👎]        │
│  ☐ 验证码刷新                 [👍] [👎]        │
│  ☐ 错误验证码提示             [👍] [👎]        │
│                                                │
│  🟡 应测                                       │
│  ☐ 验证码过期处理             [👍] [👎]        │
│  ☐ 连续错误锁定              [👍] [👎]        │
│  ...                                           │
│                                                │
│  📝 测试草稿                    [复制] [执行]   │
│  ┌──────────────────────────────────────────┐  │
│  │ test('登录 - 正确验证码', async (...) {  │  │
│  │   ...                                    │  │
│  │ });                                      │  │
│  └──────────────────────────────────────────┘  │
│                                                │
└────────────────────────────────────────────────┘
```

**3. 项目设置页**
- 编辑 .testmindrc 配置
- 管理 Jira 连接
- 自定义规则

#### 可行性分析

| 项目 | 评估 | 说明 |
|------|------|------|
| Next.js App Router | ✅ 简单 | 成熟框架，文档完善 |
| Prisma + SQLite | ✅ 简单 | ORM 屏蔽数据库差异，后续可无痛切换 PG |
| 分析结果页 UI | ⚠️ 中等 | 需要设计好交互，但技术上不复杂 |
| 反馈收集 | ✅ 简单 | 每条建议旁加 👍👎 按钮 |
| CLI 与 Web 共用引擎 | ✅ 简单 | 引擎本身是纯函数，不依赖运行环境 |
| Webhook 接入 | ⚠️ 中等 | 需要处理 Jira/GitHub webhook 格式 |
| Docker 部署 | ✅ 简单 | Next.js standalone 模式，单容器 |
| **总体风险** | **低** | **纯工程工作，技术选型成熟** |

---

### Phase 3：自动化集成 + 测试执行（第 9-12 周）

**目标：从"手动触发"进化为"开发流程中自动运行"**

#### 做什么

**3a. CI/CD 集成**

```yaml
# .github/workflows/testmind.yml
# PR 创建/更新时自动触发分析
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  testmind:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run TestMind Analysis
        run: npx testmind check ${{ github.event.pull_request.title }} --ci
      - name: Comment PR
        uses: actions/github-script@v7
        with:
          script: |
            // 将分析结果作为 PR comment 发布
```

**效果：** 开发者创建 PR → 自动出现自测清单 comment → 开发者照着测 → 减少提测 bug

**3b. Playwright 测试执行**

```
src/engine/executor/
├── runner.ts           # Playwright 执行管理
│   - 接收测试草稿代码
│   - 在隔离环境中执行
│   - 超时控制、重试策略
│
├── artifact.ts         # 产物管理
│   - 截图收集与存储
│   - 视频录制（失败时）
│   - Trace 文件保存
│   - Network HAR 日志
│
├── result.ts           # 结果解析
│   - 解析 Playwright JSON report
│   - 提取失败原因
│   - 调用 LLM 生成人类可读的失败摘要
│
└── sandbox.ts          # 沙箱环境
    - 临时目录创建
    - 依赖安装
    - 环境变量注入
    - 执行后清理
```

**关键设计决策：测试执行是可选功能。**
- 自测清单是核心，永远有用
- 测试执行是增强，可能失败、可能不稳定
- 永远不要让执行失败阻塞开发者获取自测清单
- 执行结果作为参考而非判定

**3c. Jira 状态回写（可选）**

```
分析完成后 → 在 Jira ticket 上添加 comment：
"TestMind 已分析此需求，发现 3 个高风险点，建议关注：
1. 验证码过期逻辑
2. 并发登录场景
3. 与注册页面的布局兼容性
详情：https://testmind.internal/analysis/xxx"
```

#### 可行性分析

| 项目 | 评估 | 说明 |
|------|------|------|
| GitHub Actions 集成 | ✅ 简单 | 标准 CI 工作流，文档完善 |
| PR Comment 自动发布 | ✅ 简单 | GitHub API 成熟 |
| Playwright 沙箱执行 | ⚠️ 中等 | 需要处理环境隔离、依赖安装、超时 |
| 产物存储 | ⚠️ 中等 | 本地文件系统 → 后续可迁移到 S3/MinIO |
| LLM 失败摘要 | ✅ 简单 | 已有的 LLM 调用能力复用 |
| Jira API 回写 | ✅ 简单 | REST API，只需写入权限 |
| **总体风险** | **中等** | **Playwright 沙箱是主要挑战，但可以先从简单模式开始** |

---

### Phase 4：数据沉淀 + Dashboard（第 13-16 周）

**目标：将积累的数据转化为团队洞察**

**前提：此时已有 2-3 个月的使用数据，Dashboard 才有意义。**

#### 做什么

**4a. 数据库升级**

从 SQLite 迁移到 PostgreSQL（如果数据量需要）：
```bash
# Prisma 让这件事非常简单
# 1. 改 schema.prisma 的 provider
# 2. 运行 prisma migrate
# 3. 导入数据
```

加入 Redis 用于：
- 分析任务队列（BullMQ）
- 实时执行状态推送
- 结果缓存

**4b. Dashboard 页面**

```
新增页面:
src/app/dashboard/
├── page.tsx                    # Dashboard 首页
├── components/
│   ├── InterceptionTrend.tsx   # 拦截趋势图
│   ├── ProjectHealth.tsx       # 项目健康度
│   ├── FeedbackStats.tsx       # 建议采纳率
│   └── RecentActivity.tsx      # 最近活动
```

**Dashboard 设计原则：**
- 不做大而全的统计面板
- 只展示能驱动行动的数据
- 三个核心指标就够了

```
┌─────────────────────────────────────────────────┐
│  TestMind Dashboard                              │
│─────────────────────────────────────────────────│
│                                                  │
│  ┌──────────┐ ┌──────────┐ ┌───────────────┐   │
│  │ 本月分析  │ │ 建议采纳率│ │ 拦截问题数    │   │
│  │   127     │ │  68%     │ │   23          │   │
│  │  ↑12%    │ │  ↑5%     │ │  ↑8           │   │
│  └──────────┘ └──────────┘ └───────────────┘   │
│                                                  │
│  📈 拦截趋势（周维度）                            │
│  ┌──────────────────────────────────────────┐   │
│  │    ▁▃▅▇▅▇█▇                              │   │
│  │  W1 W2 W3 W4 W5 W6 W7 W8                │   │
│  └──────────────────────────────────────────┘   │
│                                                  │
│  🏥 项目健康度                                   │
│  my-web-app     ████████░░ 82%  活跃            │
│  admin-panel    ██████░░░░ 65%  需关注           │
│  mobile-app     ████░░░░░░ 41%  低使用率         │
│                                                  │
│  📊 高频问题类型                                  │
│  边界条件遗漏    ██████████ 35%                  │
│  权限场景遗漏    ████████   28%                  │
│  回归影响遗漏    ██████     21%                  │
│  状态转换遗漏    ████       16%                  │
│                                                  │
└─────────────────────────────────────────────────┘
```

**4c. 认证升级**

接入 Microsoft Entra ID：
```typescript
// 使用 next-auth + Azure AD provider
// 从简单 JWT 升级到企业 SSO
import NextAuth from "next-auth"
import AzureADProvider from "next-auth/providers/azure-ad"
```

#### 可行性分析

| 项目 | 评估 | 说明 |
|------|------|------|
| SQLite → PostgreSQL 迁移 | ✅ 简单 | Prisma 支持无缝切换 |
| Redis + BullMQ | ✅ 简单 | 成熟方案，文档完善 |
| Dashboard 图表 | ✅ 简单 | ECharts / Recharts，数据聚合 SQL |
| Entra ID 集成 | ⚠️ 中等 | next-auth 支持 Azure AD，但企业配置可能需要 IT 协助 |
| 数据聚合查询 | ⚠️ 中等 | 需要设计好聚合逻辑，但数据量不大，不需要 OLAP |
| **总体风险** | **低** | **都是成熟技术的标准用法** |

---

### Phase 5：智能进化（第 17 周+）

**目标：利用积累的反馈数据，让系统越来越聪明**

#### 做什么

**5a. Prompt 自进化**

```
开发者反馈数据（👍👎）
        │
        ▼
分析哪类建议最有用，哪类最没用
        │
        ▼
自动调整 Prompt 权重和策略
        │
        ▼
例如：发现"边界条件"类建议采纳率 80%
     而"性能测试"类建议采纳率 20%
        │
        ▼
调高边界条件相关 prompt 的优先级
降低性能测试相关建议的生成频率
```

**5b. 项目知识库**

```
每个项目积累的历史分析 → 形成项目特有知识
- 常见 bug 模式
- 高风险模块
- 团队常犯错误
- 有效的测试策略

新分析时注入历史知识 → 建议更精准
```

**5c. 跨项目模式识别**

```
分析所有项目的数据 → 发现共性问题
- "权限相关变更"在所有项目中 bug 率最高
- "金额计算"类需求的自测遗漏最多
- 周五提交的代码 bug 率比平时高 30%

→ 针对性地加强这些场景的自测建议
```

#### 可行性分析

| 项目 | 评估 | 说明 |
|------|------|------|
| 反馈数据分析 | ✅ 简单 | 基本的统计分析，SQL 聚合即可 |
| Prompt 动态调整 | ⚠️ 中等 | 需要设计好 Prompt 模板系统和权重机制 |
| 项目知识库 | ⚠️ 中等 | 可以用 RAG 或简单的历史检索 |
| 跨项目分析 | ⚠️ 中等 | 需要标准化不同项目的数据维度 |
| **总体风险** | **中等** | **效果依赖数据量和质量，需要足够的使用积累** |

---

## 四、升级路径总览

```
Phase 0 (W1-2)          Phase 1 (W3-4)         Phase 2 (W5-8)
┌──────────┐            ┌──────────┐           ┌──────────────┐
│ CLI 原型  │ ────────▶  │ CLI 完善  │ ───────▶ │  Web 平台     │
│ 验证 LLM │            │ 代码上下文│          │  持久化       │
│ 最简 MVP │            │ 项目配置  │          │  反馈收集     │
└──────────┘            └──────────┘          └──────────────┘
                                                      │
Phase 5 (W17+)          Phase 4 (W13-16)      Phase 3 (W9-12)
┌──────────────┐        ┌──────────────┐      ┌──────────────┐
│  智能进化     │ ◀───── │  Dashboard   │ ◀──  │  CI 自动化    │
│  Prompt 迭代  │        │  SSO 认证    │      │  测试执行     │
│  知识库      │        │  数据分析    │       │  Jira 回写    │
└──────────────┘        └──────────────┘      └──────────────┘
```

### 技术栈升级路径

```
存储:    SQLite ──────────────▶ PostgreSQL ──────────▶ + Redis
队列:    无 / setTimeout ─────▶ BullMQ + Redis
认证:    简单 JWT ────────────▶ Microsoft Entra ID
部署:    本地 / 单机 Docker ──▶ Docker Compose ──────▶ K8s (如需)
执行:    本地 Playwright ─────▶ 独立 Runner 节点 ───▶ CI 集成
监控:    console.log ─────────▶ 结构化日志 ──────────▶ Grafana
```

每一步升级都是**可选的、按需的**。如果 SQLite 够用就不升级。如果不需要多节点执行就不拆 runner。避免过早引入复杂度。

---

## 五、关键设计决策与理由

### 1. CLI 先行，Web 后置

| 方案 | 优势 | 劣势 |
|------|------|------|
| ❌ 先做 Web | 看起来更"像产品" | 开发慢、反馈周期长、可能做了没人用 |
| ✅ 先做 CLI | 快速验证、快速迭代、零部署成本 | 不方便非技术人员查看 |

CLI 是开发者的主场，能在最舒适的环境中验证产品价值。

### 2. 引擎与 UI 分离

```
engine/ 是独立模块，不依赖任何 Web 框架
├── CLI 直接调用 engine
├── Next.js API 调用 engine
├── CI script 调用 engine
└── 未来任何入口都可调用 engine
```

这是整个架构最重要的设计决策。引擎纯函数化，输入是数据，输出是结构化结果。

### 3. 反馈闭环是第一优先级

比 Dashboard 更重要的是：**每条自测建议旁边的 👍👎 按钮。** 这个反馈数据是系统进化的燃料。没有反馈数据，Dashboard 只是空壳；有了反馈数据，Dashboard 自然能讲出好故事。

### 4. 渐进式复杂度

```
开发者需要什么？        → 先做
管理者想看什么？        → 后做（数据积累后自然可得）
架构师想怎么建？        → 最小够用即可
运维想怎么部署？        → 先单机，有压力再扩展
```

---

## 六、风险矩阵

| 风险 | 概率 | 影响 | 缓解策略 |
|------|------|------|----------|
| LLM 自测建议质量不够 | 高 | 致命 | Phase 0 专门验证；持续迭代 prompt；收集反馈 |
| 开发者不愿意用 | 中 | 致命 | CLI 零摩擦；CI 自动触发；不强制、只辅助 |
| Jira 描述质量差 | 高 | 中 | 代码上下文补偿；模板引导；支持手动补充 |
| Playwright 生成测试不稳定 | 高 | 低 | 定位为"草稿"而非"成品"；执行结果仅供参考 |
| LLM API 成本过高 | 低 | 中 | 缓存相同 Jira 的分析结果；精简 prompt |
| 安全/权限问题 | 低 | 中 | 代码上下文不上传敏感信息；LLM 调用走企业 API |

---

## 七、成功指标

### 开发者视角（最重要）

- **使用率**：每周有多少 Jira ticket 触发了 TestMind 分析？
- **采纳率**：自测建议的 👍 比例？目标 > 60%
- **时间节省**：开发者是否感觉自测方向更清晰了？（定性反馈）

### 团队视角（后续补充）

- **拦截数**：提测前通过自测发现的问题数量
- **提测质量**：QA 发现的 bug 数是否在下降？
- **覆盖率**：多少比例的需求走了 TestMind 流程？

### 不追求的指标

- ❌ 测试自动生成的覆盖率（不是目标）
- ❌ 自动执行的通过率（草稿质量有限，通过率低很正常）
- ❌ 系统的分析数量（多不等于有用）
