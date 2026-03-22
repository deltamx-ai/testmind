# 参考 Alma 设计方法的研发提测前自测工具详细架构方案

创建时间：2026-03-22
项目目录：/home/delta/workspace/ai/testmind

## 一、设计目标

在参考 Alma 的前提下，这个系统不应该被设计成一个单纯的“AI 生成测试小工具”，也不应该只是一个“把 Playwright 跑起来的桌面壳”。

更合理的目标应该是：

做成一个本地优先、任务驱动、能力可扩展、后续可逐步演进的研发提测前质量工作台。

它的核心价值不是替代测试团队，而是在开发提测之前，把需求理解、变更分析、自测建议、自动验证和问题摘要串成一条稳定的本地工作流。

## 二、总架构原则

这套架构建议坚持八个原则。

第一，本地优先，敏感数据默认不离开设备。

第二，统一核心，桌面端、CLI、IDE 协作入口共享同一套引擎。

第三，任务驱动，所有复杂流程围绕 CheckTask 展开。

第四，能力插件化，数据源、模型、执行器、同步器都可替换。

第五，核心状态结构化，分析材料与附件分层保存。

第六，事件驱动，模块之间尽量低耦合。

第七，配置分层，支持全局配置、项目配置和任务级策略。

第八，可演进，未来增加低敏同步和团队协作时不推翻重来。

## 三、总体现代化结构

我建议把系统拆成七个正式子系统。

### 1. Desktop Shell
这是 Electron 壳。

负责窗口、系统菜单、托盘、文件选择、本地通知、安全桥接、自动更新。

它只承载产品，不承载核心业务决策。

### 2. Workspace & Project System
这一层负责把本地项目管理起来。

每个项目都应该有自己的：

- 本地仓库路径
- 技术栈识别结果
- 测试框架配置
- 隐私模式
- 插件配置
- 附件目录
- 本地数据库归属

这层相当于整个产品的“工作空间管理器”。

### 3. Check Task Engine
这是整个系统的核心。

每次提测前检查都抽象成一个 CheckTask。

一个 CheckTask 从创建到完成，会经历多个阶段：

- 读取需求
- 读取变更
- 构建上下文
- 生成建议
- 选取或生成测试
- 执行验证
- 汇总问题
- 输出结论

也就是说，这层是你系统里的 mission engine，对应 Alma 里任务编排的那部分思想。

### 4. Context Intelligence Layer
这一层负责把“当前这次改动该怎么理解”变成机器可消费的上下文。

包括：

- 需求源解析
- Git diff 分析
- 页面与路由识别
- 测试资产检索
- 代码结构索引
- 历史问题召回

它的目标不是直接给出最终答案，而是先把原材料组织好。

### 5. Recommendation & Test Generation Layer
这一层才开始做智能生成。

包括：

- 自测建议生成
- 受影响页面候选识别
- 风险点识别
- 可复用 case 推荐
- 新测试草稿生成
- 修复建议生成

这层应该面向结构化输出，而不是面向自由文本。

### 6. Execution & Evidence Layer
这一层负责真正执行验证并留下证据。

包括：

- Playwright 执行
- case 选择与编排
- 截图、trace、视频保存
- 执行状态记录
- 失败归因初步分类

### 7. Insight & Presentation Layer
这一层负责把前面所有结果变成开发能消费、未来管理者也能看的输出。

包括：

- 检查结果页
- 问题摘要页
- 项目趋势面板
- case 稳定性面板
- 本地周报或导出报告

## 四、推荐的运行时主线

如果把整个系统跑起来，一次典型流程应该长这样。

开发在桌面端选中某个项目，然后发起一次提测前检查。

系统创建一个 CheckTask，记录本次任务上下文。
接着数据源插件去拉需求信息，比如 Jira。
代码上下文插件去拿当前分支 diff、变更文件、现有测试资产。

上下文层把这些内容收敛成 ContextSnapshot。
模型层基于这些快照生成 Recommendation。

然后执行策略决定：

优先复用哪些已有 case，是否需要生成新的测试草稿，是否需要直接触发 Playwright 跑一遍。

执行完成后，Execution 层把结果、附件和失败项写入本地存储。
问题摘要层将失败结果整理成开发看得懂的 IssueSummary。
最后展示层把本次检查结果、建议采纳情况、失败证据和最终结论呈现出来。

这个流程最关键的一点是：

所有步骤都围绕同一个 CheckTask 展开，而不是散着做。

## 五、借 Alma 后最关键的对象模型

这里我建议把系统的对象模型明确下来。

### Project
表示一个本地接入项目。

### RequirementTask
表示一次需求任务，不限定 Jira。

### ChangeSet
表示一次代码改动快照。

### CheckTask
表示一次完整的提测前检查。

### ContextSnapshot
表示本次检查使用到的结构化上下文快照。

### Recommendation
表示系统生成的建议项。

### TestCase
表示已有或新生成的测试资产。

### TestRun
表示一次执行批次。

### TestRunItem
表示单条 case 的执行结果。

### IssueSummary
表示开发可读的问题摘要。

### MetricSnapshot
表示本地统计快照。

这个对象模型和 Alma 的 thread / mission / memory 一样，都是系统级对象，而不是零散页面数据。

## 六、插件体系应该怎么设计

要想像 Alma 一样后面越长越强，插件一定要提前设计。

我建议至少有五类插件接口。

### 1. Requirement Source Plugin
负责接需求源。

比如：

- Jira
- Azure DevOps
- GitHub Issue
- GitLab Issue
- 本地 markdown 需求文件

统一输出 RequirementTask。

### 2. Context Provider Plugin
负责提供代码和项目上下文。

比如：

- Git diff 扫描器
- 路由分析器
- 测试资产扫描器
- page object 索引器
- AST 分析器

统一输出 ContextFragment 或 ContextSnapshot 部分片段。

### 3. Model Provider Plugin
负责模型调用。

比如：

- 本地模型
- 企业内网模型
- 外部模型
- Copilot 协作桥接

统一输入上下文和任务类型，输出结构化结果。

### 4. Execution Provider Plugin
负责执行测试。

比如：

- Playwright
- Cypress
- API smoke
- 静态检查执行器

统一返回 TestRun 和 TestRunItem 结果。

### 5. Sync Provider Plugin
当前默认关闭，但以后可以支持：

- 脱敏聚合同步
- 模板同步
- 团队规则同步

这样未来加轻协作不会推翻系统。

## 七、为什么要做 ContextSnapshot

这是我觉得最重要、最容易被忽视的一点。

很多这类系统一开始只顾着“调模型”，最后发现结果不稳定，也根本没法复盘为什么某次分析出了问题。

所以一定要把分析时的上下文快照正式存下来。

比如快照里至少包含：

- 需求标题与描述摘要
- 验收标准
- 本次 diff 概览
- 受影响文件列表
- 猜测的页面和模块
- 命中的历史 case
- 使用的模型和参数策略
- 脱敏级别

这样以后你才能回答：

- 为什么这次建议错了
- 为什么这次生成结果特别准
- 哪类上下文最有价值
- 模型换了之后效果有没有变

这点非常像 Alma 里把 thread、task、mission、memory 长期化的做法。

## 八、存储架构怎么设计

建议把存储设计成三层。

### 1. 本地数据库层
存主结构化状态。

推荐 SQLite。

保存：

- Project
- RequirementTask
- ChangeSet
- CheckTask
- ContextSnapshot 索引
- Recommendation
- TestCase
- TestRun
- TestRunItem
- IssueSummary
- MetricSnapshot
- Settings

### 2. 本地文件层
存大对象和人工可读产物。

包括：

- 截图
- trace
- 视频
- 原始日志
- 导出报告
- 分析 markdown
- 项目级补充规则文件

### 3. 可选同步层
默认关闭。

只在需要时上传脱敏聚合指标或模板。

这层一定要和前两层分开，不能让主系统依赖它。

## 九、配置架构怎么设计

这里也很值得借 Alma。

建议分三层配置。

### 全局配置
比如：

- 默认模型策略
- 默认执行器
- 默认隐私等级
- 默认附件目录
- 是否允许可选同步

### 项目配置
比如：

- 项目仓库路径
- 需求源类型
- 测试框架类型
- 忽略目录
- 项目隐私策略
- 测试账号规则

### 任务级策略
比如：

- 本次是否跳过模型生成
- 本次是否只跑 smoke case
- 本次是否强制不上传任何结果
- 本次是否启用更高证据采集等级

这样既灵活，又不会把配置打成一锅粥。

## 十、事件总线应该怎么用

参考 Alma 的编排思想，我建议系统内部正式引入事件总线。

核心事件可以包括：

- project.registered
- requirement.loaded
- changeset.collected
- context.snapshot.created
- recommendation.generated
- recommendation.reviewed
- test.run.started
- test.run.finished
- issue.summary.created
- metric.snapshot.updated
- sync.exported

这样做的意义是：

后面你加功能时，只需要订阅合适的事件，而不需要改主流程。

例如：

- 执行完成自动生成问题摘要
- 建议被采纳后自动更新命中率
- 每周自动生成本地趋势报告
- 可选同步器自动上传脱敏指标

都可以后挂进去。

## 十一、UI 应该怎么跟核心解耦

这里一定要控制住，不然 Electron 很容易写成大泥球。

建议 UI 只面对 Application Service，不直接碰：

- 数据源插件
- 模型 SDK
- Playwright 执行器
- 本地数据库细节
- 文件系统细节

UI 只发起明确的业务动作，比如：

- 创建检查任务
- 查看任务详情
- 查看建议列表
- 批准或忽略建议
- 执行测试
- 查看问题摘要
- 导出报告

这样以后你加 CLI 或 IDE 入口时，就能复用同一套 service。

## 十二、目录结构建议

如果按可长期演进来组织，我建议这么分。

apps/desktop
Electron 主进程、预加载、系统集成。

apps/ui
React 渲染层。

packages/core
领域对象、状态机、核心规则。

packages/application
用例编排、服务层、任务流。

packages/plugin-sdk
插件接口和注册协议。

packages/plugins
Jira、Git、Playwright、模型、同步等插件实现。

packages/storage
SQLite schema、repository、迁移。

packages/filesystem
附件目录管理、导出、路径规则。

packages/shared
公共类型、事件定义、日志工具。

这个组织方式很接近 Alma 那种“多能力统一在一个本地产品骨架里”的感觉，但更贴合你当前业务。

## 十三、阶段性演进路线

这套架构如果要稳，最好按阶段推进。

### 阶段一：本地闭环 MVP
先做：

- 项目接入
- RequirementTask + ChangeSet
- CheckTask 主流程
- Recommendation
- Playwright 执行
- IssueSummary
- 本地 SQLite + 附件目录

### 阶段二：插件化增强
补：

- 多需求源
- 多模型支持
- 多执行器支持
- 项目级配置和 capability registry

### 阶段三：可观察性增强
补：

- MetricSnapshot
- 趋势面板
- case 稳定性分析
- 命中率统计

### 阶段四：可选轻协作
补：

- 脱敏同步插件
- 团队模板共享
- 共享规则集

整个演进过程中，核心对象和 CheckTask 主线不应变化。

## 十四、最值得直接采用的结论

如果只给一个收敛建议，我会这样定。

这个系统应该被设计成：

一个参考 Alma 方法论、但面向研发提测前场景重新建模的本地优先桌面产品。

它的关键不是 Electron 本身，而是：

- 有统一核心引擎
- 有正式任务对象 CheckTask
- 有插件式能力扩展
- 有结构化主状态
- 有文本和附件分层沉淀
- 有事件驱动解耦
- 有未来可选同步但不依赖同步

这才是能长期活下来的架构。

## 十五、结论

先分析 Alma 再设计新系统，最大的价值就在这里。

你会发现真正值得学的，不是某个表、某个框架、某个命令，而是一整套本地型智能产品该怎么长出来：

核心统一，入口可扩展；
复杂流程任务化；
状态可追踪；
能力插件化；
本地持久化正式化；
人类可读产物和程序状态分层管理。

如果按这套方法来设计，你这个研发提测前自测工具后面无论加模型、加测试框架、加隐私同步、加团队模板、加 IDE 协作入口，都会稳很多。
