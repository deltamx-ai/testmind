# TestMind TODO List

> 最后更新：2026-03-25

## 高优先级

- [x] 补充单元测试：为每个 pipeline stage 编写测试（git-analyzer、dependency-tracer、history-analyzer、test-scanner、context-builder、llm-analyzer、reporter）
- [x] 补充 utils.ts 工具函数测试
- [x] 引入测试框架（vitest），配置 CI 测试流程
- [x] 静默降级改为显式警告：分析阶段失败时在报告中标注数据不完整

## 中优先级

- [ ] 依赖追踪升级为 AST 解析（可选 ts-morph 或 swc）
- [x] 支持更深层依赖追踪（可配置深度，默认 3 层） — maxImpactedFiles 已可配置
- [x] 测试匹配增加语义分析：解析 test 文件中的 import 来关联源文件
- [x] 简化 Provider 认证逻辑，减少 fallback 层级
- [x] 增加 `--verbose` / `--debug` 模式，输出认证解析和分析过程详情
- [x] LLM 输出解析增强：支持 markdown/非标准 JSON 的容错解析

## 低优先级

- [x] 将硬编码限制（30 文件、200 行/文件、3000 行总量、80k 字符）提取为配置项
- [ ] 添加 git 操作结果缓存（基于 commit hash 的文件缓存）
- [ ] 支持更多语言的依赖追踪（Go、Python、Rust）
- [ ] 支持输出格式选项（JSON、HTML，除现有 Markdown 外）
- [x] 添加 `--dry-run` 模式，展示分析范围但不调用 LLM
