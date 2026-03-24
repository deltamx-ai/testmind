# 基于本机 Alma 观察的分析落档与 TestMind 详细架构设计

创建时间：2026-03-22  
项目目录：`/home/delta/workspace/ai/testmind`

---

## 一、先把 Alma 的分析落档

这部分不是泛泛而谈，而是基于当前机器上可见的 Alma 安装、运行和用户数据结构做出的归纳。重点不是猜测它“应该是什么”，而是总结它“实际上体现了什么设计方法”。

### 1.1 本机可观察到的 Alma 事实

#### 安装与运行入口

本机上 Alma 呈现出三种入口：

- Electron 桌面应用：`/opt/Alma/alma`
- CLI 入口：`/home/delta/.local/bin/alma`
- systemd 服务入口：`/home/delta/alma.service`

其中 CLI 包装脚本非常直接：

```bash
#!/bin/bash
exec "/opt/Alma/resources/bun/bun" "/opt/Alma/resources/cli/alma" "$@"
```

这说明 Alma 不是只有桌面 UI，它明确支持命令行入口，而且 CLI 与桌面应用共享同一套安装产物。

#### 应用安装结构

从 `/opt/Alma` 可看到几个明显的结构层：

- `resources/app.asar`
- `resources/app.asar.unpacked/node_modules`
- `resources/cli`
- `resources/bun`
- `resources/uv`
- `resources/tts`
- `resources/chrome-extension`
- `resources/bundled-skills/*`

这说明它不是简单的 Electron 打包，而是一个“桌面容器 + 内嵌运行时 + 技能包 + 浏览器扩展 + 辅助执行环境”的完整本地平台。

#### 用户数据结构

本机 `~/.config/alma` 下可以直接观察到这些核心对象：

- `chat_threads.db`
- `api-spec.md`
- `USER.md`
- `mcp.json`
- `missions/missions.json`
- `tasks/tasks.json`
- `people/*.md`
- `groups/*.log`
- `plugin-cache/`
- `plugin-global-storage/`
- `cron/jobs.json`
- `cron/runs.json`
- `window-state.json`

这一点很关键。Alma 的长期状态并没有全部藏进一张数据库表或一个内部私有格式里，而是采用了：

- 结构化状态文件
- 数据库
- 可读 Markdown
- 运行日志
- 插件独立存储

混合持久化。

#### 浏览器控制结构

本机可看到 Alma 自带的 Chrome 扩展源码，核心特点是：

- Manifest V3
- 后台 Service Worker
- 用 WebSocket 连接本地服务
- 自动从 `http://127.0.0.1:23001/api/browser-relay/config` 获取配置
- 用 `chrome.debugger` 和标签页监听实现浏览器控制

这意味着浏览器能力不是硬编码进 Electron WebView，而是通过“独立浏览器 Relay + 本地控制服务”解耦实现。

#### 任务系统结构

从 `missions/missions.json` 和 `tasks/tasks.json` 可以直接观察到：

- Mission 有 `description`、`status`、`goals`、`logs`
- Task 有明确的 `prompt`、`subagentType`、`result`
- Goal 是逐条拆分的
- 任务执行有日志、有失败原因、有完成时间

这不是一次性问答 UI，而是明确的任务编排系统。

#### 本地 API 结构

本机 `~/.config/alma/api-spec.md` 表明 Alma 暴露本地 HTTP API，基础端口为：

- `http://localhost:23001`

并且覆盖了：

- settings
- providers
- models
- threads
- health
- browser relay

这说明它把核心业务能力收敛成了本地 API，而不是把全部逻辑塞进 Electron Renderer 或主进程。

### 1.2 由这些事实反推出的 Alma 架构分层

基于当前机器上的可见证据，Alma 可以理解成下面六层。

#### 第一层：桌面承载层

负责：

- 窗口与系统托盘
- Electron 生命周期
- 本地权限桥接
- 安装打包
- 自动更新

这一层只是容器，不应承载核心业务规则。

#### 第二层：本地服务层

负责：

- 暴露本地 API
- 统一配置管理
- Provider 管理
- 会话与线程读写
- 浏览器控制中继

这一层把“应用核心能力”沉淀为本地进程服务。

#### 第三层：任务与代理编排层

负责：

- mission 创建
- goal 拆分
- 子任务调度
- 任务状态推进
- 结果记录与失败回填

这一层说明 Alma 采用的是“任务中心化”而不是“页面中心化”。

#### 第四层：技能与插件扩展层

负责：

- skills 装载
- plugins 存储
- 插件隔离
- 可选能力扩展

这一层说明 Alma 的变化能力不是都写死在核心里。

#### 第五层：本地知识与上下文层

负责：

- USER.md 等用户画像
- people/groups 日志
- threads 与 memory 类数据
- 任务上下文沉淀

这一层说明 Alma 很重视“长期上下文”。

#### 第六层：多入口消费层

当前机器上可观察到的至少包括：

- 桌面 UI
- CLI
- 浏览器扩展
- systemd 服务化运行

这说明它不是单入口产品，而是统一核心、多入口接入。

### 1.3 Alma 最值得借鉴的设计方法

真正该借的不是某个文件名，而是下面这些方法。

#### 方法一：统一核心，多个入口共用

Alma 同时支持 Electron、CLI、扩展、服务化运行，但底层安装产物和数据目录是统一的。

可借鉴点：

- 不要给桌面端、CLI、未来 IDE 插件分别做三套逻辑
- 核心引擎要独立
- 展示层和能力层要解耦

#### 方法二：任务中心化

Alma 的 mission / goal / task 结构说明，复杂工作应被建模为可追踪任务，而不是散落的一堆动作。

可借鉴点：

- 研发提测前检查一定要建模为 CheckTask
- CheckTask 要有阶段、事件、产物、失败原因、恢复点
- 不要把“生成建议”“执行 Playwright”“汇总问题”做成互相断裂的几个按钮

#### 方法三：本地优先的状态管理

Alma 明显把本地存储当成一等公民。

可借鉴点：

- 敏感上下文、代码分析结果、测试证据、模型输入摘要都应默认本地持久化
- 云端同步应该是可选的，不应是前提

#### 方法四：结构化数据与人类可读文件并存

Alma 既有 JSON/DB，又有 Markdown/log。

可借鉴点：

- 核心运行状态用数据库和 JSON
- 可审阅知识、分析摘要、项目规则用 Markdown
- 不要强行统一成一种格式

#### 方法五：能力插件化

从 bundled skills 到 plugin storage，可以看出 Alma 把扩展前置设计了。

可借鉴点：

- 需求源应插件化
- 模型提供方应插件化
- 测试执行器应插件化
- 通知、同步、导出都应插件化

#### 方法六：浏览器自动化通过 Relay 解耦

Alma 并没有把浏览器控制紧耦合在桌面应用页面里，而是单独做了 Browser Relay。

可借鉴点：

- 若你的系统未来要支持浏览器录制、页面分析、自动定位元素，应该考虑独立 Relay，而不是直接把所有控制塞进 Electron Renderer

### 1.4 Alma 设计里的优点

从本机可见结构判断，Alma 至少有这些明显优点：

- 入口多，但状态核心统一
- 本地优先，隐私边界清晰
- 任务化程度高，适合复杂流程
- 插件与技能思路正确，便于演化
- 浏览器能力设计成独立中继，扩展性好
- 数据组织兼顾程序消费与人工审阅

### 1.5 Alma 设计里需要谨慎借鉴的地方

Alma 的思路值得借，但不能原样照搬。

#### 风险一：本地目录和对象类型一多，容易失控

本地优先带来的另一个现实问题是：

- 目录很多
- 状态很多
- 文件格式很多
- 迁移和清理复杂

如果 TestMind 也这么做，必须从一开始就定义清楚哪些是核心对象，哪些是附件，哪些是缓存，哪些可回收。

#### 风险二：任务系统如果过度泛化，会把简单流程搞重

Alma 的 mission/task 很适合复杂代理流程，但 TestMind 的首要任务是让开发者快速得到可用自测建议。

因此：

- MVP 阶段不要过度设计成通用 agent 平台
- CheckTask 要面向“提测检查”这个场景收敛

#### 风险三：插件机制太早做成高自由度，会导致维护成本暴涨

扩展点要前置，但插件运行边界要严格：

- 输入输出必须结构化
- 生命周期必须有限
- 错误隔离必须明确

不然最后会变成“什么都能接，什么都难维护”。

### 1.6 对 TestMind 最有价值的 Alma 结论

如果只提炼一句话，那就是：

> TestMind 不应该被设计成一个“AI 生成几条自测建议的小工具”，而应该被设计成一个“本地优先、任务驱动、可扩展的研发提测质量工作台”。

---

## 二、在 Alma 分析基础上，给 TestMind 的详细架构设计

这里默认目标系统是当前目录内多份文档已经反复指向的方向：一个面向开发提测前自测、回归建议、自动验证与问题汇总的本地优先质量工具。

### 2.1 产品定位

TestMind 的定位建议明确为：

一个服务开发者的本地质量工作台。

它不是替代测试团队，也不是通用 AI Chat。
它解决的是提测前这段经常断裂的链路：

- 需求理解不完整
- 代码变更影响范围不清晰
- 自测点靠经验临时想
- 已有测试资产不知道怎么复用
- 自动执行与人工判断脱节
- 最终问题沉淀不成系统

### 2.2 顶层设计原则

建议固定九个原则。

#### 原则一：本地优先

默认本地处理、本地存储、本地落证据。

#### 原则二：任务驱动

每次检查都是一个完整的 CheckTask，而不是一次零散调用。

#### 原则三：统一核心

桌面端、CLI、未来 Web/IDE 都共享同一套 Engine。

#### 原则四：结构化输出优先

LLM 输出必须尽量结构化，不能让自由文本吞掉工程可控性。

#### 原则五：插件边界清晰

扩展点可以多，但接口必须稳定。

#### 原则六：证据链完整

每个结论都应该尽量能回溯到需求、变更、上下文、执行结果或人工判断。

#### 原则七：阶段可恢复

任何一轮检查都应该支持失败后恢复，不要从头再跑。

#### 原则八：MVP 收敛

先把“对开发者真的有帮助”的核心链路打透，不要先做成复杂通用平台。

#### 原则九：后续可升级

未来可以加团队协作、云同步、管理视图，但不推翻本地核心。

### 2.3 推荐总体分层

建议拆成八层。

#### 第一层：Entry Layer

包括：

- Electron Desktop
- CLI
- CI Hook
- 未来 IDE Extension

职责：

- 接受用户触发
- 展示结果
- 提供交互入口

不负责业务编排。

#### 第二层：Application Layer

负责应用级编排：

- 创建任务
- 组织流程
- 调用领域服务
- 汇总状态

这一层是“应用用例”层。

#### 第三层：Domain Layer

负责核心领域模型和规则：

- Project
- RequirementTask
- ChangeSet
- CheckTask
- ContextSnapshot
- Recommendation
- TestCase
- TestRun
- IssueSummary

这一层不能依赖 UI 技术。

#### 第四层：Engine Layer

负责核心流程阶段化执行：

- 收集
- 解析
- 分析
- 推荐
- 生成
- 执行
- 汇总

它相当于 TestMind 的 mission engine，但范围限定在质量检查领域。

#### 第五层：Integration Layer

负责外部系统接入：

- Jira
- Git
- GitHub/GitLab
- Playwright
- LLM Provider
- Browser Relay
- Notification

#### 第六层：Persistence Layer

负责：

- SQLite
- 文件系统附件
- 配置文件
- 缓存
- 索引数据

#### 第七层：Observation Layer

负责：

- 事件日志
- 指标
- 性能数据
- 任务审计

#### 第八层：Security Layer

贯穿全层，负责：

- 凭证管理
- 数据脱敏
- 权限边界
- 插件沙箱

### 2.4 推荐的核心运行链路

一次完整的提测前检查建议按下面的阶段执行。

#### 阶段 0：任务创建

输入：

- Requirement ID 或需求文档
- 仓库路径
- 分支信息
- 执行策略

产物：

- `CheckTask`
- 初始 `CheckTaskEvent`
- 初始工作目录

#### 阶段 1：需求采集

任务：

- 从 Jira 或其他需求源读取标题、描述、验收标准、评论、关联链接
- 标准化成统一 RequirementTask

产物：

- `RequirementTask`
- `RequirementSnapshot`

#### 阶段 2：代码变化采集

任务：

- 读取当前分支 diff
- 统计变更文件
- 标记新增、修改、删除
- 识别前后端、接口、配置、测试、页面文件

产物：

- `ChangeSet`
- 文件影响初筛

#### 阶段 3：项目上下文构建

任务：

- 识别技术栈
- 识别路由与页面
- 扫描测试资产
- 查找页面对象、fixture、helpers
- 提取历史失败热点与历史缺陷数据

产物：

- `ContextSnapshot`

#### 阶段 4：影响分析与风险评估

任务：

- 判断受影响模块
- 判断受影响用户路径
- 判断高风险改动
- 标记需要重点验证的场景

产物：

- `ImpactAnalysis`
- `RiskAssessment`

#### 阶段 5：建议与测试草稿生成

任务：

- 生成结构化自测清单
- 推荐应该复用的已有用例
- 建议新增测试点
- 按需生成测试草稿

产物：

- `RecommendationSet`
- `TestDraftBundle`

#### 阶段 6：执行计划生成

任务：

- 从建议项映射到可执行测试
- 选择已有 Playwright case
- 组织 case 执行顺序
- 设置并发、环境、重试与超时

产物：

- `ExecutionPlan`

#### 阶段 7：测试执行与证据收集

任务：

- 执行已有 case
- 执行生成或半生成 case
- 记录截图、trace、视频、日志、HAR

产物：

- `TestRun`
- `TestRunItem`
- `Artifact`

#### 阶段 8：问题汇总与结论生成

任务：

- 汇总失败项
- 归并相似问题
- 生成开发可读摘要
- 形成最终提测建议结论

产物：

- `IssueSummary`
- `CheckConclusion`

#### 阶段 9：沉淀与复用

任务：

- 存任务快照
- 存指标
- 更新测试资产索引
- 记录人工反馈

产物：

- `MetricSnapshot`
- `FeedbackRecord`

### 2.5 对象模型设计

下面建议把对象模型定得足够明确。

#### Project

表示一个本地接入项目。

建议字段：

- `id`
- `name`
- `repoPath`
- `defaultBranch`
- `stack`
- `testFramework`
- `privacyMode`
- `workspaceId`
- `configVersion`
- `createdAt`
- `updatedAt`

#### RequirementTask

表示一次外部需求对象的标准化镜像。

建议字段：

- `id`
- `sourceType`
- `sourceId`
- `title`
- `description`
- `acceptanceCriteria`
- `comments`
- `priority`
- `status`
- `links`
- `rawPayloadRef`

#### ChangeSet

表示一次代码改动快照。

建议字段：

- `id`
- `projectId`
- `baseRef`
- `headRef`
- `changedFiles`
- `diffStats`
- `diffSummary`
- `snapshotPath`

#### CheckTask

这是系统最核心的对象。

建议字段：

- `id`
- `projectId`
- `requirementTaskId`
- `changeSetId`
- `status`
- `stage`
- `triggerSource`
- `strategy`
- `createdBy`
- `startedAt`
- `finishedAt`
- `result`
- `confidence`

#### ContextSnapshot

表示当前任务所使用的结构化上下文快照。

建议字段：

- `id`
- `checkTaskId`
- `routes`
- `modules`
- `apiEndpoints`
- `testAssets`
- `historicalIssues`
- `hotspots`
- `dependencyGraphRef`
- `tokenBudget`

#### Recommendation

表示单条建议。

建议字段：

- `id`
- `checkTaskId`
- `type`
- `priority`
- `title`
- `description`
- `rationale`
- `evidenceRefs`
- `targetArea`
- `actionable`

#### TestCase

表示可执行测试资产。

建议字段：

- `id`
- `projectId`
- `source`
- `path`
- `tags`
- `relatedRoutes`
- `relatedRequirements`
- `stabilityScore`
- `lastRunAt`
- `ownership`

#### TestRun

表示一次执行批次。

建议字段：

- `id`
- `checkTaskId`
- `planId`
- `environment`
- `runner`
- `status`
- `startedAt`
- `finishedAt`
- `summary`

#### TestRunItem

表示单条测试执行结果。

建议字段：

- `id`
- `testRunId`
- `testCaseId`
- `status`
- `durationMs`
- `retryCount`
- `errorType`
- `errorSummary`
- `artifactRefs`

#### IssueSummary

表示开发者最终消费的问题摘要。

建议字段：

- `id`
- `checkTaskId`
- `severity`
- `title`
- `symptom`
- `possibleCause`
- `evidenceRefs`
- `relatedCases`
- `suggestedAction`

### 2.6 事件模型设计

建议把任务过程全部事件化，至少保留以下事件。

- `check_task.created`
- `check_task.started`
- `requirement.collected`
- `changeset.collected`
- `context.snapshot_built`
- `analysis.completed`
- `recommendation.generated`
- `execution.plan_created`
- `execution.started`
- `execution.case_finished`
- `execution.completed`
- `issue.summary_generated`
- `check_task.completed`
- `check_task.failed`
- `feedback.recorded`

事件要有统一信封结构：

- `eventId`
- `eventType`
- `aggregateId`
- `aggregateType`
- `timestamp`
- `payload`
- `traceId`

价值在于：

- 可追踪
- 可恢复
- 可做指标
- 可做调试

### 2.7 插件体系设计

TestMind 推荐定义六类正式插件。

#### 1. Requirement Source Plugin

输入：

- 需求标识

输出：

- 标准化 `RequirementTask`

候选实现：

- Jira
- GitHub Issue
- GitLab Issue
- 本地 Markdown 文件

#### 2. Context Provider Plugin

输入：

- 项目路径
- 任务上下文

输出：

- `ContextFragment`

候选实现：

- Git diff 扫描器
- 路由分析器
- 测试资产扫描器
- AST 依赖分析器
- 历史问题检索器

#### 3. Model Provider Plugin

输入：

- PromptSpec
- ContextSnapshot
- TaskType

输出：

- 结构化分析结果

候选实现：

- OpenAI
- Anthropic
- OpenRouter
- 企业代理模型
- 本地模型

#### 4. Execution Provider Plugin

输入：

- `ExecutionPlan`

输出：

- `TestRun`
- `TestRunItem[]`

候选实现：

- Playwright
- Cypress
- 自定义命令执行器

#### 5. Export / Sync Plugin

输入：

- 任务结果

输出：

- 外部同步结果

候选实现：

- Markdown 导出
- Jira 评论回写
- PR Comment
- 企业 IM 通知

#### 6. Browser Relay Plugin

这是借鉴 Alma 的重点扩展位。

适用场景：

- 页面录制
- 真实页面状态抓取
- DOM 快照采集
- 交互路径复盘

建议做成独立 Relay，而不是耦合到 UI。

### 2.8 存储设计

建议采用“SQLite + 文件系统 + 配置文件”的混合持久化。

#### SQLite 负责什么

适合存：

- Project
- CheckTask
- ContextSnapshot 元数据
- Recommendation 元数据
- TestRun
- IssueSummary
- Event Log
- MetricSnapshot

原因：

- 事务一致性好
- 本地部署简单
- 查询足够强
- Electron 生态成熟

#### 文件系统负责什么

适合存：

- diff 快照
- 分析 Markdown
- 截图/trace/视频
- 原始 LLM 输入输出归档
- 测试草稿文件
- 项目规则文件

原因：

- 便于人工查看
- 大对象不适合塞数据库
- 方便导出和归档

#### 配置文件负责什么

适合存：

- 全局设置
- Provider 配置
- 项目级规则
- 插件配置
- Relay 配置

建议格式：

- `json` 用于机器读写
- `md` 用于人工规则说明

### 2.9 推荐目录结构

下面是比较稳妥的本地目录组织方式。

```text
~/.config/testmind/
├── app.db
├── settings.json
├── providers.json
├── plugins/
├── plugin-storage/
├── projects/
│   └── <projectId>/
│       ├── project.json
│       ├── rules.md
│       ├── indexes/
│       │   ├── routes.json
│       │   ├── tests.json
│       │   └── hotspots.json
│       ├── tasks/
│       │   └── <checkTaskId>/
│       │       ├── task.json
│       │       ├── requirement.json
│       │       ├── changeset.json
│       │       ├── context.json
│       │       ├── recommendation.json
│       │       ├── issue-summary.md
│       │       ├── llm/
│       │       ├── artifacts/
│       │       └── logs/
│       └── cache/
├── browser-relay/
│   ├── config.json
│   └── sessions/
└── exports/
```

这个结构的重点是：

- 项目隔离
- 任务隔离
- 缓存与正式产物隔离
- 数据库元数据与文件附件配合

### 2.10 推荐代码结构

如果当前项目继续走 TypeScript，建议用下面这个结构。

```text
src/
├── apps/
│   ├── desktop/
│   ├── cli/
│   └── server/
├── application/
│   ├── usecases/
│   ├── dto/
│   └── services/
├── domain/
│   ├── entities/
│   ├── value-objects/
│   ├── repositories/
│   └── events/
├── engine/
│   ├── orchestrator/
│   ├── stages/
│   ├── planners/
│   └── policies/
├── integrations/
│   ├── requirement-sources/
│   ├── context-providers/
│   ├── model-providers/
│   ├── execution-providers/
│   ├── sync-providers/
│   └── browser-relay/
├── infrastructure/
│   ├── db/
│   ├── fs/
│   ├── config/
│   ├── security/
│   └── observability/
└── shared/
```

### 2.11 Electron 与本地服务的边界

如果要继续借 Alma 的长处，建议把 Electron 和核心引擎分开。

#### Electron 负责

- 窗口
- 菜单
- 项目选择
- 任务列表页
- 结果详情页
- 本地通知
- 文件选择

#### 本地服务负责

- 创建任务
- 调度引擎
- 管理插件
- 管理数据库
- 暴露本地 API
- 提供 Browser Relay 连接点

收益：

- CLI 可直连同一套服务或同一套核心模块
- 未来想拆 server 更容易
- 调试成本低

### 2.12 LLM 层设计建议

这一层很关键，不能只写一句“调模型”。

#### 输入应分层

不要把所有材料一次性全塞给模型。

建议拆成：

- Requirement Pack
- Change Pack
- Context Pack
- Historical Pack
- Policy Pack

然后按任务类型做组合。

#### 输出必须结构化

建议至少定义这些结构化 Schema：

- `ImpactAnalysisSchema`
- `RiskAssessmentSchema`
- `RecommendationSchema`
- `TestDraftSchema`
- `IssueSummarySchema`

#### Prompt 管理建议

按职责拆分：

- system prompt
- task prompt
- project policy prompt
- tool result prompt

并保存版本号，方便回放和对比。

#### 成本与隐私控制建议

- 默认只发送必要上下文
- 对代码做裁剪与摘要
- 支持脱敏规则
- 支持“完全不出网”模式

### 2.13 Browser Relay 设计建议

如果后续要做页面录制、元素分析、页面状态采集，建议参考 Alma，但做成更贴近测试场景的结构。

#### 推荐组成

- Chrome/Edge 扩展
- 本地 Relay Server
- Session Manager
- DOM Snapshot Collector
- User Action Recorder

#### 推荐职责

扩展负责：

- 标签页发现
- 页面事件监听
- DOM 与网络信息采集

本地 Relay 负责：

- 会话鉴权
- 指令分发
- 采样节流
- 数据归档

这样做的好处是：

- 录制能力不绑死在 Electron
- 浏览器采集能力可独立演进
- 后续可接测试脚本生成或页面理解模型

### 2.14 安全与隐私设计

这是本地优先产品必须明确的一层。

建议强制设计以下机制。

#### 凭证管理

- API Key 加密存储
- 支持系统密钥环优先
- 明确区分全局密钥和项目密钥

#### 数据分级

至少区分：

- 配置数据
- 业务上下文
- 敏感代码片段
- 执行证据
- 可导出报告

#### 脱敏机制

对模型调用前做：

- token 脱敏
- cookie 脱敏
- 邮箱/手机号脱敏
- URL 参数清洗

#### 插件权限

插件声明自己需要的能力：

- 文件访问
- 网络访问
- 命令执行
- 浏览器会话访问

并给出显式授权模型。

### 2.15 可观测性设计

建议从第一版就保留观测面，不然以后很难定位问题。

至少记录：

- 阶段耗时
- LLM 调用耗时与 token
- 建议采纳率
- 用例命中率
- 自动执行成功率
- 失败类型分布
- 项目维度热区

这些指标不只是给 Dashboard 看，更是优化产品价值的依据。

### 2.16 推荐的三阶段落地路线

#### Phase 1：把开发者价值打透

目标：

- 输入需求和分支
- 输出有价值的自测清单
- 推荐相关已有测试

先不追求复杂平台能力。

必须做：

- Project 管理
- CheckTask 核心流程
- Jira + Git
- LLM 结构化推荐
- Markdown 结果页

#### Phase 2：把执行链路打通

目标：

- 从建议走到执行与证据

必须做：

- Playwright 执行计划
- 执行结果入库
- 截图/trace 管理
- Issue Summary 自动汇总

#### Phase 3：把系统做成平台

目标：

- 多项目
- 多需求源
- 多模型
- Browser Relay
- 低敏同步与团队协作

这时再完善插件市场、统计视图和协作机制。

### 2.17 最终推荐结论

如果参考 Alma，我建议 TestMind 最终采取下面这条路线：

不是“Electron 里塞一个 AI 面板”，也不是“Next.js 做个网页包一层 CLI”，而是：

一个以 `CheckTask Engine` 为核心、以本地服务为能力中枢、以 SQLite + 文件系统为持久化基础、以插件体系承接变化能力、以 Electron/CLI 作为多入口的本地优先质量工作台。

最需要借 Alma 的，是这四点：

- 统一核心，多入口复用
- 任务驱动，而不是页面驱动
- 本地优先，而不是云端依赖
- 扩展前置，而不是后补

最不该照搬 Alma 的，是这两点：

- 不要把领域做得过泛
- 不要在 MVP 阶段过度抽象成通用 Agent 平台

对 TestMind 来说，最正确的收敛方式是：

先把“需求 + 变更 + 上下文 + 自测建议 + 执行结果 + 问题摘要”这条链路做成一个强闭环，然后再逐步长成平台。

---

## 三、建议你下一步直接落实的最小架构决策

为了避免只停留在设计层，我建议立刻冻结下面七个决策。

1. 核心领域对象以 `CheckTask` 为中心建模。  
2. 持久化采用 `SQLite + task 文件目录 + artifacts` 混合方案。  
3. 入口至少规划 `Desktop + CLI`，两者共用同一套 Engine。  
4. 第一批插件只做 `Requirement Source / Context Provider / Model Provider / Execution Provider` 四类。  
5. LLM 输出全部要求结构化 Schema。  
6. Playwright 作为首个执行器，不再并行支持太多框架。  
7. Browser Relay 放到第二阶段，不挤占 MVP 资源。  

如果这七点能先定住，后面的实现路线就会清晰很多。
