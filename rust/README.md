# TestMind (Rust)

Code-change-driven self-test advisor — Rust 重写版本。

## 项目结构

```
rust/
├── Cargo.toml
└── src/
    ├── main.rs              # CLI 入口 (clap)
    ├── types.rs             # 所有类型定义
    ├── utils.rs             # Git/文件工具函数
    ├── pipeline.rs          # 6 阶段分析流水线
    ├── reporter.rs          # Markdown 报告生成
    ├── llm/
    │   ├── mod.rs
    │   └── provider.rs      # LLM provider 解析 (Anthropic/Copilot)
    └── stages/
        ├── mod.rs
        ├── git_analyzer.rs      # Git 变更分析
        ├── dependency_tracer.rs # 依赖追踪
        ├── history_analyzer.rs  # 历史风险分析
        ├── test_scanner.rs      # 测试覆盖扫描
        ├── context_builder.rs   # LLM 上下文构建
        └── llm_analyzer.rs      # LLM 调用与解析
```

## 技术选型

| 功能 | TypeScript 原版 | Rust 版本 |
|------|----------------|-----------|
| CLI 解析 | commander | **clap** (derive) |
| HTTP 客户端 | `@anthropic-ai/sdk` / `fetch` | **reqwest** + **rustls** |
| 异步运行时 | Node.js | **tokio** (`tokio::join!` 并行执行 Stage 2/3/4) |
| JSON 序列化 | 内置 | **serde** / **serde_json** |
| 正则表达式 | 内置 | **regex** |
| 错误处理 | try/catch | **anyhow** |
| 配置文件 | `.testmindrc.json` | `.testmindrc.json` (兼容) |

## 使用方式

```bash
# 构建
cargo build --release

# 查看帮助
testmind --help

# 基本用法
testmind --base main --head feature/foo

# 指定仓库路径
testmind --base main --head feature/foo --repo /path/to/repo

# Dry run（不调用 LLM）
testmind --base main --head feature/foo --dry-run

# 带需求文本做验收
testmind --base main --head feature/foo \
  --requirements-file jira.txt \
  --test-command "cargo test" \
  --test-command "cargo clippy -- -D warnings"

# 使用本地知识库做召回
testmind --base main --head feature/foo \
  --knowledge-dir knowledge \
  --test-command "cargo test"

# 严格门禁模式（失败时进程退出码为 2）
testmind --base main --head feature/foo \
  --requirements-file jira.txt \
  --strict

# 输出到文件
testmind --base main --head feature/foo -o report.md

# 指定 LLM provider 和模型
testmind --base main --head feature/foo -p anthropic -m claude-sonnet-4-20250514

# 详细模式
testmind --base main --head feature/foo -v
```

## CLI 参数

```
Options:
  -b, --base <BASE>          基准分支
      --head <HEAD>          目标分支
      --branch <BRANCH>      目标分支（--head 的旧别名）
  -p, --provider <PROVIDER>  LLM provider: auto | anthropic | copilot
  -m, --model <MODEL>        LLM 模型 ID
      --requirements-file    需求/验收标准文件
      --requirements-text    内联需求文本
      --requirement          单条验收标准（可重复）
      --knowledge-dir        本地知识库目录 [默认: ./knowledge]
      --test-command         验证命令（可重复）
  -r, --repo <REPO>          仓库路径 [默认: .]
  -o, --output <OUTPUT>      输出到文件
  -v, --verbose              显示详细分析过程
      --dry-run              仅展示分析范围，不调用 LLM
      --strict               启用严格门禁
  -h, --help                 帮助
  -V, --version              版本
```

## 环境变量

| 变量 | 说明 |
|------|------|
| `ANTHROPIC_API_KEY` | Anthropic API Key |
| `TESTMIND_COPILOT_TOKEN` | Copilot 访问 Token |
| `TESTMIND_PROVIDER` | 默认 LLM provider |
| `TESTMIND_MODEL` | 默认模型 |
| `TESTMIND_BASE_BRANCH` | 默认基准分支 |
| `TESTMIND_HEAD_BRANCH` | 默认目标分支 |
| `TESTMIND_COPILOT_BASE_URL` | Copilot API 地址 |
| `TESTMIND_COPILOT_TOKEN_CMD` | 获取 Copilot Token 的命令 |
| `TESTMIND_COPILOT_PYTHON` | Python 路径（用于 copilot-auth） |

## 分析流水线

1. **Git 变更分析** — 获取分支间 diff、文件分类、commit 记录
2. **依赖追踪** — 查找受变更影响的下游文件和入口文件
3. **历史风险分析** — 统计文件近期修改频率和 bug 修复次数，识别风险热区
4. **测试覆盖扫描** — 匹配变更文件对应的测试文件，计算覆盖率
5. **上下文构建** — 将以上分析结果组装为 LLM 可消费的上下文文本
6. **LLM 分析** — 调用 Anthropic 或 Copilot API，生成自测检查清单和需求覆盖映射
7. **Gate 评估** — 结合需求覆盖、critical/high 风险、测试执行结果、覆盖缺口输出 `PASS/WARN/FAIL`

> Stage 2/3/4 通过 `tokio::join!` 并行执行。

## 现在它如何变得“可验收”

- 可以输入 Jira/PRD/需求文档文本，而不是只看 diff
- LLM 必须逐条输出需求是否 `covered / partial / missing / unclear`
- 可以执行真实验证命令，例如 `cargo test`、`npm test`、`pytest`
- 会生成明确的 Gate 结果：
  - `PASS`: 未发现阻塞项
  - `WARN`: 有高风险项或证据不足，建议人工复核
  - `FAIL`: 存在 missing requirement、critical 项、失败的验证命令等
- Gate 为 `FAIL` 时 CLI 退出码为 `2`，可直接接 CI

## 知识库模式

推荐在仓库里维护一个 `knowledge/` 目录，把 Jira/PRD/事故复盘沉淀成结构化条目：

```text
knowledge/
  requirements/
    REQ-AUTH-001.yaml
  bug-patterns/
    BUG-AUTH-001.yaml
  decisions/
    ADR-AUTH-001.yaml
```

支持 `yaml` / `yml` / `json`。最小字段示例：

```yaml
id: REQ-AUTH-001
kind: requirement
title: Expired OTP must be rejected
module: auth
tags:
  - otp
  - login
filePatterns:
  - src/auth/**/*.rs
acceptance:
  - Expired OTP returns 401
  - Error code is OTP_EXPIRED
source:
  sourceType: jira
  key: AUTH-123
  url: https://jira.example.com/browse/AUTH-123
```

召回逻辑当前基于：

- `filePatterns` 和变更文件路径匹配
- `module` 和改动模块匹配
- `tags` 和改动路径文本匹配

命中的 `requirement` 条目会自动并入需求集合，参与 `requirementCoverage` 和 gate 判定；`bug-pattern` / `decision` 条目会进入 LLM 上下文和最终报告，作为额外约束与风险线索。

## License

MIT
