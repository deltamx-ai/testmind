# TestMind Electron 架构设计方案

## 一、为什么 Electron 在这个场景可行

重新审视后，Electron 对 TestMind 有几个被低估的优势：

1. **直接访问本地 Git 仓库** — 不需要通过 API 中转，`git diff` 直接执行，速度快、无权限问题
2. **零部署成本** — 开发者下载即用，不需要运维一个 Web 服务
3. **数据隐私** — 代码 diff、Jira 信息全部留在本地，不经过中间服务器
4. **离线可用** — 历史分析结果、自测清单随时可查，不依赖网络（LLM 分析除外）
5. **本地 Playwright 执行天然合理** — 桌面应用跑浏览器测试比 Web 服务调度更自然

**需要解决的问题：**
- 自动更新 → Electron 原生支持（electron-updater）
- 跨项目/团队数据汇总 → 可选上传模式解决
- 多人协作 → 不是 MVP 目标，后续通过同步层解决

---

## 二、整体架构

```
┌──────────────────────────────────────────────────────┐
│                    Electron App                       │
│                                                       │
│  ┌─────────────────────────────────────────────────┐ │
│  │              Renderer (React)                    │ │
│  │                                                  │ │
│  │  ┌──────────┐ ┌──────────┐ ┌───────────────┐   │ │
│  │  │ 分析工作台│ │ 历史记录  │ │ 项目设置      │   │ │
│  │  └──────────┘ └──────────┘ └───────────────┘   │ │
│  │                                                  │ │
│  └──────────────────────┬──────────────────────────┘ │
│                         │ IPC                         │
│  ┌──────────────────────▼──────────────────────────┐ │
│  │              Main Process (Node.js)              │ │
│  │                                                  │ │
│  │  ┌────────────────────────────────────────────┐  │ │
│  │  │              Core Engine                   │  │ │
│  │  │  ┌───────────┐ ┌──────────┐ ┌──────────┐  │  │ │
│  │  │  │ Collector  │ │ Analyzer │ │ Generator│  │  │ │
│  │  │  │ Jira/Git/  │ │ LLM/     │ │ Checklist│  │  │ │
│  │  │  │ Codebase   │ │ Impact   │ │ /Draft   │  │  │ │
│  │  │  └───────────┘ └──────────┘ └──────────┘  │  │ │
│  │  └────────────────────────────────────────────┘  │ │
│  │                                                  │ │
│  │  ┌──────────────┐  ┌──────────────────────────┐  │ │
│  │  │ SQLite (本地) │  │ Playwright Runner (本地) │  │ │
│  │  └──────────────┘  └──────────────────────────┘  │ │
│  │                                                  │ │
│  │  ┌──────────────────────────────────────────────┐│ │
│  │  │        Sync Layer (可选上传)                  ││ │
│  │  │  本地 SQLite ──▶ 远程 PostgreSQL             ││ │
│  │  └──────────────────────────────────────────────┘│ │
│  │                                                  │ │
│  └──────────────────────────────────────────────────┘ │
│                                                       │
└──────────────────────────────────────────────────────┘
```

### 进程职责划分

| 进程 | 职责 | 技术 |
|------|------|------|
| Main Process | 引擎调度、数据库读写、文件系统操作、Git 命令执行、Playwright 控制 | Node.js + better-sqlite3 |
| Renderer Process | UI 展示、用户交互、实时状态更新 | React + Vite |
| Utility Process | LLM 长时间调用、Playwright 测试执行（避免阻塞 Main） | Electron utilityProcess |

**为什么用 Utility Process？** LLM 分析和 Playwright 执行都是耗时操作。放在 Main Process 会卡住整个应用。Electron 的 utilityProcess API 可以在独立进程中运行这些任务，通过 MessagePort 通信。

---

## 三、技术栈选型

| 层面 | 选型 | 理由 |
|------|------|------|
| 应用框架 | Electron + electron-vite | electron-vite 开箱即用，HMR 快，构建优化好 |
| 前端 | React + TypeScript | 生态最大，组件库丰富 |
| UI 组件 | Shadcn/ui + Tailwind | 轻量、可定制、不引入重型依赖 |
| 本地数据库 | better-sqlite3 | 同步 API 更适合 Electron 主进程，性能优于 sql.js |
| ORM | Drizzle ORM | 轻量、类型安全、支持 SQLite 和 PostgreSQL 双驱动 |
| LLM | Claude API (@anthropic-ai/sdk) | 结构化输出支持好，推理能力强 |
| Git 操作 | simple-git | Node.js Git 操作封装，比手动 exec 更可靠 |
| 测试执行 | Playwright | 唯一选择，生态最好 |
| 代码编辑器 | Monaco Editor (可选) | 展示/编辑测试草稿用 |
| 打包分发 | electron-builder | 支持 Windows/Mac/Linux，自动更新 |
| 图表 | Recharts | React 原生，轻量够用 |

---

## 四、本地数据模型

```sql
-- 项目管理
CREATE TABLE projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  repo_path   TEXT NOT NULL,              -- 本地仓库绝对路径
  jira_base_url   TEXT,
  jira_project    TEXT,
  framework       TEXT,                    -- next.js / vue / react 等
  test_framework  TEXT,                    -- playwright / cypress 等
  config          TEXT,                    -- JSON: 路由模式、测试目录等
  custom_rules    TEXT,                    -- JSON: 项目特定规则
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- 分析记录（核心表）
CREATE TABLE analyses (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id),
  jira_id         TEXT,                    -- PROJ-1234
  jira_title      TEXT,
  jira_desc       TEXT,                    -- 缓存 Jira 描述，离线可查
  branch          TEXT,
  commit_sha      TEXT,
  diff_summary    TEXT,                    -- 变更摘要（不存完整 diff）

  -- 引擎产出
  impact_scope    TEXT,                    -- JSON: 影响范围
  checklist       TEXT,                    -- JSON: 结构化自测清单
  test_drafts     TEXT,                    -- JSON: 测试草稿代码
  risk_level      TEXT,                    -- low / medium / high
  raw_llm_output  TEXT,                    -- 原始 LLM 响应（调试用）

  -- 状态
  status          TEXT NOT NULL DEFAULT 'pending',
  -- pending → collecting → analyzing → done / failed
  error_message   TEXT,

  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

-- 执行记录
CREATE TABLE executions (
  id              TEXT PRIMARY KEY,
  analysis_id     TEXT NOT NULL REFERENCES analyses(id),
  test_type       TEXT NOT NULL,           -- generated / existing
  test_code       TEXT,                    -- 执行的测试代码
  status          TEXT NOT NULL DEFAULT 'pending',
  -- pending → running → passed / failed / error
  passed_count    INTEGER DEFAULT 0,
  failed_count    INTEGER DEFAULT 0,
  duration_ms     INTEGER,
  result_detail   TEXT,                    -- JSON: 详细结果
  failure_summary TEXT,                    -- LLM 生成的失败摘要
  artifacts_dir   TEXT,                    -- 本地路径: 截图/视频
  created_at      INTEGER NOT NULL
);

-- 开发者反馈
CREATE TABLE feedbacks (
  id              TEXT PRIMARY KEY,
  analysis_id     TEXT NOT NULL REFERENCES analyses(id),
  item_index      INTEGER NOT NULL,        -- 清单中第几项
  item_text       TEXT NOT NULL,           -- 建议内容（冗余存储方便统计）
  useful          INTEGER NOT NULL,        -- 1=有用 0=没用
  comment         TEXT,
  created_at      INTEGER NOT NULL
);

-- 上传同步状态
CREATE TABLE sync_log (
  id              TEXT PRIMARY KEY,
  table_name      TEXT NOT NULL,
  record_id       TEXT NOT NULL,
  synced_at       INTEGER,
  sync_status     TEXT DEFAULT 'pending',  -- pending / synced / failed
  UNIQUE(table_name, record_id)
);

-- 索引
CREATE INDEX idx_analyses_project ON analyses(project_id);
CREATE INDEX idx_analyses_jira ON analyses(jira_id);
CREATE INDEX idx_analyses_created ON analyses(created_at);
CREATE INDEX idx_executions_analysis ON executions(analysis_id);
CREATE INDEX idx_feedbacks_analysis ON feedbacks(analysis_id);
CREATE INDEX idx_sync_status ON sync_log(sync_status);
```

### 数据存储位置

```
~/.testmind/
├── config.json          # 全局配置（LLM API key、Jira token 等）
├── testmind.db          # SQLite 数据库
├── artifacts/           # 测试产物
│   └── {analysis_id}/
│       ├── screenshots/
│       ├── videos/
│       └── traces/
└── logs/
    └── app.log
```

**为什么用 `~/.testmind/` 而不是应用内目录？**
- 卸载重装不丢数据
- 多版本 Electron 共享数据
- 方便备份和迁移

---

## 五、核心界面设计

### 5.1 主界面 — 分析工作台

这是开发者 90% 时间停留的页面。设计原则：**一键触发，快速获得结果。**

```
┌──────────────────────────────────────────────────────┐
│  TestMind                              ─  □  ✕      │
│──────────────────────────────────────────────────────│
│  📁 项目  │                                          │
│           │  新建分析                                 │
│  ┌──────┐ │  ┌──────────────────────────────────────┐│
│  │my-app│ │  │ Jira ID    [PROJ-1234        ]  [▼] ││
│  │      │ │  │ 分支       [feature/captcha  ]  自动 ││
│  │admin │ │  │                                      ││
│  │      │ │  │            [ 🔍 开始分析 ]           ││
│  │      │ │  └──────────────────────────────────────┘│
│  │      │ │                                          │
│  │      │ │  最近分析                                 │
│  │      │ │  ┌──────────────────────────────────────┐│
│  │      │ │  │ 🟢 PROJ-1234 登录验证码    10min ago ││
│  │      │ │  │ 🟢 PROJ-1231 用户列表分页  2h ago    ││
│  │      │ │  │ 🔴 PROJ-1228 支付回调      1d ago    ││
│  │      │ │  └──────────────────────────────────────┘│
│  └──────┘ │                                          │
└──────────────────────────────────────────────────────┘
```

### 5.2 分析结果页

```
┌──────────────────────────────────────────────────────┐
│  ← PROJ-1234: 登录页添加验证码           ─  □  ✕    │
│──────────────────────────────────────────────────────│
│                                                      │
│  ⏱ 分析耗时 8.2s  │ 风险: 🟡 中  │ 建议 12 项       │
│                                                      │
│  ┌─ 📍 影响范围 ─────────────────────────────────┐   │
│  │                                                │   │
│  │  pages/login.tsx          ← 主要变更           │   │
│  │  components/Captcha.tsx   ← 新增               │   │
│  │  api/auth/login.ts        ← 接口变更           │   │
│  │  ⚠️ pages/register.tsx    ← 可能受影响         │   │
│  │                                                │   │
│  └────────────────────────────────────────────────┘   │
│                                                      │
│  ┌─ ✅ 自测清单 ──────────────────────────────────┐  │
│  │                                                │   │
│  │  🔴 必测                                       │   │
│  │  ☐ 正常登录 + 正确验证码 → 成功       👍 👎   │   │
│  │  ☐ 验证码图片点击刷新               👍 👎    │   │
│  │  ☐ 错误验证码 → 提示错误不清空密码   👍 👎    │   │
│  │                                                │   │
│  │  🟡 应测                                       │   │
│  │  ☐ 验证码 60s 过期 → 提示刷新        👍 👎   │   │
│  │  ☐ 连续5次错误 → 账号锁定            👍 👎   │   │
│  │                                                │   │
│  │  🔵 回归                                       │   │
│  │  ☐ 注册页面 AuthLayout 未受影响      👍 👎    │   │
│  │                                                │   │
│  └────────────────────────────────────────────────┘   │
│                                                      │
│  ┌─ 📝 测试草稿 ──────────────── [复制] [执行] ──┐  │
│  │  import { test, expect } from '@playwright..   │   │
│  │  test('登录-正确验证码', async ({ page }) => { │   │
│  │    await page.goto('/login');                   │   │
│  │    ...                                         │   │
│  │  });                                           │   │
│  └────────────────────────────────────────────────┘   │
│                                                      │
│  ┌─ 🏃 执行结果 ─────────────────────────────────┐  │
│  │  ✅ 3 passed  ❌ 1 failed  ⏭ 0 skipped        │   │
│  │                                                │   │
│  │  ❌ 验证码过期测试                              │   │
│  │  原因: 验证码组件未实现 60s 倒计时逻辑          │   │
│  │  📸 [查看截图]  🎬 [查看录屏]                  │   │
│  └────────────────────────────────────────────────┘   │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### 5.3 项目设置页

```
┌──────────────────────────────────────────────────────┐
│  ⚙️ 项目设置: my-web-app                ─  □  ✕    │
│──────────────────────────────────────────────────────│
│                                                      │
│  基本信息                                            │
│  ┌────────────────────────────────────────────────┐  │
│  │ 项目名称    [my-web-app              ]         │  │
│  │ 仓库路径    [/Users/dev/projects/my-app] [选择]│  │
│  │ 框架        [Next.js            ▼]             │  │
│  │ 测试框架    [Playwright         ▼]             │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  Jira 连接                                           │
│  ┌────────────────────────────────────────────────┐  │
│  │ Jira URL    [https://company.atlassian.net ]   │  │
│  │ 项目 Key    [PROJ                         ]   │  │
│  │ API Token   [••••••••••••••••            ] 🔑 │  │
│  │ [测试连接]                                     │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  代码扫描规则                                         │
│  ┌────────────────────────────────────────────────┐  │
│  │ 路由文件     src/app/**/page.tsx               │  │
│  │ 测试目录     tests/**/*.spec.ts                │  │
│  │ Page Object  tests/pages/**/*.ts               │  │
│  │ 排除目录     node_modules, .next, dist         │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  自定义规则                                           │
│  ┌────────────────────────────────────────────────┐  │
│  │ + 登录变更必须测试 SSO 和本地两种方式           │  │
│  │ + 涉及金额必须测试小数精度                      │  │
│  │ + [添加规则]                                    │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### 5.4 数据总览页（轻量 Dashboard）

```
┌──────────────────────────────────────────────────────┐
│  📊 数据总览                             ─  □  ✕    │
│──────────────────────────────────────────────────────│
│                                                      │
│  ┌──────────┐ ┌──────────┐ ┌───────────────┐        │
│  │ 总分析数  │ │ 建议采纳率│ │ 本月活跃项目  │        │
│  │   89     │ │   72%    │ │   3           │        │
│  └──────────┘ └──────────┘ └───────────────┘        │
│                                                      │
│  📈 分析趋势（按周）           🥧 建议类型分布        │
│  ┌─────────────────────┐      ┌──────────────┐      │
│  │       ▃▅▇█▇         │      │ 边界 35%     │      │
│  │  W1 W2 W3 W4 W5    │      │ 权限 28%     │      │
│  └─────────────────────┘      │ 回归 22%     │      │
│                               │ 其他 15%     │      │
│  📋 高价值建议 TOP 5           └──────────────┘      │
│  ┌────────────────────────────────────────────┐      │
│  │ 1. 边界条件:空值处理         采纳率 91%    │      │
│  │ 2. 权限:角色切换验证         采纳率 85%    │      │
│  │ 3. 回归:共用组件影响检查     采纳率 78%    │      │
│  └────────────────────────────────────────────┘      │
│                                                      │
│  [↑ 上传数据到团队服务器]                             │
│                                                      │
└──────────────────────────────────────────────────────┘
```

---

## 六、可选上传 / 同步机制

### 设计原则

- **本地优先**：所有功能离线可用（LLM 调用除外）
- **上传可选**：用户主动选择是否同步到远程
- **增量同步**：只上传新增/变更的记录
- **脱敏处理**：代码 diff 不上传，只上传分析结果和统计数据

### 同步架构

```
本地 Electron App                         远程服务器
┌──────────────┐                    ┌──────────────────┐
│  SQLite      │    HTTPS/REST      │  PostgreSQL      │
│              │ ──────────────▶    │                  │
│  analyses    │  增量上传           │  analyses        │
│  feedbacks   │  脱敏数据           │  feedbacks       │
│  executions  │                    │  executions      │
│              │                    │                  │
│  sync_log    │  记录同步状态       │  团队 Dashboard  │
└──────────────┘                    └──────────────────┘
```

### 同步策略

```typescript
// 同步逻辑
interface SyncConfig {
  enabled: boolean;
  serverUrl: string;
  apiKey: string;
  autoSync: boolean;       // 自动同步 or 手动触发
  syncInterval: number;    // 自动同步间隔（分钟）
  dataPolicy: {
    syncDiff: boolean;     // 是否同步代码 diff（默认 false）
    syncTestCode: boolean; // 是否同步测试草稿（默认 false）
    syncArtifacts: boolean;// 是否同步截图视频（默认 false）
  };
}

// 上传内容（脱敏后）
interface SyncPayload {
  analyses: {
    id: string;
    projectName: string;   // 项目名（非路径）
    jiraId: string;
    riskLevel: string;
    checklistItemCount: number;
    status: string;
    createdAt: number;
  }[];
  feedbacks: {
    analysisId: string;
    itemIndex: number;
    useful: boolean;
    createdAt: number;
  }[];
  executions: {
    analysisId: string;
    passedCount: number;
    failedCount: number;
    durationMs: number;
    createdAt: number;
  }[];
}
```

### 远程服务器（需要时再建）

远程服务器非常轻量，只做两件事：

1. **接收数据**：一个 REST API 接收各客户端上传的脱敏数据
2. **团队 Dashboard**：聚合展示，提供跨人员/跨项目的视角

技术：Next.js + PostgreSQL，或者甚至一个简单的 Express + PG 就够。

---

## 七、分步实施计划

### Phase 0：引擎原型 + 最简 Electron 壳（第 1-3 周）

**目标：跑通 Jira + diff → LLM → 自测清单的完整链路，套上 Electron 壳**

#### 项目结构

```
testmind/
├── package.json
├── electron.vite.config.ts
├── electron-builder.yml
├── src/
│   ├── main/                       # Electron 主进程
│   │   ├── index.ts                # 应用入口
│   │   ├── ipc.ts                  # IPC handler 注册
│   │   └── store.ts                # 全局配置管理（electron-store）
│   │
│   ├── preload/                    # 预加载脚本
│   │   └── index.ts                # 暴露 API 给 renderer
│   │
│   ├── renderer/                   # React UI
│   │   ├── App.tsx
│   │   ├── pages/
│   │   │   ├── Home.tsx            # 项目列表 + 触发分析
│   │   │   └── AnalysisResult.tsx  # 分析结果展示
│   │   └── components/
│   │       ├── Checklist.tsx       # 自测清单组件
│   │       └── ImpactScope.tsx     # 影响范围组件
│   │
│   └── engine/                     # 核心引擎（进程无关）
│       ├── engine.ts               # 引擎入口
│       ├── collector/
│       │   ├── jira.ts             # Jira API 采集
│       │   └── git-diff.ts         # 本地 Git diff
│       ├── analyzer/
│       │   └── prompt.ts           # Prompt 模板
│       └── generator/
│           └── checklist.ts        # 自测清单生成
│
├── resources/                      # 应用图标等资源
└── .env                            # API keys（不提交）
```

#### 关键实现

**IPC 通信设计：**

```typescript
// src/preload/index.ts
// 向 Renderer 暴露的 API
contextBridge.exposeInMainWorld('testmind', {
  // 项目管理
  addProject: (config: ProjectConfig) => ipcRenderer.invoke('project:add', config),
  listProjects: () => ipcRenderer.invoke('project:list'),

  // 分析
  startAnalysis: (params: AnalysisParams) => ipcRenderer.invoke('analysis:start', params),
  getAnalysis: (id: string) => ipcRenderer.invoke('analysis:get', id),

  // 进度监听（流式）
  onAnalysisProgress: (callback: (progress: Progress) => void) => {
    ipcRenderer.on('analysis:progress', (_, progress) => callback(progress));
  },

  // 文件选择
  selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory'),
})

// src/main/ipc.ts
// 主进程处理
ipcMain.handle('analysis:start', async (_, params: AnalysisParams) => {
  const analysis = await engine.analyze({
    jiraId: params.jiraId,
    repoPath: params.repoPath,
    branch: params.branch,
    onProgress: (progress) => {
      // 实时推送进度到 renderer
      mainWindow.webContents.send('analysis:progress', progress);
    },
  });
  // 保存到 SQLite
  await db.insert(analyses).values(analysis);
  return analysis;
});
```

**进度流式推送（核心体验）：**

```typescript
// 引擎分析过程会推送多个阶段的进度
type ProgressStage =
  | { stage: 'collecting_jira'; message: '正在获取 Jira 信息...' }
  | { stage: 'collecting_diff'; message: '正在分析代码变更...' }
  | { stage: 'analyzing'; message: 'LLM 正在分析...' }
  | { stage: 'generating'; message: '正在生成自测清单...' }
  | { stage: 'done'; result: AnalysisResult };

// Renderer 侧展示实时进度
function AnalysisProgress({ stage }: { stage: ProgressStage }) {
  return (
    <div className="flex items-center gap-2">
      <Spinner />
      <span>{stage.message}</span>
      <ProgressDots stage={stage.stage} />
    </div>
  );
}
```

#### 可行性分析

| 项目 | 评估 | 说明 |
|------|------|------|
| electron-vite 脚手架 | ✅ 简单 | `npm create @quick-start/electron` 一键生成 |
| IPC 通信 | ✅ 简单 | Electron 核心能力，文档完善 |
| better-sqlite3 集成 | ⚠️ 注意 | 需要 native module rebuild，electron-vite 已处理 |
| Jira REST API | ✅ 简单 | 标准 REST，只需 token 认证 |
| 本地 Git 操作 | ✅ 简单 | simple-git 库成熟，直接调用本地 git |
| Claude API 调用 | ✅ 简单 | @anthropic-ai/sdk，支持流式 |
| React UI 基础页面 | ✅ 简单 | 2-3 个页面，不复杂 |
| **总体风险** | **低-中** | **native module 是唯一需要注意的点** |

#### 验证标准
- 能选择本地项目目录
- 输入 Jira ID 触发分析
- 实时看到分析进度
- 完成后展示结构化自测清单
- 数据保存到本地 SQLite

---

### Phase 1：代码上下文 + 反馈闭环（第 4-6 周）

**目标：分析质量显著提升，建立反馈循环**

#### 新增内容

```
src/engine/
├── collector/
│   └── codebase.ts         # 🆕 代码库上下文
│       - 路由映射扫描
│       - 已有测试文件发现
│       - data-testid 提取
│       - 组件依赖分析
│       - git 热力图（变更频率）
│
├── analyzer/
│   ├── impact.ts           # 🆕 影响范围分析
│   └── prompt.ts           # 升级：注入代码上下文
│
└── generator/
    └── test-draft.ts       # 🆕 Playwright 测试草稿

src/renderer/
├── pages/
│   └── AnalysisResult.tsx  # 升级：加入反馈按钮
└── components/
    ├── FeedbackButton.tsx  # 🆕 👍👎 反馈组件
    └── TestDraftViewer.tsx # 🆕 测试草稿查看器（代码高亮）
```

#### 代码上下文采集细节

```typescript
// codebase.ts

interface CodebaseCollector {
  // 1. 扫描路由结构
  // 根据框架类型（Next.js/Vue/React Router）用不同策略
  scanRoutes(repoPath: string, framework: string): RouteMapping[];

  // 2. 找到变更文件关联的测试
  // 策略：同名文件、同目录、import 关系
  findRelatedTests(changedFiles: string[], testPatterns: string[]): TestFile[];

  // 3. 提取 data-testid
  // 正则扫描 TSX/JSX/Vue 文件
  extractTestIds(filePaths: string[]): TestIdInfo[];

  // 4. 组件被谁引用
  // 解析 import 语句，构建引用图
  findComponentUsages(componentPath: string, repoPath: string): string[];

  // 5. 文件变更热度
  // git log --follow --format=%H -- <file> | wc -l
  getChangeFrequency(files: string[], days: number): FileHeatMap;
}
```

#### 可行性分析

| 项目 | 评估 | 说明 |
|------|------|------|
| 路由结构扫描 | ⚠️ 中等 | Next.js 文件路由 glob 可解；其他框架需解析配置文件 |
| 测试文件关联 | ✅ 简单 | 文件名约定 + 目录结构匹配 |
| data-testid 提取 | ✅ 简单 | 正则 `data-testid=["']([^"']+)` |
| import 解析 | ⚠️ 中等 | 用 ts-morph 或正则做基础解析，不需要完整 AST |
| Git 热力图 | ✅ 简单 | simple-git log 统计 |
| 反馈收集存储 | ✅ 简单 | SQLite insert，UI 上加按钮 |
| 测试草稿生成 | ⚠️ 中等 | 质量依赖 prompt + 上下文，但"草稿"定位降低标准 |
| **总体风险** | **低** | **工程量适中，无技术不确定性** |

---

### Phase 2：Playwright 执行 + 产物管理（第 7-10 周）

**目标：在 Electron 内直接执行测试，收集截图/视频**

#### 新增内容

```
src/engine/executor/
├── runner.ts               # Playwright 执行器
│   - 创建临时测试项目
│   - 安装依赖（首次）
│   - 执行测试（超时控制）
│   - 在 Utility Process 中运行
│
├── sandbox.ts              # 沙箱环境管理
│   - ~/.testmind/sandbox/  临时执行目录
│   - package.json 模板
│   - playwright.config 模板
│   - 执行完成后清理
│
├── artifact.ts             # 产物收集
│   - 截图归档
│   - 视频保存（失败用例）
│   - trace 文件
│   - 存入 ~/.testmind/artifacts/{id}/
│
└── result.ts               # 结果解析
    - 解析 Playwright JSON reporter
    - 调用 LLM 生成失败原因摘要
    - 结构化结果写入 SQLite

src/renderer/
├── components/
│   ├── ExecutionPanel.tsx   # 🆕 执行面板
│   ├── ScreenshotViewer.tsx # 🆕 截图查看器
│   └── VideoPlayer.tsx      # 🆕 录屏播放器（失败用例）
```

#### Playwright 沙箱执行方案

```typescript
// 为什么用沙箱而不是直接在用户项目中执行？
// 1. 不污染用户项目的 node_modules
// 2. 不依赖用户项目是否已安装 Playwright
// 3. 执行环境一致可控

class PlaywrightSandbox {
  private sandboxDir: string;

  async prepare() {
    // 1. 创建临时目录
    this.sandboxDir = path.join(os.homedir(), '.testmind', 'sandbox', nanoid());

    // 2. 写入 package.json（固定版本）
    await writeFile(join(this.sandboxDir, 'package.json'), JSON.stringify({
      dependencies: { '@playwright/test': '^1.50.0' }
    }));

    // 3. 安装依赖（首次慢，后续从缓存加载）
    await exec('npm install', { cwd: this.sandboxDir });

    // 4. 确保浏览器已安装
    await exec('npx playwright install chromium', { cwd: this.sandboxDir });
  }

  async execute(testCode: string, config: ExecutionConfig) {
    // 5. 写入测试文件
    await writeFile(join(this.sandboxDir, 'test.spec.ts'), testCode);

    // 6. 写入 playwright.config.ts
    await writeFile(join(this.sandboxDir, 'playwright.config.ts'),
      generateConfig(config));

    // 7. 在 Utility Process 中执行（不阻塞 UI）
    const result = await this.runInUtilityProcess(
      'npx playwright test --reporter=json',
      { cwd: this.sandboxDir, timeout: config.timeout ?? 60_000 }
    );

    // 8. 收集产物
    const artifacts = await this.collectArtifacts();

    return { result, artifacts };
  }

  async cleanup() {
    await rm(this.sandboxDir, { recursive: true });
  }
}
```

#### 可行性分析

| 项目 | 评估 | 说明 |
|------|------|------|
| Utility Process 执行 | ✅ 简单 | Electron API，文档完善 |
| Playwright 沙箱 | ⚠️ 中等 | 首次安装耗时，需要处理网络/缓存问题 |
| 浏览器管理 | ⚠️ 中等 | Chromium ~150MB，需要引导用户首次安装 |
| 截图/视频收集 | ✅ 简单 | Playwright 原生支持，直接拷贝文件 |
| 结果 JSON 解析 | ✅ 简单 | Playwright JSON reporter 格式固定 |
| 产物查看器 UI | ✅ 简单 | 图片展示 + 视频播放，标准组件 |
| **总体风险** | **中等** | **首次 Playwright 安装体验需要优化** |

#### 缓解措施
- Playwright 浏览器可以全局共享（`~/.cache/ms-playwright/`），不需要每个沙箱独立安装
- 首次使用时引导下载，显示进度条
- 提供"跳过执行"选项，自测清单本身不依赖执行

---

### Phase 3：Jira 智能集成 + CI 联动（第 11-14 周）

**目标：从手动触发进化为半自动/自动触发**

#### 3a. Jira 深度集成

```
增强:
- Jira ID 智能补全（输入时搜索）
- 自动检测当前分支关联的 Jira
- 分析完成后可选回写 Jira comment
- 支持 Jira webhook 推送（本地监听）
```

**Jira ID 自动检测：**
```typescript
// 从分支名提取 Jira ID
// feature/PROJ-1234-add-captcha → PROJ-1234
function detectJiraFromBranch(branch: string): string | null {
  const match = branch.match(/([A-Z]+-\d+)/);
  return match ? match[1] : null;
}

// 从最近 commit message 提取
function detectJiraFromCommits(commits: string[]): string | null {
  for (const msg of commits) {
    const match = msg.match(/([A-Z]+-\d+)/);
    if (match) return match[1];
  }
  return null;
}
```

#### 3b. CLI 命令（Electron 外的触发方式）

```bash
# 安装全局 CLI
npm install -g @testmind/cli

# CLI 向本地 Electron 发送分析请求
# 通过 local HTTP server（Electron 内起一个轻量 server）
$ testmind check PROJ-1234

# CI 中使用
$ testmind check PROJ-1234 --output report.md --format markdown
```

**Electron 启用本地 API：**
```typescript
// main process 启动一个本地 HTTP server
// 只监听 127.0.0.1，仅本机可访问
const server = createServer(async (req, res) => {
  if (req.url === '/api/analyze' && req.method === 'POST') {
    const params = await parseBody(req);
    const result = await engine.analyze(params);
    res.end(JSON.stringify(result));
  }
});
server.listen(19823, '127.0.0.1');
// CLI 工具向 http://127.0.0.1:19823/api/analyze 发请求
```

#### 可行性分析

| 项目 | 评估 | 说明 |
|------|------|------|
| Jira ID 自动检测 | ✅ 简单 | 正则匹配，纯本地 |
| Jira 搜索补全 | ✅ 简单 | Jira REST API search |
| Jira comment 回写 | ✅ 简单 | POST /rest/api/3/issue/{id}/comment |
| 本地 HTTP server | ✅ 简单 | Node.js http 模块，无需框架 |
| 全局 CLI 工具 | ✅ 简单 | 一个轻量 npm 包，转发请求 |
| **总体风险** | **低** | **全是成熟技术的简单组合** |

---

### Phase 4：数据上传 + 团队视角（第 15-18 周）

**目标：打通数据上传通道，让管理者看到团队数据**

#### 4a. Electron 侧：同步模块

```
src/
└── sync/
    ├── sync-manager.ts     # 同步调度
    │   - 手动/自动触发
    │   - 增量检测（基于 sync_log）
    │   - 重试机制
    │
    ├── data-sanitizer.ts   # 数据脱敏
    │   - 移除代码 diff
    │   - 移除测试草稿源码
    │   - 保留统计维度字段
    │
    └── upload-client.ts    # HTTP 上传
        - 分批上传
        - 断点续传
        - 认证 token
```

#### 4b. 远程服务端（此时才需要建）

```
testmind-server/
├── package.json
├── src/
│   ├── app.ts              # Express/Fastify
│   ├── routes/
│   │   ├── ingest.ts       # 数据接收 API
│   │   └── dashboard.ts    # Dashboard 数据 API
│   ├── db/
│   │   └── schema.ts       # PostgreSQL schema（Drizzle）
│   └── auth/
│       └── entra.ts        # Microsoft Entra ID
├── web/                    # Dashboard 前端（可以是 Next.js）
│   └── ...
└── docker-compose.yml      # PG + Redis + App
```

**服务端做的事情非常少：**
1. 接收各客户端上传的脱敏数据
2. 存入 PostgreSQL
3. 提供聚合查询 API
4. 渲染 Dashboard Web 页面

#### 可行性分析

| 项目 | 评估 | 说明 |
|------|------|------|
| 增量同步逻辑 | ⚠️ 中等 | 需要处理冲突和幂等，但单向上传简化了很多 |
| 数据脱敏 | ✅ 简单 | 字段级过滤，白名单模式 |
| 远程 API 服务 | ✅ 简单 | 标准 CRUD |
| Entra ID 集成 | ⚠️ 中等 | 服务端接入 SSO，需要 IT 配合 |
| Dashboard 页面 | ⚠️ 中等 | 图表+聚合查询，工程量适中 |
| **总体风险** | **中等** | **SSO 接入可能需要跨团队协调** |

---

### Phase 5：智能进化（第 19 周+）

#### 5a. Prompt 自优化

```
反馈数据积累
    │
    ▼
分析高采纳/低采纳建议的模式
    │
    ▼
调整 prompt 策略
    - 哪类建议最有价值 → 增加权重
    - 哪类建议总被忽略 → 降低优先级
    - 哪些项目规则最有效 → 推荐给相似项目
```

#### 5b. 本地知识库

```
~/.testmind/
└── knowledge/
    └── {project_id}/
        ├── patterns.json     # 该项目的 bug 模式
        ├── hot-modules.json  # 高风险模块
        └── effective-rules.json  # 验证过的有效规则
```

每次分析时自动注入历史知识，让建议越来越精准。

#### 5c. 跨项目洞察（需要远程服务）

```
服务端聚合所有上传数据：
- "权限类变更"在所有项目中问题率最高 → 全局加强
- "周五下午的提交"bug 率高 30% → 提示开发者额外注意
- 某个模块连续 3 个 sprint 都有回归 → 标记为高风险
```

#### 可行性分析

| 项目 | 评估 | 说明 |
|------|------|------|
| Prompt 调优分析 | ⚠️ 中等 | 需要设计评分模型，但可以从简单统计开始 |
| 本地知识库 | ✅ 简单 | JSON 文件读写 |
| 跨项目分析 | ⚠️ 中等 | 依赖足够的上传数据量 |
| **总体风险** | **中等** | **效果依赖数据积累，需 3-6 个月使用才有意义** |

---

## 八、升级路径总览

```
Phase 0 (W1-3)         Phase 1 (W4-6)        Phase 2 (W7-10)
┌────────────┐         ┌────────────┐        ┌────────────────┐
│ Electron壳 │ ──────▶ │ 代码上下文 │ ─────▶ │ Playwright     │
│ + 引擎原型 │         │ + 反馈闭环 │        │ 执行 + 产物    │
│ + SQLite   │         │ + 测试草稿 │        │ + 沙箱环境     │
└────────────┘         └────────────┘        └────────────────┘
                                                     │
Phase 5 (W19+)        Phase 4 (W15-18)      Phase 3 (W11-14)
┌────────────────┐    ┌────────────────┐    ┌────────────────┐
│ 智能进化       │◀── │ 数据上传       │◀── │ Jira 深度集成  │
│ Prompt迭代    │    │ + 团队Dashboard│    │ + CLI 联动     │
│ 知识库        │    │ + 远程服务端   │    │ + 自动检测     │
└────────────────┘    └────────────────┘    └────────────────┘
```

### 复杂度渐进

```
阶段    本地存储              远程服务           额外进程
──────────────────────────────────────────────────────────
P0      SQLite               无                 无
P1      SQLite               无                 无
P2      SQLite + 文件系统     无                 Utility Process
P3      SQLite + 文件系统     无                 Utility + 本地 HTTP
P4      SQLite + 文件系统     PostgreSQL         Utility + 本地 HTTP
P5      SQLite + 知识库文件   PostgreSQL + Redis Utility + 本地 HTTP
```

每一步只增加真正需要的复杂度，绝不提前引入。

---

## 九、Electron 特有的工程考量

### 自动更新

```typescript
// electron-builder 内置 autoUpdater
import { autoUpdater } from 'electron-updater';

autoUpdater.checkForUpdatesAndNotify();
// 支持 GitHub Releases / S3 / 自建服务器 作为更新源
```

### 安全性

```typescript
// 所有敏感信息（API Key、Jira Token）使用 safeStorage 加密
import { safeStorage } from 'electron';

function storeSecret(key: string, value: string) {
  const encrypted = safeStorage.encryptString(value);
  // 存入本地文件，系统级加密
}
```

### 性能优化

| 场景 | 策略 |
|------|------|
| 大型 diff 分析 | 截取前 5000 行 + 文件变更摘要，避免 LLM token 浪费 |
| 代码库扫描 | 增量扫描（基于 git status），首次全量后缓存 |
| SQLite 并发 | WAL 模式，读写不互斥 |
| UI 响应性 | 所有引擎操作在 Utility Process，UI 永不卡顿 |
| 启动速度 | 延迟加载非核心模块，首屏 < 2s |

### 打包体积控制

| 组件 | 大小 | 策略 |
|------|------|------|
| Electron 本体 | ~85MB | 不可避免 |
| better-sqlite3 | ~2MB | 必须 |
| 业务代码 | ~5MB | tree-shaking |
| Playwright 浏览器 | ~150MB | 首次使用时下载，不打包 |
| **总计安装包** | **~95MB** | **可接受** |

---

## 十、风险矩阵

| 风险 | 概率 | 影响 | 缓解策略 |
|------|------|------|----------|
| LLM 建议质量不稳定 | 高 | 致命 | Phase 0 专门验证；反馈数据驱动迭代 |
| native module 编译问题 | 中 | 中 | electron-vite 已处理；CI 多平台构建 |
| Playwright 浏览器安装失败 | 中 | 低 | 执行是可选功能；提供手动安装引导 |
| 自动更新失败 | 低 | 低 | 提供手动下载链接兜底 |
| SQLite 数据损坏 | 低 | 中 | WAL 模式 + 定期备份提示 |
| LLM API 成本 | 低 | 中 | 缓存相同分析；限制 diff 长度 |
| 开发者觉得太重不愿装 | 中 | 高 | 安装包控制在 100MB 内；首次体验 30s 出结果 |

---

## 十一、成功指标

### 开发者维度（最重要）

| 指标 | 衡量方式 | 目标 |
|------|----------|------|
| 日活分析次数 | 本地统计 | > 3 次/人/天 |
| 建议采纳率 | 👍👎 反馈 | > 60% |
| 分析到结果时间 | 引擎计时 | < 15s（不含执行） |
| 持续使用率 | 周留存 | > 70% |

### 团队维度（Phase 4 后）

| 指标 | 衡量方式 | 目标 |
|------|----------|------|
| 团队覆盖率 | 上传数据人数/团队人数 | > 50% |
| 提测 bug 减少率 | 对比接入前后 Jira bug 数 | > 20% |
| 高风险模块识别准确率 | 回顾性分析 | > 70% |
