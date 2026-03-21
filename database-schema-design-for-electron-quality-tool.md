# 面向本地优先研发自测工具的数据库表设计建议

创建时间：2026-03-21
项目目录：/home/delta/workspace/ai/testmind

## 一、先说结论

如果这套工具当前确定走 Electron 本地优先路线，那数据库设计建议优先围绕 SQLite 来做，而且要按“本地业务主数据 + 本地附件索引 + 可选同步字段”这三个方向来设计。

不要一开始就把表设计得像中心化 SaaS 平台那么重。

更适合的做法是：

先把最核心的本地闭环跑通，也就是：
项目、需求、变更、测试建议、测试用例、执行记录、问题摘要、指标快照。

这些表设计好以后，后面无论你加插件、加新模型、加新执行器、加少量中心同步，都还能接得住。

## 二、设计原则

我建议这套库设计遵守五个原则。

### 1. 核心对象稳定优先
先围绕稳定领域对象建表，不要围绕某个模型输出格式建表。

也就是说，表结构应该服务于这些业务实体：

- 项目
- 需求任务
- 代码变更
- 自测检查任务
- 测试用例
- 测试执行
- 问题摘要
- 指标快照

不要直接把某次 LLM 返回 JSON 原样塞成主结构。
LLM 输出更适合作为原始材料或扩展字段保存。

### 2. 规范字段和扩展字段并存
有些核心字段必须结构化，比如状态、类型、时间、关联关系。

但像模型原始输出、额外上下文、插件特有字段，建议统一预留 json_text 之类的扩展字段。

这样后面扩功能时不至于频繁改表。

### 3. 附件和大对象不直接进表
截图、trace、视频、原始报告、长日志不要直接塞数据库正文。

数据库里只存：

- 文件路径
- 文件类型
- 文件大小
- hash
- 关联对象 id

真正文件放本地目录。

### 4. 本地优先，但提前为同步留钩子
即使你当前不打算上传数据，也建议表里适当预留：

- sync_status
- sync_version
- remote_ref
- is_redacted

这些字段以后做“可选脱敏同步”时会很省事。

### 5. 所有重要表都要有时间和来源字段
至少建议有：

- created_at
- updated_at
- source_type
- source_ref

这样以后排查数据来源和做统计会方便很多。

## 三、推荐的核心表分组

我建议把表分成六组来理解。

第一组，项目与配置。
第二组，需求与变更。
第三组，分析与建议。
第四组，测试资产与执行。
第五组，问题与结果。
第六组，统计与同步。

这样思路会比较清楚。

## 四、项目与配置相关表

### 1. projects
这是整个系统最核心的入口表。

建议字段：

- id
- name
- key
- local_path
- repo_url
- default_branch
- tech_stack
- test_framework
- status
- privacy_mode
- created_at
- updated_at
- extra_json

说明：

name 用于展示。
key 用于系统内部稳定标识。
local_path 用于本地仓库定位。
privacy_mode 可以标记这个项目是不是禁止同步。
extra_json 用于放一些个性化配置。

### 2. project_settings
项目级配置不要全塞 projects 一张表。

建议单独拆出来，按 key-value 管。

字段建议：

- id
- project_id
- setting_key
- setting_value
- value_type
- created_at
- updated_at

这样后面加模型配置、执行器配置、忽略目录、隐私策略覆盖规则都比较方便。

### 3. project_members
如果后面要支持本地多身份或者轻协作，可以先预留这张表。

字段建议：

- id
- project_id
- user_ref
- role
- created_at

当前本地单用户模式下它可以先轻量使用。

## 五、需求与变更相关表

### 4. requirement_tasks
这张表统一表示需求任务，不要写死叫 jira_tasks。

因为后面来源可能不只 Jira。

字段建议：

- id
- project_id
- source_type
- source_id
- title
- description
- acceptance_criteria
- status
- priority
- module_name
- reporter
- assignee
- raw_payload_json
- created_at
- updated_at

这里 source_type 可以是 jira、ado、github_issue、local_file。
raw_payload_json 用来保原始来源数据。

### 5. changesets
表示某次代码变更。

字段建议：

- id
- project_id
- requirement_task_id
- vcs_type
- branch_name
- commit_sha
- base_sha
- head_sha
- title
- description
- diff_summary_json
- created_at
- updated_at

这个表的核心意义是把“需求”和“代码变化”挂钩。

### 6. changed_files
因为一个 changeset 会对应很多文件，建议拆子表。

字段建议：

- id
- changeset_id
- file_path
- change_type
- additions
- deletions
- is_test_file
- language
- created_at

这样后面你做影响范围判断和统计会很方便。

## 六、分析与建议相关表

### 7. check_tasks
这张表表示一次“提测前检查任务”。

它是业务主流程里的关键对象。

字段建议：

- id
- project_id
- requirement_task_id
- changeset_id
- trigger_type
- status
- started_at
- finished_at
- initiated_by
- model_strategy
- summary_json
- created_at
- updated_at

比如开发点了一次“开始检查”，就创建一条 check_task。
后面所有建议、执行、摘要都可以挂它。

### 8. context_snapshots
建议把分析时使用的上下文单独存快照。

字段建议：

- id
- check_task_id
- snapshot_type
- content_json
- content_hash
- redaction_level
- created_at

这张表很有价值。

因为以后你回头看某次分析为什么得出这个结论，就能知道当时喂给模型和规则引擎的上下文是什么。

### 9. recommendations
这张表存结构化自测建议。

字段建议：

- id
- check_task_id
- recommendation_type
- title
- description
- severity
- confidence
- status
- source_model
- source_plugin
- structured_payload_json
- created_at
- updated_at

recommendation_type 可以区分：

- test_point
- risk
- affected_page
- reuse_case
- missing_context

这张表会很好用，因为前端展示、人工确认、后续采纳统计都靠它。

### 10. recommendation_feedback
如果你希望系统越来越准，建议加这张表。

字段建议：

- id
- recommendation_id
- action
- feedback_text
- user_ref
- created_at

比如开发采纳了、忽略了、修改了建议，都可以记下来。

这张表以后就是模型优化的重要数据来源。

## 七、测试资产与执行相关表

### 11. test_cases
统一表示测试资产。

字段建议：

- id
- project_id
- source_type
- source_ref
- name
- module_name
- file_path
- case_type
- framework
- status
- last_run_at
- created_at
- updated_at
- extra_json

source_type 可以区分人工编写、AI 生成、已有仓库扫描。
case_type 可以区分 e2e、integration、api、smoke。

### 12. test_case_links
因为一个 case 可能关联多个需求、多个检查任务。

建议做通用关联表。

字段建议：

- id
- test_case_id
- link_type
- linked_id
- created_at

比如 link_type 可以是 requirement_task、check_task、changeset。

### 13. test_runs
表示一次测试执行批次。

字段建议：

- id
- project_id
- check_task_id
- run_type
- executor_type
- status
- started_at
- finished_at
- triggered_by
- total_count
- passed_count
- failed_count
- skipped_count
- summary_json
- created_at
- updated_at

一次 check_task 可能触发一次或多次 run。

### 14. test_run_items
表示一次 run 里的单条 case 结果。

字段建议：

- id
- test_run_id
- test_case_id
- status
- duration_ms
- retry_count
- error_type
- error_message
- failure_step
- raw_result_json
- created_at
- updated_at

这张表是后面统计“哪个 case 通过率最低最高”的核心。

### 15. artifacts
统一管理执行附件。

字段建议：

- id
- owner_type
- owner_id
- artifact_type
- file_path
- file_size
- mime_type
- content_hash
- created_at

owner_type 可以挂 test_run、test_run_item、issue_summary。
artifact_type 可以是 screenshot、video、trace、report、log。

## 八、问题与结果相关表

### 16. issue_summaries
这张表很关键，表示给开发看的“人话问题摘要”。

字段建议：

- id
- project_id
- check_task_id
- test_run_item_id
- issue_type
- title
- summary
- likely_cause
- suggestion
- severity
- confidence
- status
- created_at
- updated_at
- extra_json

比如：
按钮不可点击、状态未更新、接口异常、权限错误、脚本不稳定。

### 17. fix_actions
如果以后想支持“问题修复闭环”，可以加这张。

字段建议：

- id
- issue_summary_id
- action_type
- action_detail
- user_ref
- created_at

比如标记为真实 bug、误报、脚本问题、已修复。

## 九、统计与同步相关表

### 18. metric_snapshots
如果很多统计都是实时算，SQLite 也能做，但体验不一定最好。

建议把常用统计定期落快照。

字段建议：

- id
- project_id
- metric_date
- metric_type
- metric_value
- dimensions_json
- created_at

比如：

- pass_rate
- fail_rate
- total_cases
- unstable_case_count
- intercepted_issue_count

这样本地 dashboard 会更快。

### 19. sync_records
如果以后要可选同步，这张表建议提前留着。

字段建议：

- id
- entity_type
- entity_id
- sync_target
- sync_status
- sync_version
- is_redacted
- last_synced_at
- created_at
- updated_at

即使现在先不用，后面会很有用。

## 十、通用字段建议

我建议大部分主表都统一加下面这些通用字段：

- id：建议用 text uuid，而不是纯自增整数
- created_at
- updated_at
- deleted_at：如果你要软删除
- source_type
- source_ref
- extra_json

这样后面扩展性会好很多。

如果你担心 SQLite 性能，其实在这个本地工具场景里，合理建索引就够用了。

## 十一、索引建议

有几类索引我觉得很值得一开始就加。

projects.key
requirement_tasks(project_id, source_type, source_id)
changesets(project_id, branch_name, head_sha)
check_tasks(project_id, status, created_at)
recommendations(check_task_id, recommendation_type)
test_cases(project_id, module_name, framework)
test_runs(project_id, started_at)
test_run_items(test_run_id, status)
issue_summaries(project_id, severity, status)
metric_snapshots(project_id, metric_date, metric_type)

这样后面大多数查询都够用了。

## 十二、是不是可以参考 Alma 的表设计思路

可以参考思路，但不建议直接照搬。

更准确地说，可以参考我这边一贯的设计习惯：

第一，主实体和扩展字段分开。

第二，事件和结果尽量结构化保存。

第三，原始内容和派生内容分层存。

第四，附件走文件系统，库里只留索引。

第五，变化快的能力尽量通过插件或扩展字段承接。

这些思路是适合你这个项目的。

但你的业务对象和我平时管理的聊天、记忆、线程不一样，所以不要直接套名字和表。

你更应该借的是设计方法，不是原样复制。

## 十三、如果让我给你一个最小可行表集

如果你现在就要先开工，不想一开始建太多表，我建议 MVP 先上这 10 张：

- projects
- requirement_tasks
- changesets
- changed_files
- check_tasks
- recommendations
- test_cases
- test_runs
- test_run_items
- issue_summaries

再加一个 artifacts，就足够支撑第一版本地闭环。

后面你再逐步补：

- metric_snapshots
- sync_records
- context_snapshots
- recommendation_feedback
- project_settings

这样推进会比较稳。

## 十四、结论

如果按当前 Electron 本地优先路线，我最推荐的数据库思路是：

用 SQLite 做本地主库，围绕项目、需求、变更、检查任务、测试资产、执行记录、问题摘要和指标快照来建表；
核心实体结构化，原始上下文和模型结果用 json 扩展字段承接；
大文件走本地文件系统；
提前为可选同步和脱敏聚合留字段，但不强依赖中心化。

如果你要，我下一步可以直接继续给你补一版：

- SQLite 建表 SQL
- Prisma schema
- Drizzle schema
- 表关系图
- 哪几张表先做 MVP
