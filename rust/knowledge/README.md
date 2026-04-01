# Knowledge Base

这个目录用于沉淀项目知识，而不是每次临时喂 Jira 文本。

推荐分类：

```text
knowledge/
  requirements/
  bug-patterns/
  decisions/
```

支持的条目类型：

- `requirement`: 会参与需求覆盖判断和 gate
- `bug-pattern`: 会作为历史缺陷模式进入分析上下文
- `decision`: 会作为架构/约束决策进入分析上下文

推荐字段：

```yaml
id: REQ-AUTH-001
kind: requirement
title: Expired OTP must be rejected
summary: Login flow must reject expired OTP and avoid creating session
module: auth
tags:
  - otp
  - login
filePatterns:
  - src/auth/**/*.rs
acceptance:
  - Expired OTP returns 401
  - Error code is OTP_EXPIRED
checks:
  - Verify no session is created
source:
  sourceType: jira
  key: AUTH-123
  url: https://jira.example.com/browse/AUTH-123
```

当前召回信号：

- `filePatterns`
- `module`
- `tags`

后续可以继续扩展为：

- Git blame / 历史提交关联
- 代码所有者映射
- Jira API 自动同步
- 向量检索
