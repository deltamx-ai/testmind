# TestMind 已知问题清单

> 生成日期：2026-03-25

## 1. 缺少单元测试

**严重程度：高**

项目本身没有任何单元测试。作为一个"测试建议工具"，这削弱了可信度。Pipeline 各阶段（git-analyzer、dependency-tracer、history-analyzer、test-scanner、context-builder、llm-analyzer、reporter）均无测试覆盖。

**影响：** 重构和新增功能时无回归保障，难以验证边界条件。

---

## 2. 依赖追踪基于正则，非 AST 解析

**严重程度：中**

`dependency-tracer.ts` 使用正则匹配 import/require 语句，仅追踪 1-2 层深度。

**影响：**
- 无法正确解析动态 import、re-export、barrel files
- 容易漏掉间接依赖，导致影响分析不完整
- 对非 JS/TS 语言支持不足

---

## 3. 测试匹配仅靠文件名

**严重程度：中**

`test-scanner.ts` 通过文件名模式匹配（camelCase/kebab-case 变体）关联源文件和测试文件。

**影响：**
- 无法识别一个测试文件覆盖多个模块的情况
- 无法识别集成测试、e2e 测试对源文件的覆盖
- 对 monorepo 中跨包测试支持不佳

---

## 4. 硬编码限制缺乏可配置性

**严重程度：低**

多处硬编码上限：
- 最多 30 个影响文件（dependency-tracer）
- 每文件最多 200 行 diff（git-analyzer）
- 总 diff 最多 3000 行（git-analyzer）
- Context 最大 80k 字符（context-builder）

**影响：** 大型变更场景下可能丢失关键信息，用户无法根据项目规模调整。

---

## 5. Provider 认证逻辑过于复杂

**严重程度：中**

`llm/provider.ts` 共 249 行，实现了多级 fallback 链：环境变量 → 配置文件 → 命令行输出 → Python copilot-auth 模块。

**影响：**
- 排查认证问题困难，用户难以理解当前使用哪个 provider
- Python 依赖引入额外复杂度
- 缺少 `--debug` 模式展示认证解析过程

---

## 6. 无 Git 操作缓存

**严重程度：低**

每次运行都重新执行全部 git 命令（diff、log、numstat 等），无缓存机制。

**影响：** 大型仓库重复运行时性能浪费，CI 场景下尤为明显。

---

## 7. 静默降级导致信息丢失

**严重程度：中**

部分 git 命令或分析阶段失败时静默降级，不通知用户数据可能不完整。

**影响：** 用户可能基于不完整的分析结果做出错误判断。

---

## 8. LLM 输出解析脆弱

**严重程度：低**

`llm-analyzer.ts` 依赖 LLM 返回严格 JSON 格式，解析失败时 fallback 为原文警告。

**影响：** 不同模型/版本的输出格式差异可能导致结构化结果丢失，降级为纯文本时丧失 checklist 分级能力。
