# Alma 桌面 AI 应用架构分析

创建时间：2026-03-22
分析目的：拆解 Alma 的架构设计模式，为 TestMind 架构设计提供参考

---

## 一、Alma 是什么

Alma 是一个基于 Electron 的桌面 AI 聊天应用，具备浏览器控制能力。它的定位不是简单的聊天界面，而是一个**本地优先的多能力 AI 代理平台**。

核心能力包括：

- 统一接入多个 AI 模型提供商（OpenAI、Anthropic、Google、DeepSeek 等 13+ 种）
- Chrome 浏览器控制中继系统
- 31 个内置技能（编程、Telegram、Discord、飞书、图片生成、音乐、语音等）
- 可扩展的插件系统
- 多工作区隔离
- 向量 + 关键词双层记忆系统
- 多平台社交集成（Telegram、Discord、飞书）

一句话：Alma 是一个把 AI 能力做成本地操作系统的桌面应用。

---

## 二、部署与打包结构

### 2.1 安装布局

```
/opt/Alma/
├── alma                          # Electron 主二进制（~200MB）
├── resources/
│   ├── app.asar                  # 打包的应用代码（620MB ASAR 归档）
│   ├── app.asar.unpacked/
│   │   └── node_modules/         # 原生模块（better-sqlite3 等）
│   ├── bundled-skills/           # 31 个内置技能
│   ├── cli/                      # 命令行工具
│   │   └── alma                  # CLI 入口（Node.js 脚本）
│   ├── chrome-extension/         # 浏览器中继扩展
│   ├── bun/                      # 内嵌的 Bun JS 运行时
│   ├── tts/                      # 文本转语音引擎
│   └── uv/                       # 额外运行时工具
```

### 2.2 用户数据布局

```
~/.config/alma/
├── chat_threads.db               # SQLite 主数据库（250MB + WAL）
├── api-spec.md                   # 完整 REST API 文档
├── USER.md                       # 用户画像（YAML frontmatter）
├── SOUL.md                       # Bot 人格定义（注入 system prompt）
├── window-state.json             # 窗口位置与状态
├── mcp.json                      # Model Context Protocol 配置
├── Preferences                   # Chromium 格式偏好
├── workspaces/                   # 工作区
│   ├── default/
│   │   ├── .alma-snapshots/      # 快照历史（类 git）
│   │   ├── workspace/            # 项目根目录
│   │   ├── node_modules/         # 工作区专属依赖
│   │   └── package.json
│   └── temp-*/                   # 临时工作区
├── groups/                       # 群聊历史
│   ├── discord_*.log
│   ├── feishu_*.log
│   └── media/
├── people/                       # 逐人档案
├── plugins/                      # 已安装插件
│   └── antigravity-auth/
├── plugin-storage/               # 插件专属数据
├── plugin-global-storage/        # 插件共享数据
├── missions/                     # 任务编排数据
├── artifacts/                    # 生成的产物
├── backups/                      # 自动备份
├── gallery_cache/                # 图片缓存
├── cron/                         # 定时任务配置
└── selfies/                      # 自拍相册
```

**关键设计决策：** 应用代码和用户数据完全分离。`/opt/Alma` 是只读应用，`~/.config/alma` 是可写用户数据。这意味着应用升级不会影响用户数据，也方便备份和迁移。

---

## 三、分层架构分析

Alma 的架构可以拆成六层来理解。

### 3.1 桌面壳层（Electron Shell）

**职责：** 窗口管理、系统托盘、文件系统桥接、本地权限控制、进程通信。

- 主二进制是标准 Electron 应用
- 内嵌 Bun 运行时用于 CLI 和部分高性能任务
- 窗口状态持久化到 `window-state.json`
- 原生模块通过 `app.asar.unpacked/node_modules/` 加载（避免 ASAR 内无法加载 `.node` 文件的问题）

**值得学习的点：**
- ASAR 打包 + unpacked 原生模块分离，是 Electron 应用的最佳实践
- 窗口状态独立文件保存，简单且可靠
- 内嵌 Bun 运行时，CLI 启动速度极快

### 3.2 本地 API 服务层

Alma 没有把业务逻辑全塞在 Electron 主进程里，而是在本地起了一个 REST API 服务。

**Base URL：** `http://localhost:23001`

**核心端点：**

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/settings` | GET / PUT | 完整设置对象读写 |
| `/api/settings/reset` | POST | 重置默认设置 |
| `/api/settings/test-proxy` | POST | 测试代理连通性 |
| `/api/providers` | CRUD | AI 提供商管理 |
| `/api/providers/:id/test` | POST | 提供商连通性测试 |
| `/api/providers/:id/models` | GET / PUT | 模型列表管理 |
| `/api/providers/:id/models/fetch` | POST | 从远端拉取可用模型 |
| `/api/models` | GET | 跨提供商聚合模型列表 |
| `/api/threads` | CRUD | 会话线程管理 |
| `/api/health` | GET | 健康检查 |
| `/api/plan-mode` | POST | 规划模式切换 |
| `/api/browser-relay/config` | GET | 浏览器扩展自动配置 |
| `/ws/browser-relay` | WS | 浏览器控制 WebSocket |

**值得学习的点：**

1. **设置管理用完整对象覆盖写**：PUT `/api/settings` 要求传完整对象，不支持局部更新。看似不便，实则避免了合并冲突和部分更新导致的不一致状态。这个设计选择在本地单用户场景下非常合理。

2. **提供商有独立的连通性测试端点**：`POST /providers/:id/test`，返回 `{ success, latencyMs }` 或 `{ success: false, error }`。这不是可有可无的功能——当用户配了错误的 API Key 或代理时，能立刻得到反馈，大幅降低排错成本。

3. **模型 ID 用复合格式**：`providerId:modelId`（如 `abc123:gpt-4o`）。一个简单的约定解决了多提供商下的模型唯一性问题。

4. **浏览器扩展自动发现配置**：扩展启动时尝试 `GET /api/browser-relay/config` 获取端口和 token，如果失败再用本地存储的配置。这种"先自动、后手动"的模式很优雅。

### 3.3 Provider 抽象层

这是 Alma 最值得研究的架构设计之一。

**支持的提供商类型：**

```typescript
type ProviderType =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'aihubmix'
  | 'openrouter'
  | 'deepseek'
  | 'copilot'
  | 'azure'
  | 'moonshot'
  | 'custom'
  | 'acp'
  | 'claude-subscription'
  | 'zai-coding-plan';
```

**Provider 数据模型：**

```typescript
interface Provider {
  id: string;
  name: string;
  type: ProviderType;
  models: StoredProviderModel[];           // 已启用模型
  availableModels: StoredProviderModel[];  // 全部可用模型
  apiKey: string;                          // 加密存储
  baseURL?: string;
  apiVersion?: string;                     // Azure 专用
  enabled: boolean;
  createdAt: string;
  updatedAt: string;

  // ACP 专属字段
  acpCommand?: string;
  acpArgs?: string[];
  acpMcpServerIds?: string[];
  acpModelMapping?: {
    defaultModel?: string;
    opusModel?: string;
    sonnetModel?: string;
    haikuModel?: string;
  };
}
```

**模型能力元数据：**

```typescript
interface StoredProviderModel {
  id: string;
  name: string;
  capabilities?: {
    vision?: boolean;
    imageOutput?: boolean;
    functionCalling?: boolean;
    functionCallingViaXml?: boolean;
    jsonMode?: boolean;
    streaming?: boolean;
    reasoning?: boolean;
    contextWindow?: number;
    maxOutputTokens?: number;
  };
  isManual?: boolean;
  providerOptions?: Record<string, any>;
}
```

**值得学习的点：**

1. **能力声明式描述**：每个模型不是只有名字，而是带有结构化的能力声明。系统可以根据任务需要选择合适的模型（比如需要视觉能力时自动排除纯文本模型）。这个模式非常适合 TestMind 的多模型场景。

2. **已启用 vs 全部可用的分离**：`models` 和 `availableModels` 分开存储。用户可以从提供商拉取所有可用模型，但只启用需要的。避免了不必要的模型出现在选择列表中。

3. **类型特定字段用可选属性**：ACP 相关字段不是放在单独的表里，而是作为 Provider 的可选属性。这在类型不多、字段不多的情况下比多表关联简单得多。

4. **API Key 加密存储**：即使是本地应用，敏感凭证也不明文保存。

### 3.4 插件系统

Alma 的插件系统是整个架构中最精巧的部分。

**插件目录结构（以 antigravity-auth 为例）：**

```
~/.config/alma/plugins/antigravity-auth/
├── manifest.json        # 插件清单
├── main.ts              # 入口文件（34KB）
└── ...
```

**manifest.json 结构：**

```json
{
  "type": "provider",
  "permissions": ["network", "oauth", "provider-management"],
  "activationEvents": ["onStartup"],
  "contributes": {
    "providers": [
      {
        "id": "antigravity",
        "name": "Antigravity (Google)",
        "authType": "oauth"
      }
    ],
    "commands": [
      { "command": "antigravity.login" },
      { "command": "antigravity.logout" }
    ]
  }
}
```

**插件激活流程：**

```
App 启动
  → 扫描 ~/.config/alma/plugins/*/manifest.json
  → 匹配 activationEvents（如 onStartup）
  → 调用 main.ts 导出的 activate(context)
  → 插件通过 context 注册能力
```

**PluginContext 提供的 API：**

| API | 用途 |
|-----|------|
| `context.logger` | 结构化日志 |
| `context.storage` | 插件专属持久化 KV 存储 |
| `context.providers` | 提供商注册 |
| `context.commands` | 命令注册 |
| `context.ui` | UI 集成钩子 |
| `context.notifications` | 桌面通知 |

**插件注册 Provider 的模式：**

```typescript
export async function activate(context: PluginContext) {
  context.providers.registerProvider({
    id: 'antigravity',
    name: 'Antigravity (Google)',
    authType: 'oauth',
    onAuth: async (code) => { /* OAuth 流程 */ },
    onFetchModels: async () => { /* 模型发现 */ },
    onStreamCompletion: async (request) => { /* 流式推理 */ },
  });
}
```

**插件数据隔离：**

```
~/.config/alma/
├── plugin-storage/
│   └── antigravity-auth/
│       └── secrets.json          # 加密的 OAuth token
├── plugin-global-storage/        # 插件间共享数据
```

**值得学习的点：**

1. **manifest.json 声明式清单**：插件的类型、权限、激活条件、贡献点全部声明在清单里。宿主不需要运行插件代码就能知道它能做什么。这个模式直接借鉴了 VS Code 的扩展系统。

2. **PluginContext 注入**：插件不直接导入宿主模块，而是通过注入的 context 对象获取能力。这是经典的控制反转，确保插件只能使用宿主显式暴露的 API。

3. **数据隔离**：每个插件有自己的 `plugin-storage` 目录，不会互相干扰。同时有 `plugin-global-storage` 用于跨插件共享。

4. **权限声明**：`permissions: ["network", "oauth", "provider-management"]` 明确了插件需要什么权限，为后续的安全审计提供基础。

### 3.5 技能系统（Skill System）

技能和插件不同。插件是底层能力扩展，技能是面向 AI 的功能模块。

**31 个内置技能分类：**

| 类别 | 技能 | 说明 |
|------|------|------|
| 核心管理 | self-management, tasks, scheduler, mission-control, plan-mode, thread-management, memory-management | 系统自管理 |
| 社交集成 | telegram, discord, feishu | 多平台消息 |
| 浏览器 | browser, web-search, web-fetch | 网页控制与搜索 |
| 内容生成 | image-gen, music-gen, voice, video-reader | 多模态能力 |
| 开发工具 | coding-agent, notebook, file-manager, screenshot | 编程辅助 |
| 实用工具 | todo, reactions, selfie, travel, send-file, skill-hub | 日常功能 |

**技能定义格式（SKILL.md）：**

每个技能是一个目录，核心是 `SKILL.md` 文件：

```yaml
---
name: scheduler
description: 定时任务管理
allowed-tools:
  - Bash
  - Read
  - Write
---

# Scheduler Skill

## 可用命令
- alma cron add <name> <type> <schedule>
- alma cron list
- alma cron run <name>
- alma cron history <name>
...
```

**值得学习的点：**

1. **技能 = Markdown 文档 + 工具权限**：技能不是代码，而是一份注入 AI 上下文的说明文档加上工具白名单。这种模式极其轻量，任何人都能编写新技能。

2. **工具权限白名单**：`allowed-tools` 限制了每个技能能使用哪些工具。比如 `web-search` 技能只能用 WebSearch 和 WebFetch，不能用 Bash。这是最小权限原则的很好实践。

3. **技能市场**：`skill-hub` 技能可以从 skills.sh 搜索和安装社区技能。这为生态扩展提供了基础。

### 3.6 浏览器控制层（Browser Relay）

Alma 通过 Chrome 扩展实现 AI 控制浏览器。

**架构：**

```
┌─────────────┐   WebSocket   ┌─────────────┐   Chrome API   ┌──────────┐
│  Alma Main  │◄─────────────►│  Extension   │◄─────────────►│  Browser  │
│  Process    │  :23001/ws/   │  background  │  Tabs/Debug   │  Tabs     │
│             │  browser-relay│  .js         │  Protocol     │          │
└─────────────┘               └─────────────┘               └──────────┘
```

**通信协议：**

```typescript
// 命令请求
{ id: string, method: string, params: object }

// 命令响应
{ id: string, result: object }
// 或
{ id: string, error: string }

// 事件推送
{ type: 'cdp_event', tabId: number, method: string, params: object }

// 心跳
{ type: 'ping' } / { type: 'pong' }

// 状态同步
{ type: 'status', attachedTabs: number[] }
```

**支持的命令：**

| 命令 | 功能 |
|------|------|
| `tabs.list` | 列出所有标签页 |
| `tabs.create` | 创建新标签页 |
| `tabs.navigate` | 导航到 URL |
| `tabs.screenshot` | 截取当前可见标签页 |
| `debugger.attach` | 附加 Chrome DevTools Protocol |
| `debugger.detach` | 解除调试器 |
| `cdp.send` | 发送任意 CDP 命令 |

**连接管理：**

```javascript
// 指数退避重连
let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 30000;

function scheduleReconnect() {
  setTimeout(() => connect(true), reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
}

// 双层心跳：
// 1. Chrome Alarms（每 25 秒）保持 Service Worker 存活
// 2. WebSocket Ping/Pong（每 20 秒）检测连接存活
// 如果 60 秒无 Pong 响应，断开重连
```

**状态指示：**

```javascript
// Badge 颜色状态机
'connected'    → 绿色 "ON"
'connecting'   → 黄色 "..."
'disconnected' → 红色 "OFF"

// 静默重连不闪烁 Badge
connect(silent = true)  // 后台重连，不更新 Badge 到 "..."
connect(silent = false) // 用户触发，显示 "..."
```

**值得学习的点：**

1. **静默重连**：后台自动重连时不闪烁状态指示，只在用户主动触发时才显示"连接中"。这个细节体现了对用户体验的重视——频繁的状态闪烁会让用户焦虑。

2. **双层心跳**：Chrome Alarms 保 Service Worker 活，WebSocket Ping 保连接活。两个问题用两个机制分别解决，互不干扰。

3. **自动附加调试器**：`cdp.send` 命令会自动附加尚未附加的标签页，减少调用方的操作步骤。

4. **配置热更新**：通过 `chrome.storage.onChanged` 监听设置变更，自动断开旧连接并用新配置重连。

---

## 四、数据持久化设计

### 4.1 SQLite 作为主数据库

- 数据库：`~/.config/alma/chat_threads.db`（250MB）
- 启用 WAL（Write-Ahead Logging）模式，支持并发读取
- 通过 `better-sqlite3` 原生绑定访问（同步 API，更适合 Electron 主进程）

**为什么选 better-sqlite3 而不是其他方案：**
- 同步 API，避免 Electron 主进程中异步回调地狱
- 性能最好的 Node.js SQLite 绑定
- 原生模块，不是 WASM，查询速度接近原生

### 4.2 文件系统作为辅助存储

| 数据类型 | 存储位置 | 格式 |
|----------|----------|------|
| 窗口状态 | `window-state.json` | JSON |
| 用户画像 | `USER.md` | YAML frontmatter + Markdown |
| Bot 人格 | `SOUL.md` | Markdown |
| 插件密钥 | `plugin-storage/*/secrets.json` | 加密 JSON |
| 群聊日志 | `groups/*.log` | 纯文本日志 |
| 人员档案 | `people/*.md` | YAML frontmatter + Markdown |
| 快照历史 | `.alma-snapshots/` | JSON 索引 + JSON 快照 |
| MCP 配置 | `mcp.json` | JSON |
| 定时任务 | `cron/` | JSON |

**值得学习的点：**

1. **不是所有数据都进数据库**：结构化查询需求强的（会话线程、消息）进 SQLite，配置类的用 JSON 文件，人类可读的用 Markdown。每种数据用最适合它的存储方式。

2. **YAML frontmatter + Markdown**：USER.md 和人员档案用这种格式，既方便程序解析元数据（YAML 部分），又方便人类阅读和手动编辑（Markdown 部分）。这个模式在内容管理中很常见，但 Alma 把它用在了用户画像上，很聪明。

3. **快照系统类似 Git**：`.alma-snapshots/` 目录有 `history.json`（提交历史）和 `snapshots/<hash>.json`（每个快照内容），支持 parentId 形成链式历史。这是一个轻量级版本控制。

### 4.3 Settings 数据结构

Alma 的设置系统是一个深度嵌套的 TypeScript 接口，按功能域组织：

```typescript
interface AppSettings {
  general: {         // 通用：语言、主题、托盘行为、默认工作区
    language: 'zh' | 'en';
    theme: 'light' | 'dark' | 'system';
    autoStart: boolean;
    minimizeToTray: boolean;
    closeToTray: boolean;
    startMinimized: boolean;
    defaultWorkspaceId?: string;
  };
  chat: {            // 聊天：默认模型、温度、token 限制、音效
    defaultModel: string;      // "providerId:modelId"
    temperature: number;
    maxTokens: number;
    streamResponse: boolean;
    soundEffects: { enabled, volume, synthPreset };
    autoCompact: { enabled, threshold, keepRecentMessages, summaryModel? };
  };
  ui: {              // 界面：字号、密度、侧栏宽度
    fontSize: number;
    density: 'compact' | 'comfortable' | 'spacious';
    sidebarWidth: number;
  };
  network: {         // 网络：代理、超时、重试
    proxy: { enabled, type, host, port, username?, password? };
    timeout: number;
    retryAttempts: number;
  };
  data: {            // 数据：存储路径、备份策略、同步
    dataPath: string;
    enableBackup: boolean;
    backupInterval: 'daily' | 'weekly' | 'monthly';
    enableSync: boolean;
  };
  security: {        // 安全：加密、密码、会话超时、日志级别
    encryptApiKeys: boolean;
    requirePassword: boolean;
    sessionTimeout: number;
    logLevel: 'error' | 'warn' | 'info' | 'debug';
  };
  memory: {          // 记忆：自动摘要、自动检索、相似度阈值
    enabled: boolean;
    autoSummarize: boolean;
    autoRetrieve: boolean;
    maxRetrievedMemories: number;
    similarityThreshold: number;
  };
  keybindings: {     // 快捷键
    newChatThread: string;
    sendMessage: string;
    toggleSidebar: string;
  };
  whisper: {         // 语音识别
    enabled: boolean;
    model: string;
    language: string;
  };
  webSearch: {       // 网页搜索引擎
    engine: 'google' | 'xiaohongshu';
  };
  terminal: {        // 终端：字体、字号
    fontFamily: string;
    fontSize: number;
  };
  themeConfig: {     // 主题：深色/浅色主题、NvChad 集成
    darkTheme: string | null;
    lightTheme: string | null;
    pluginThemeId: string | null;
  };
  advanced: {        // 高级：实验功能、开发者模式、自定义 CSS/JS
    enableExperimentalFeatures: boolean;
    debugMode: boolean;
    developerMode: boolean;
    customCss?: string;
    customJs?: string;
  };
}
```

**值得学习的点：**

1. **按功能域分组而不是扁平化**：`general.theme` 而不是 `theme`。层级结构让设置在 UI 上自然对应到不同的设置面板标签页。

2. **枚举约束**：`density: 'compact' | 'comfortable' | 'spacious'` 而不是 `density: string`。编译期就能发现无效值。

3. **完整读写而不是局部更新**：PUT `/api/settings` 要求完整对象。在本地单用户场景下，这比 PATCH 更简单、更安全。

---

## 五、工作区隔离模型

Alma 的工作区隔离是一个很好的设计：

```
workspaces/
├── default/
│   ├── .alma-snapshots/     # 快照版本控制
│   ├── workspace/           # 实际项目文件
│   ├── home/                # 工作区 home 目录
│   ├── node_modules/        # 工作区独立依赖
│   ├── package.json         # 工作区配置
│   └── threads/             # 对话归档（用于 memory grep）
└── temp-*/                  # 临时工作区
```

**工作区能力：**

- 每个工作区有独立的文件系统空间
- Bash、Read、Write 等工具操作都限定在工作区目录内
- Discord/Telegram/飞书频道可以绑定到特定工作区
- 环境变量 `ALMA_THREAD_ID` 在切换线程时自动设置

**值得学习的点：**

TestMind 的"项目"概念天然对应工作区。每个项目有自己的代码仓库、Jira 配置、模型配置、执行历史，互不干扰。Alma 的工作区隔离模式可以直接借鉴。

---

## 六、记忆系统

Alma 的记忆是双层设计：

### 第一层：向量记忆（语义搜索）

```bash
alma memory search "关于 React 性能优化的讨论"
```

- 基于 embedding 的相似度检索
- 支持配置相似度阈值、最大检索数量
- 可选的查询重写（用 LLM 改写搜索词提高召回率）

### 第二层：对话归档（精确搜索）

```bash
alma memory grep "useState"
```

- 对话线程自动归档为 Markdown（带 YAML frontmatter）
- 每 5 分钟自动更新
- 支持全文关键词搜索

### 第三层：人员档案

```bash
alma people show "张三"
```

- 每人一个 Markdown 文件
- 比向量搜索更可靠的"谁是谁"问题回答

**值得学习的点：**

TestMind 的推荐反馈、历史执行数据、项目知识积累，都可以借鉴这种多层记忆模型。比如：
- 向量搜索用于"类似的 Jira 任务之前的测试建议"
- 精确搜索用于"这个模块最近的失败记录"
- 项目档案用于"这个项目的测试约定和已知问题"

---

## 七、CLI 设计

Alma 的 CLI 不是一个独立工具，而是与桌面应用共享同一个后端的轻量客户端。

**启动方式：**

```bash
# ~/.local/bin/alma 是一个 bash 脚本
# 实际执行：/opt/Alma/resources/bun/bun /opt/Alma/resources/cli/alma

# 通过 REST API 与运行中的 Alma 通信
ALMA_API_URL=http://localhost:23001
```

**CLI 命令结构（部分）：**

```bash
# 配置管理
alma config get general.theme
alma config set general.theme dark
alma config list

# 提供商管理
alma providers

# 定时任务
alma cron add daily-summary heartbeat "0 9 * * *" --prompt "..."
alma cron list
alma cron run <name>
alma cron history <name>

# 工作区
alma workspace list
alma workspace switch <name>

# 记忆
alma memory search "query"
alma memory grep "keyword"

# 人员
alma people list
alma people show <name>

# 任务编排
alma mission create "goal" --goals "g1" "g2"
alma mission status
alma comms send <missionId> "message"

# 群聊
alma group history <chatId>
alma group search <keyword>

# 系统
alma status
alma update check
alma heartbeat enable
```

**值得学习的点：**

1. **CLI 和 GUI 共享后端**：CLI 不是另一套逻辑，而是 REST API 的薄封装。一个后端，两种交互方式。这对 TestMind 意义重大——MVP-0 可以先做 CLI，后续加 GUI 时不需要重写后端。

2. **命令分组清晰**：`alma config`、`alma cron`、`alma memory`、`alma mission`，每个子命令对应一个功能域。

---

## 八、定时任务与心跳系统

### 定时任务（Cron）

```bash
alma cron add <name> <type> <schedule> [options]
  --mode main|isolated    # 在主线程还是隔离线程执行
  --prompt "..."          # 执行的提示词
  --deliver-to CHAT_ID    # 结果发送到哪个聊天
```

### 心跳系统（Heartbeat）

- 每隔 N 分钟读取工作区的 `HEARTBEAT.md`，执行其中定义的检查项
- 典型用途：检查未读消息、发送日报、检测用户不活跃

**值得学习的点：**

TestMind 的 CI 集成场景天然需要定时任务——比如 PR 创建时自动触发分析、每天汇总项目质量指标。Alma 的 cron 系统可以参考。

---

## 九、安全模型

| 维度 | Alma 的做法 |
|------|------------|
| API Key | 加密存储，API 响应中不暴露明文 |
| 插件密钥 | 独立 `secrets.json`，加密 |
| 插件权限 | manifest.json 声明所需权限 |
| 会话安全 | 可配置密码保护和会话超时 |
| 代理安全 | 代理密码可选 |
| 日志安全 | 可配置日志级别，避免敏感信息输出 |
| 用户识别 | USER.md 中多平台 ID，防止冒充 |

---

## 十、对 TestMind 设计的关键启示

从 Alma 的架构中，我认为以下设计模式最值得 TestMind 借鉴：

### 10.1 必须借鉴的

1. **本地 REST API 服务**：不要把所有逻辑塞进 Electron 主进程，起一个本地 HTTP 服务。CLI 和 GUI 共享同一套 API。
2. **Provider 抽象 + 能力声明**：LLM 提供商、数据源、执行器都应该有统一的接口和能力声明。
3. **插件系统**（manifest.json + PluginContext 注入）：数据源（Jira/GitLab/GitHub）、执行器（Playwright/Cypress）、模型提供商都应该做成插件。
4. **设置按功能域分组**：不要扁平化，按项目配置、模型配置、执行器配置、隐私策略等分组。
5. **数据分层存储**：结构化数据进 SQLite，配置用 JSON，附件走文件系统。

### 10.2 可以借鉴的

6. **工作区隔离模型**：TestMind 的项目天然对应工作区，可以参考 Alma 的隔离方式。
7. **双层记忆**：向量搜索用于相似任务推荐，精确搜索用于历史记录查找。
8. **CLI 先行**：MVP-0 做 CLI，验证核心假设；后续 GUI 复用同一套 API。
9. **连接管理模式**：指数退避重连、静默重连、双层心跳，在 TestMind 连接 Jira/Git 服务时同样适用。

### 10.3 不需要借鉴的

10. Alma 的社交集成（Telegram/Discord/飞书）——TestMind 不需要。
11. Alma 的多模态内容生成（图片/音乐/语音）——TestMind 不需要。
12. Alma 的 SOUL.md 人格系统——TestMind 是工具，不是聊天伴侣。

---

## 十一、总结

Alma 是一个设计水准很高的本地 AI 桌面应用。它的核心架构思想可以概括为：

**"本地 API 服务 + 声明式插件 + 能力抽象 + 工作区隔离 + 多层存储"**

对 TestMind 来说，最大的收获不是照搬 Alma 的功能，而是学习它的**架构分层方式**和**扩展性设计模式**。TestMind 的业务域完全不同，但底层的架构骨架——Provider 抽象、插件激活、API 服务、数据分层——是可以复用的。

下一步将基于这些分析，输出 TestMind 的完整架构设计文档。
