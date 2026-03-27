# TestMind 使用指南

## 概述

TestMind 是一个代码变更驱动的自测建议工具。它分析 Git 分支间的 diff，结合依赖关系、历史风险、测试覆盖等维度，通过 LLM 生成自测检查清单。

## 前置条件

- Git 仓库
- LLM API Key（二选一）：
  - `export ANTHROPIC_API_KEY=sk-ant-xxx`
  - `export TESTMIND_COPILOT_TOKEN=xxx`

## 使用流程

### 典型工作流

```
1. 从 master 拉出 feature 分支
   git checkout -b feature/add-login

2. 在 feature 分支上开发、提交

3. 提测前运行 TestMind
   testmind                                    # 自动对比 master（配置文件已设置）
   testmind -o report.md                       # 输出报告到文件
   testmind --dry-run                          # 先看分析范围，不调 LLM

4. 根据检查清单逐项自测
```

### 命令示例

```bash
# 最简用法（baseBranch 从 .testmindrc.json 读取，headBranch 自动取当前分支）
testmind

# 手动指定分支
testmind --base master --head feature/add-login

# 指定仓库路径
testmind --repo /path/to/repo --base main --head dev

# Dry Run：只看分析范围，不调用 LLM（免费）
testmind --dry-run

# 输出到文件
testmind -o checklist.md

# 详细模式（显示 token 用量等）
testmind -v

# 指定 provider 和模型
testmind -p anthropic -m claude-sonnet-4-20250514
testmind -p copilot -m gpt-4.1
```

## 配置文件

项目根目录下的 `.testmindrc.json`，所有字段均可选：

```json
{
  "baseBranch": "master",        // 默认基准分支
  "headBranch": null,            // 默认目标分支（null = 当前分支）
  "provider": "auto",            // auto | anthropic | copilot
  "model": null,                 // LLM 模型（null = 使用默认）
  "maxDiffLines": 3000,          // diff 总行数上限
  "maxDiffLinesPerFile": 200,    // 单文件 diff 行数上限
  "maxImpactedFiles": 30,        // 依赖追踪最大文件数
  "maxContextChars": 80000,      // LLM 上下文字符上限（~20K tokens）
  "historyDays": 90,             // 历史风险分析天数
  "excludePatterns": [],         // 排除的文件模式
  "verbose": false               // 详细输出
}
```

**修改对比分支**：编辑 `baseBranch` 字段，或通过 CLI `--base` 覆盖。

## 优先级规则

参数按以下优先级从高到低生效：

```
CLI 参数 > 环境变量 > .testmindrc.json > 自动检测
```

| 参数 | CLI | 环境变量 | 配置文件 | 自动检测 |
|------|-----|---------|---------|---------|
| baseBranch | `--base` | `TESTMIND_BASE_BRANCH` | `baseBranch` | main/master/develop |
| headBranch | `--head` | `TESTMIND_HEAD_BRANCH` | `headBranch` | 当前分支 |
| provider | `--provider` | `TESTMIND_PROVIDER` | `provider` | 按 API Key 自动选择 |
| model | `--model` | `TESTMIND_MODEL` | `model` | anthropic=claude-sonnet-4 / copilot=gpt-4.1 |

## 分析流水线

```
[1/6] Git 变更分析      → 文件列表、diff、commit 记录
[2/6] 依赖追踪          → 受影响的下游文件、入口文件    ┐
[3/6] 历史风险分析      → 修改频率、bug 修复次数、风险热区 ├ 并行执行
[4/6] 测试覆盖扫描      → 匹配已有测试、计算覆盖率      ┘
[5/6] 上下文构建        → 组装为 LLM 可消费的文本
[6/6] LLM 分析          → 生成检查清单、测试建议、风险评估
```

## 输出报告

报告为 Markdown 格式，包含：

- **概要**：一句话风险评估
- **检查清单**：按 critical > high > medium > low 分组
- **测试建议**：建议运行的已有测试 + 建议新增的测试
- **风险热区**：近 90 天修改频繁、bug 修复多的文件
- **测试覆盖缺口**：没有对应测试的变更文件
- **注意事项**：LLM 额外提醒

## TypeScript vs Rust 版本

两个版本功能完全一致，CLI 参数和配置文件格式兼容。

```bash
# TypeScript 版本
npx tsx src/cli.ts --base master --head feature/xxx

# Rust 版本（需先 cargo build --release）
./target/release/testmind --base master --head feature/xxx
```
