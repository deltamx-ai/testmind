# Alma 全栈架构逆向分析

> 分析时间：2026-03-22
> 分析来源：本机安装实例 `/opt/Alma/` + 用户数据 `~/.config/alma/` + 源码 `/home/delta/alma/`
> 分析目的：彻底拆解 Alma 的架构设计，提取可复用的工程模式，为 TestMind 架构设计提供实证参考

---

## 〇、一句话定位

Alma 是一个 **本地优先的桌面 AI 代理平台**，不是聊天界面。它的核心价值主张是：把多个 AI 提供商、浏览器控制、技能系统、插件生态、任务编排整合到一个本地运行的 Electron 桌面应用中，同时暴露 HTTP API 和 CLI，使同一套核心能力可以通过多种入口访问。

---

## 一、部署拓扑：三入口 + 双存储

### 1.1 安装结构（`/opt/Alma/`）

```
/opt/Alma/                              ← 只读，应用升级替换整个目录
├── alma                                # Electron 主二进制（~200MB）
├── chrome_crashpad_handler             # 崩溃收集
├── libffmpeg.so / libvk_*.so / ...     # Chromium 依赖库
├── locales/                            # 国际化
├── resources/
│   ├── app.asar                        # 打包的 JS/CSS/HTML（620MB）
│   ├── app.asar.unpacked/
│   │   └── node_modules/               # 原生模块（better-sqlite3, whisper 等）
│   ├── bundled-skills/                 # 31 个内置技能（Markdown 文件）
│   │   ├── browser.md
│   │   ├── coding-agent.md
│   │   ├── telegram.md
│   │   ├── discord.md
│   │   ├── scheduler.md
│   │   ├── mission-control.md
│   │   └── ... (共 31 个)
│   ├── cli/
│   │   └── alma                        # CLI 入口脚本
│   ├── bun/
│   │   └── bun                         # 内嵌 Bun JS 运行时
│   ├── chrome-extension/               # 浏览器中继扩展源码
│   ├── tts/                            # 文本转语音引擎
│   └── uv/                             # Python 包管理器
└── v8_context_snapshot.bin             # V8 快照（加速启动）
```

**关键设计决策：**

| 决策 | 理由 |
|------|------|
| ASAR 打包 + unpacked 分离 | `.node` 原生模块无法从 ASAR 内加载，必须 unpacked |
| 内嵌 Bun 运行时 | CLI 启动跳过 Electron 初始化，毫秒级响应 |
| 技能文件外置 | 用户可直接编辑/新增技能，无需重新打包 |
| 应用与数据物理分离 | `/opt/Alma` 只读 vs `~/.config/alma` 读写，升级不丢数据 |

### 1.2 三种入口

```
┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐
│  Electron 桌面    │   │  CLI             │   │  systemd 服务     │
│  /opt/Alma/alma   │   │  ~/.local/bin/   │   │  alma.service    │
│                  │   │  alma            │   │                  │
└────────┬─────────┘   └────────┬─────────┘   └────────┬─────────┘
         │                      │                       │
         └──────────────────────┼───────────────────────┘
                                │
                    ┌───────────▼───────────┐
                    │  本地 API 服务         │
                    │  http://127.0.0.1:    │
                    │  23001                │
                    │  + WebSocket          │
                    └───────────┬───────────┘
                                │
                    ┌───────────▼───────────┐
                    │  SQLite + 文件系统      │
                    │  ~/.config/alma/      │
                    └───────────────────────┘
```

CLI 实现极其简洁：
```bash
#!/bin/bash
exec "/opt/Alma/resources/bun/bun" "/opt/Alma/resources/cli/alma" "$@"
```

三种入口共享同一份数据存储和 API 服务。这意味着 CLI 做的操作、桌面 UI 看到的变化、systemd 守护的服务——全部是同一个状态。

### 1.3 用户数据结构（`~/.config/alma/`）

```
~/.config/alma/                         ← 可写，所有持久状态
├── chat_threads.db                     # SQLite 主数据库（250MB + WAL 120MB）
├── api-spec.md                         # 完整 REST API 文档（自动生成）
├── USER.md                             # 用户画像（YAML frontmatter + 正文）
├── SOUL.md                             # Bot 人格注入（system prompt 扩展）
├── mcp.json                            # Model Context Protocol 服务器配置
├── window-state.json                   # 窗口位置和大小
├── Preferences                         # Chromium 偏好（JSON）
│
├── workspaces/                         # 多工作区
│   ├── default/
│   │   ├── .alma-snapshots/            # 版本历史（类 git，JSON 索引）
│   │   ├── workspace/                  # 项目目录
│   │   ├── node_modules/
│   │   └── package.json
│   └── temp-*/                         # 临时工作区
│
├── missions/                           # 任务编排
│   └── missions.json                   # 所有 mission 的状态
├── tasks/
│   └── tasks.json                      # 细粒度任务
│
├── groups/                             # 群聊历史
│   ├── discord_*.log                   # Discord 群日志
│   ├── feishu_*.log                    # 飞书群日志
│   └── media/                          # 群聊媒体文件
├── people/                             # 逐人档案（YAML + Markdown）
│
├── plugins/                            # 已安装插件
│   └── antigravity-auth/
│       ├── manifest.json
│       └── main.ts
├── plugin-storage/                     # 插件专属数据（每插件一目录）
│   └── antigravity-auth/
│       └── secrets.json                # 加密的凭证
├── plugin-global-storage/              # 跨插件共享存储
├── plugin-cache/                       # 插件缓存
│
├── cron/                               # 定时任务
│   ├── jobs.json
│   └── runs.json                       # 执行历史
├── artifacts/                          # 生成产物
├── backups/                            # 自动备份
├── gallery_cache/                      # 图片生成缓存
└── selfies/                            # 自拍相册
```

**混合持久化策略——这是 Alma 最值得学习的数据架构：**

| 存储形式 | 适用场景 | Alma 中的实例 |
|---------|---------|-------------|
| **SQLite** | 需要查询、聚合、索引的结构化数据 | `chat_threads.db`（会话、消息、提供商配置） |
| **JSON 文件** | 配置、状态快照、小规模结构化数据 | `window-state.json`、`missions.json`、`mcp.json` |
| **YAML+Markdown** | 需要人类可读可编辑的配置 | `USER.md`、`SOUL.md`、`people/*.md` |
| **纯文本日志** | 时序追加写入、人类可读 | `groups/*.log` |
| **二进制文件** | 媒体、缓存 | `gallery_cache/`、`selfies/`、`media/` |

这不是偶然的混乱，而是有意识的设计：**让每种数据用最适合它的存储形式**。

---

## 二、六层架构详解

### 2.1 层次全景

```
┌─────────────────────────────────────────────────────────┐
│ Layer 1: Desktop Shell (Electron)                       │
│  窗口管理 · 系统托盘 · IPC · 原生菜单 · 全局快捷键         │
├─────────────────────────────────────────────────────────┤
│ Layer 2: Local API Service (port 23001)                 │
│  REST API · WebSocket · 认证 · 路由 · 中间件              │
├─────────────────────────────────────────────────────────┤
│ Layer 3: Provider Abstraction                           │
│  13+ 提供商 · 模型发现 · 能力声明 · 流式推理 · 连通测试      │
├─────────────────────────────────────────────────────────┤
│ Layer 4: Plugin System                                  │
│  Manifest 声明 · Context 注入 · 生命周期 · 数据隔离         │
├─────────────────────────────────────────────────────────┤
│ Layer 5: Skill System (31 built-in)                     │
│  Markdown 定义 · 工具白名单 · AI 面向接口 · 社区扩展       │
├─────────────────────────────────────────────────────────┤
│ Layer 6: Browser Control Relay                          │
│  Chrome 扩展 · WebSocket 协议 · CDP · 标签页管理           │
└─────────────────────────────────────────────────────────┘
         ↕               ↕               ↕
┌─────────────────────────────────────────────────────────┐
│ Data Layer: SQLite + FileSystem + Config                │
└─────────────────────────────────────────────────────────┘
```

### 2.2 Layer 1: Desktop Shell

**职责边界：** 只负责操作系统级交互，不包含任何业务逻辑。

| 功能 | 实现方式 |
|------|---------|
| 窗口管理 | Electron BrowserWindow，状态持久化到 `window-state.json` |
| 系统托盘 | 最小化到托盘，关闭到托盘（可配置） |
| 文件系统 | 通过 Electron IPC 暴露给渲染进程 |
| 全局快捷键 | 可自定义键绑定（`keybindings` 设置） |
| 原生模块 | `app.asar.unpacked/node_modules/` 中的 `.node` 文件 |
| 崩溃收集 | `chrome_crashpad_handler` |

**设计要点：** Shell 层薄而稳定。业务逻辑变化不应该导致 Shell 层修改。

### 2.3 Layer 2: Local API Service

这是 Alma 架构中最关键的决策之一：**把业务逻辑抽成本地 HTTP 服务，而不是全塞在 Electron 主进程里**。

**端点清单（从 `~/.config/alma/api-spec.md` 提取）：**

```
Settings 域:
  GET    /api/settings              → 完整设置对象
  PUT    /api/settings              → 完整覆盖写入（不支持 PATCH）
  POST   /api/settings/reset        → 恢复默认
  POST   /api/settings/test-proxy   → 代理连通测试

Provider 域:
  GET    /api/providers             → 提供商列表
  POST   /api/providers             → 新增提供商
  PUT    /api/providers/:id         → 更新提供商
  DELETE /api/providers/:id         → 删除提供商
  POST   /api/providers/:id/test    → 连通性测试 → {success, latencyMs}
  GET    /api/providers/:id/models  → 已配模型列表
  PUT    /api/providers/:id/models  → 更新模型列表
  POST   /api/providers/:id/models/fetch → 从远端拉取可用模型

Model 域:
  GET    /api/models                → 跨提供商聚合模型列表

Thread 域:
  GET    /api/threads               → 会话列表（支持分页、搜索）
  POST   /api/threads               → 新建会话
  GET    /api/threads/:id           → 单个会话详情
  PUT    /api/threads/:id           → 更新会话
  DELETE /api/threads/:id           → 删除会话
  GET    /api/threads/:id/messages  → 消息历史

系统域:
  GET    /api/health                → 健康检查
  POST   /api/plan-mode             → 规划模式切换

浏览器域:
  GET    /api/browser-relay/config  → 扩展自动配置
  WS     /ws/browser-relay          → 浏览器控制 WebSocket
```

**设计精髓分析：**

1. **设置用完整覆盖写（PUT 而非 PATCH）**
   - 单用户场景无并发冲突风险
   - 避免了深层合并的复杂性
   - 客户端始终持有完整状态，不存在"部分过期"

2. **每个提供商有独立的 `/test` 端点**
   - 用户配错 API Key 时能立刻得到反馈
   - 返回 `{success, latencyMs}` 或 `{success: false, error}`
   - 这不是可有可无的功能，是 UX 的关键差异

3. **模型 ID 复合格式 `providerId:modelId`**
   - 一个简单约定解决了多提供商下的唯一性问题
   - 无需维护额外的映射表

### 2.4 Layer 3: Provider 抽象层

**数据模型：**

```typescript
// 提供商类型枚举
type ProviderType =
  | 'openai' | 'anthropic' | 'google' | 'aihubmix'
  | 'openrouter' | 'deepseek' | 'copilot' | 'azure'
  | 'moonshot' | 'custom' | 'acp'
  | 'claude-subscription' | 'zai-coding-plan';

// 提供商实体
interface Provider {
  id: string;
  name: string;
  type: ProviderType;
  models: StoredProviderModel[];         // 已启用的模型子集
  availableModels: StoredProviderModel[]; // 全部可用模型
  apiKey: string;                        // 加密存储
  baseURL?: string;                      // 自定义端点
  apiVersion?: string;                   // Azure 专用
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

// 模型能力元数据
interface StoredProviderModel {
  id: string;
  name: string;
  capabilities?: {
    vision?: boolean;           // 支持图片输入
    imageOutput?: boolean;      // 支持图片生成
    functionCalling?: boolean;  // 支持工具调用
    functionCallingViaXml?: boolean;
    jsonMode?: boolean;         // 支持 JSON 结构化输出
    streaming?: boolean;        // 支持流式输出
    reasoning?: boolean;        // 支持推理链
    contextWindow?: number;     // 上下文窗口大小
    maxOutputTokens?: number;   // 最大输出 token
  };
  isManual?: boolean;           // 手动添加（非远端拉取）
  providerOptions?: Record<string, any>;
}
```

**为什么这个设计值得学习：**

1. **能力声明 > 运行时探测**：系统在选模型时不需要试探，直接查 capabilities
2. **enabled vs available 分离**：用户从上百个模型中只启用需要的，避免 UI 噪声
3. **类型特定字段用可选属性**：不搞多表继承，用 `?` 可选字段即可
4. **加密存储凭证**：即使本地应用也不明文保存 API Key

### 2.5 Layer 4: 插件系统

**核心设计模式：Manifest 声明 + Context 注入（控制反转）**

```
插件生命周期:

  App 启动
    ↓
  扫描 ~/.config/alma/plugins/*/manifest.json
    ↓
  匹配 activationEvents
    ↓  onStartup / onCommand / onProvider / ...
  调用 main.ts 的 activate(context: PluginContext)
    ↓
  插件通过 context 注册能力
    ↓
  运行时通过 context 提供的 API 交互
    ↓
  App 关闭 → 调用 deactivate()
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

**PluginContext API 表面：**

| API | 用途 | 类比 |
|-----|------|------|
| `context.logger` | 结构化日志 | Winston/Pino |
| `context.storage` | 插件专属 KV 持久化 | localStorage |
| `context.providers` | 注册 AI 提供商 | VS Code Extension API |
| `context.commands` | 注册命令 | VS Code commands |
| `context.ui` | UI 集成钩子 | Webview panels |
| `context.notifications` | 桌面通知 | Electron Notification |

**插件注册提供商的代码模式：**

```typescript
export async function activate(context: PluginContext) {
  context.providers.registerProvider({
    id: 'antigravity',
    name: 'Antigravity (Google)',
    authType: 'oauth',
    onAuth: async (code) => { /* OAuth 回调处理 */ },
    onFetchModels: async () => { /* 模型列表发现 */ },
    onStreamCompletion: async (request) => { /* 流式推理 */ },
  });
}
```

**数据隔离机制：**

```
plugin-storage/                 ← 每插件独立目录，互不可见
  └── antigravity-auth/
      └── secrets.json          ← 加密存储

plugin-global-storage/          ← 跨插件共享空间（需声明权限）
```

**为什么这个设计好：**

1. **不运行代码就能发现能力**：Manifest 是声明式的，启动时扫描 JSON 即可知道插件做什么
2. **控制反转**：插件不 import 宿主，宿主注入 context——插件只能做 context 允许的事
3. **权限最小化**：`permissions` 字段限制插件的能力边界
4. **数据隔离**：每个插件有独立存储目录，默认不能访问其他插件的数据

### 2.6 Layer 5: 技能系统

**技能 ≠ 插件。** 这是 Alma 架构中非常精妙的区分。

| 维度 | 插件 (Plugin) | 技能 (Skill) |
|------|-------------|-------------|
| **面向** | 系统/开发者 | AI 模型 |
| **定义格式** | TypeScript 代码 | Markdown + YAML frontmatter |
| **能力** | 注册提供商、命令、UI | 定义 AI 可以使用哪些工具 |
| **运行时** | 代码执行 | 文档注入 system prompt |
| **创建门槛** | 需要编程 | 写 Markdown 即可 |
| **安全模型** | 沙箱 + 权限声明 | 工具白名单 |

**技能文件格式（以 scheduler 为例）：**

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
## Available Commands
- alma cron add <name> <type> <schedule>
- alma cron list
- alma cron remove <name>
...
```

**31 个内置技能分类：**

| 类别 | 技能名 |
|------|-------|
| **核心** | self-management, tasks, scheduler, mission-control, plan-mode |
| **社交** | telegram, discord, feishu |
| **浏览器** | browser, web-search, web-fetch |
| **内容创作** | image-gen, music-gen, voice, video-reader |
| **开发** | coding-agent, notebook, file-manager, screenshot |
| **工具** | todo, reactions, selfie, travel, send-file, skill-hub |

**设计精髓：** 技能本质上是"AI 的 man page"——告诉模型它在这个场景下可以做什么、怎么做。创建新技能只需要写一个 Markdown 文件。

### 2.7 Layer 6: 浏览器控制中继

**整体架构：**

```
┌───────────────┐     WebSocket      ┌───────────────┐    Chrome API    ┌─────────┐
│  Alma 主进程   │◄──────────────────►│  Chrome 扩展   │◄──────────────►│ 浏览器标签 │
│  port 23001   │    双向通信         │  Service       │   Tabs + CDP    │  页面    │
│               │                    │  Worker        │                │         │
└───────────────┘                    └───────────────┘                └─────────┘
```

**Chrome 扩展文件组成（`/home/delta/alma/chrome-extension/`）：**

| 文件 | 行数 | 职责 |
|------|------|------|
| `manifest.json` | 28 | Manifest V3 声明，权限：debugger, tabs, activeTab, storage, alarms |
| `background.js` | 465 | Service Worker 核心——WebSocket 管理、命令路由、心跳、重连 |
| `popup.html` | 237 | 弹窗 UI——状态指示、已附加标签列表、快捷操作 |
| `popup.js` | 131 | 弹窗逻辑——2秒自动刷新、标签操作消息传递 |
| `options.html` | 197 | 设置页——端口、Token 配置 |
| `options.js` | 94 | 设置逻辑——加载/保存/通知后台重连 |
| `config.json` | 2 | 运行时配置（端口、Token） |

**WebSocket 协议设计：**

```
// 命令请求（Alma → 扩展）
{ "id": "req-123", "method": "tabs.list", "params": {} }

// 命令响应（扩展 → Alma）
{ "id": "req-123", "result": { /* tab data */ } }
{ "id": "req-123", "error": "Tab not found" }

// 事件推送（扩展 → Alma，无 id）
{ "type": "cdp_event", "tabId": 42, "method": "Page.domContentEventFired", "params": {} }

// 心跳
{ "type": "ping" }  ↔  { "type": "pong" }
```

**支持的命令：**

| 命令 | 功能 |
|------|------|
| `tabs.list` | 列出所有标签页 |
| `tabs.create` | 打开新标签 |
| `tabs.navigate` | 导航到 URL |
| `tabs.screenshot` | 截取可见区域 |
| `debugger.attach` | 附加 Chrome DevTools Protocol |
| `debugger.detach` | 分离 CDP |
| `cdp.send` | 发送任意 CDP 命令 |

**连接管理精细设计：**

```javascript
// 指数退避重连
let reconnectDelay = 1000;       // 初始 1 秒
const MAX_RECONNECT_DELAY = 30000; // 最大 30 秒

// 双心跳机制（解决两个不同问题）
// 1. Chrome Alarms (25s) → 保活 Service Worker（Chrome 会杀不活跃的 SW）
// 2. WebSocket Ping (20s) → 监测连接健康
//    60 秒无 Pong → 判定连接断开 → 触发重连

// 静默重连 vs 用户触发重连
// 后台重连：不改变 badge 状态（避免闪烁）
// 用户点击重连：显示 "connecting..." badge + 脉冲动画
```

**Badge 状态机：**

```
connected    → 绿色 "ON"
connecting   → 黄色 "..."（脉冲动画）
disconnected → 红色 "OFF"
```

---

## 三、设置系统深度分析

Alma 的设置系统是一个值得单独分析的设计。

### 3.1 AppSettings 完整结构

```typescript
interface AppSettings {
  general: {
    language: 'zh' | 'en';
    theme: 'light' | 'dark' | 'system';
    autoStart: boolean;
    minimizeToTray: boolean;
    closeToTray: boolean;
    defaultWorkspaceId?: string;
  };

  chat: {
    defaultModel: string;               // 格式: providerId:modelId
    temperature: number;
    maxTokens: number;
    streamResponse: boolean;
    autoSaveHistory: boolean;
    historyRetentionDays: number;
    soundEffects: {
      enabled: boolean;
      volume: number;
      synthPreset: 'classic' | 'ethereal' | 'digital' | 'retro' | 'off';
    };
    autoCompact: {                      // 自动压缩长对话
      enabled: boolean;
      threshold: number;               // 60-95%
      keepRecentMessages: number;
    };
  };

  ui: {
    fontSize: number;
    density: 'compact' | 'comfortable' | 'spacious';
    sidebarWidth: number;
    showLineNumbers: boolean;
    wordWrap: boolean;
  };

  network: {
    proxy: {
      enabled: boolean;
      type: 'http' | 'https' | 'socks5';
      host: string;
      port: number;
    };
    timeout: number;
    retryAttempts: number;
  };

  data: {
    dataPath: string;
    enableBackup: boolean;
    backupInterval: 'daily' | 'weekly' | 'monthly';
  };

  security: {
    encryptApiKeys: boolean;
    requirePassword: boolean;
    sessionTimeout: number;
  };

  memory: {                             // RAG 记忆系统
    enabled: boolean;
    autoSummarize: boolean;
    autoRetrieve: boolean;
    maxRetrievedMemories: number;       // 1-20
    similarityThreshold: number;        // 0-1
  };

  keybindings: {
    newChatThread: string;
    quickChat: string;
    sendMessage: string;
  };
}
```

### 3.2 设置管理的设计选择

| 设计选择 | 分析 |
|---------|------|
| 完整对象覆盖写 | 牺牲带宽换取一致性，单用户场景最合理 |
| 按域名分组 | `general`, `chat`, `ui`, `network`... 清晰的关注点分离 |
| 枚举值用字符串联合类型 | `'compact' \| 'comfortable' \| 'spacious'` 比数字更可读 |
| 阈值有明确范围 | `threshold: 60-95%` 防止极端值 |
| 复合 ID 格式 | `defaultModel: 'providerId:modelId'` 避免了额外的映射表 |

---

## 四、任务编排系统

### 4.1 Mission 结构

```json
{
  "id": "m-mmiu2nam",
  "description": "Complete Discord Bot setup and validation",
  "status": "active",
  "goals": [
    {
      "id": 1,
      "text": "Confirm Discord skill installation",
      "status": "pending"
    },
    {
      "id": 2,
      "text": "Create and configure Discord bot",
      "status": "pending"
    }
  ],
  "agents": [],
  "logs": [
    {
      "text": "Mission auto-created from user task",
      "at": "2026-03-09T07:02:04.654Z",
      "type": "auto-created"
    }
  ],
  "createdAt": "2026-03-09T07:02:04.654Z",
  "updatedAt": "2026-03-09T07:03:28.150Z"
}
```

### 4.2 Mission 与 Task 的关系

```
Mission（战略层）                   Task（战术层）
  ├─ description                     ├─ prompt
  ├─ status: active/completed        ├─ subagentType: coding/research/execution
  ├─ goals[]                         ├─ status: pending/completed/failed
  │   ├─ text                        ├─ result: string
  │   └─ status                      └─ error?: string
  ├─ agents[]
  └─ logs[]
```

Mission 拆解成多个 Goal，每个 Goal 可以分配给不同的 Agent（子代理）执行。Task 是更底层的执行单元。

---

## 五、可提取的设计模式总结

### 5.1 架构模式

| # | 模式 | Alma 中的体现 | 通用价值 |
|---|------|-------------|---------|
| 1 | **统一核心 + 多入口** | Desktop / CLI / systemd 共享同一 API 和数据 | 核心逻辑只写一次，入口按需增加 |
| 2 | **本地 API 网关** | 业务逻辑抽成 HTTP 服务，不硬绑 Electron | 前端框架可替换，CLI 可直接调用 |
| 3 | **Manifest 驱动插件** | 声明式能力发现，不运行代码就知道插件做什么 | 安全、高效、可审计 |
| 4 | **Context 注入（IoC）** | 插件不 import 宿主，宿主注入 PluginContext | 插件能力边界可控 |
| 5 | **混合持久化** | SQLite + JSON + Markdown + 日志各司其职 | 每种数据用最合适的存储形式 |
| 6 | **能力声明式描述** | 模型带 `capabilities` 元数据 | 智能选择而非运行时试探 |
| 7 | **应用 / 数据物理分离** | `/opt/Alma` 只读 vs `~/.config/alma` 读写 | 升级安全、备份简单 |
| 8 | **技能 = 文档 + 白名单** | Markdown 定义 AI 行为边界 | 非程序员可扩展 |
| 9 | **静默重连** | 后台重连不闪烁 UI，用户触发才显示状态 | 尊重用户注意力 |
| 10 | **双心跳机制** | Chrome Alarm 保活 SW + WS Ping 监测连接 | 用两种机制解决两个不同问题 |

### 5.2 数据模式

| # | 模式 | 说明 |
|---|------|------|
| 1 | 完整对象覆盖写 | 单用户场景用 PUT 替代 PATCH，避免合并复杂性 |
| 2 | 复合 ID | `providerId:modelId` 替代映射表 |
| 3 | enabled / available 分离 | 全部可用 vs 用户启用，过滤 UI 噪声 |
| 4 | YAML frontmatter + Markdown body | 结构化元数据 + 人类可读正文 |
| 5 | 事件日志内嵌 | Mission/Task 的 `logs[]` 直接嵌在实体内，不单独建表 |
| 6 | 快照式版本控制 | `.alma-snapshots/` 用 JSON 索引 + 内容文件，类 git 但简化 |

### 5.3 UX 模式

| # | 模式 | 说明 |
|---|------|------|
| 1 | 先自动后手动 | 扩展先尝试 API 自动配置，失败后用本地存储 |
| 2 | 连通性即时反馈 | 配置提供商后立刻可 `/test`，不用等到使用时才知道配错了 |
| 3 | 状态 Badge | 三色状态（绿/黄/红）+ 脉冲动画，一眼可知连接状况 |
| 4 | 弹窗自动刷新 | 2 秒轮询，打开弹窗即看最新状态 |

---

## 六、Alma 架构的局限性（TestMind 不应照搬的部分）

| 局限 | 分析 | TestMind 应如何处理 |
|------|------|-------------------|
| **250MB+ 数据库** | 聊天历史膨胀很快，WAL 文件也很大 | TestMind 数据量较少，但应设计清理策略 |
| **无数据库迁移机制（可观察到）** | 升级时的 schema 变更如何处理不明 | 必须从第一天就引入迁移框架 |
| **过度通用的任务系统** | Mission/Goal/Task/Agent 四层对于很多场景过重 | TestMind 的 CheckTask 单层即可 |
| **插件系统 MVP 阶段过早** | Alma 也只有 1 个插件 | TestMind 先做好内建集成，插件系统 Phase 3 再引入 |
| **设置对象巨大** | 一次 PUT 传整个 AppSettings 对象 | 分域存储，按域读写 |
| **目录结构过于扁平** | `~/.config/alma/` 下直接散落大量文件 | 用更清晰的目录层级 |

---

## 七、结论

Alma 的架构本质上是一个 **"本地操作系统"模型**：统一的核心服务 + 多入口 + 声明式扩展 + 混合持久化。它的设计品质在于：

1. **分层清晰**：每一层有明确的职责边界
2. **扩展点设计精巧**：Plugin 面向系统，Skill 面向 AI，各有定位
3. **数据架构务实**：不执着于"全部放数据库"或"全部用文件"，按数据特性选择
4. **协议设计干净**：WebSocket 命令/响应/事件模型简洁明了

TestMind 应该学习这些模式的本质，而不是照搬它的复杂性。Alma 是一个通用 AI 平台，而 TestMind 是一个聚焦场景的开发工具——复杂度应该小一个数量级。
