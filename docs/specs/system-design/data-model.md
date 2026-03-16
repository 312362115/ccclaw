# 数据模型与权限

> 子文档，主文档：[CCCLaw 系统设计文档](./2026-03-15-ccclaw-design.md)

## ID 策略

**禁止使用数据库自增 ID 作为前端暴露的标识符。** 所有通过 API / URL / WebSocket 传递给前端的 `id` 字段，统一使用 **nanoid**（21 位，纯字母数字字符集 `0-9A-Za-z`）。

| 规则 | 说明 |
|------|------|
| 主数据库表 PK | `nanoid` (text/varchar)，应用层生成，非数据库自增 |
| workspace.db 表 PK | `nanoid` (text)，应用层生成 |
| API 响应 / URL 路径 | 只暴露 nanoid，绝不暴露自增整数 |
| 内部引用（FK） | 与 PK 一致，使用 nanoid |

**理由**：
- 自增 ID 可被枚举，存在安全风险（IDOR 攻击）
- nanoid 比 UUID 更短（21 字符 vs 36 字符），URL 更友好
- 碰撞概率极低（21 位 nanoid 需 ~2.5 万亿 ID 才有 1% 碰撞概率）

**生成方式**：
```typescript
import { customAlphabet } from 'nanoid';

const nanoid = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', 21);
const id = nanoid(); // "BjR2sFk9xqLmN3pW7vHa2"
```

> 以下 schema 中标注的 `uuid PK` 均指 nanoid 生成的字符串主键，非数据库 UUID 类型或自增整数。后续实现时统一替换为 `text PK (nanoid)`。

## 数据模型

### 用户

```
users {
  id:         uuid PK
  name:       string
  email:      string unique
  password:   string (bcrypt)
  role:       'admin' | 'user'
  gitToken:   string? (AES-256-GCM 加密)
  createdAt:  timestamp
  updatedAt:  timestamp
}
```

### 邀请码

用户注册采用管理员邀请码方式，不开放自由注册。管理员在控制面生成邀请码，分发给目标用户。

```
invite_codes {
  id:         uuid PK
  code:       string unique          // 邀请码（随机生成，如 8 位字母数字）
  createdBy:  uuid FK (users.id)     // 创建者（admin）
  usedBy:     uuid? FK (users.id)    // 使用者（注册成功后回填）
  usedAt:     timestamp?             // 使用时间
  expiresAt:  timestamp?             // 过期时间（null 表示永不过期）
  createdAt:  timestamp
}
```

**注册流程**：
1. 管理员在控制面「用户管理」中生成邀请码（可批量生成）
2. 用户在注册页输入邀请码 + 个人信息完成注册
3. 邀请码一次性使用，使用后标记 `usedBy` 和 `usedAt`
4. 过期或已使用的邀请码无法再次注册

**API**：
- `POST /api/admin/invite-codes` — 管理员创建邀请码（可指定过期时间）
- `GET /api/admin/invite-codes` — 管理员查看邀请码列表及使用状态
- `DELETE /api/admin/invite-codes/:id` — 删除未使用的邀请码
- `POST /api/auth/register` — 用户注册（需携带有效邀请码）

### 工作区

```
workspaces {
  id:         uuid PK
  name:       string
  slug:       string unique
  createdBy:  uuid FK (users.id)
  gitRepo:    string?
  settings:   jsonb {
    startMode?: 'docker' | 'local' | 'remote',
    runnerId?: string,
    runtimeConfig?: { memory, cpu, timeout },
    providerId?: uuid,
    model?: string,
    maxIterations?: integer,
    toolConfirmMode?: string,
    heartbeat?: { enabled, intervalMinutes, rulesFile },
    gitRepo?: string,
    gitBranch?: string,
    gitAutoCommit?: boolean
  }
  createdAt:  timestamp
  updatedAt:  timestamp
}
```

工作区通过 `createdBy` 归属用户，不存在多用户协作，无需成员表。

### Provider（模型服务商）

Provider 是对模型服务商的抽象。系统维护支持的 Provider 类型列表（如 Claude、OpenAI），用户自行配置自己的认证凭证（API Key 或 OAuth），并给不同工作区分配不同的 Provider。

**系统支持列表**（代码中硬编码，后续可改为配置）：

| type | 说明 | 认证方式 | 当前状态 |
|------|------|---------|---------|
| `claude` | Anthropic Claude | api_key | 已支持 |
| `openai` | OpenAI | api_key | 预留 |
| `deepseek` | DeepSeek | api_key | 预留 |

**用户 Provider 配置**（主数据库）：

```
providers {
  id:         uuid PK
  userId:     uuid FK (users.id)  // 归属用户
  name:       string              // 显示名称，如 "我的 Claude Key"
  type:       string              // 必须是系统支持列表中的类型
  authType:   'api_key' | 'oauth' // 认证方式
  config:     jsonb (加密)        // 认证配置，按 authType 不同：
                                  //   api_key: { key, apiBase? }
                                  //   oauth:   { clientId, clientSecret, tokenUrl, ... }
  isDefault:  boolean             // 该用户的默认 Provider（每用户最多一个为 true）
  createdAt:  timestamp
  updatedAt:  timestamp
}
```

**优先级**：工作区绑定（`settings.providerId`）> 用户默认（`isDefault=true`）

> 用户必须至少配置一个 Provider 才能使用工作区。未配置时工作区无法发起 Agent 对话。

**当前阶段**：
- 仅实现 `type='claude'` + `authType='api_key'`，通过 Agent SDK 调用
- `config` 字段存 `{ key: "sk-...", apiBase?: "https://..." }`，整体 AES-256-GCM 加密
- 用户在「个人设置 → Provider」中管理，创建工作区时选择绑定哪个

**后续扩展**：
- 系统支持列表中新增 type 即可支持新的模型服务商
- `authType='oauth'` 支持 OAuth 登录获取 token（如某些企业级 API 网关）
- `core/provider/` 目录放各 type 的适配器，统一接口

### 会话与消息（工作区 SQLite）

会话和消息强绑定工作区，是数据量最大的表。存放在工作区的 `workspace.db` 中，Runner 本地直接读写，组装上下文无需走 API。

```
sessions {
  id:         text PK (uuid)
  workspaceId:  text             // 冗余存储，方便查询
  userId:     text
  channelType: text              // 'webui' | 'telegram' | 'feishu'
  title:      text
  status:     text               // 'active' | 'archived'
  summary:    text?              // 归档时 LLM 生成的全量摘要
  lastConsolidated: integer      // 已整合的消息偏移量（0-based），上下文只取此偏移之后的消息
  createdAt:  text (ISO 8601)
}

messages {
  id:         text PK (uuid)
  sessionId:  text FK
  role:       text               // 'user' | 'assistant' | 'system'
  content:    text
  toolCalls:  text? (JSON)
  tokens:     integer?
  createdAt:  text (ISO 8601)
}
```

> sessions 和 messages 原在主数据库，现移至工作区 `workspace.db`。好处：Runner 本地读取历史消息组装上下文、减轻主数据库压力、工作区备份/迁移时对话历史一体打包。Server 通过 RunnerManager 代理 Runner 查询，不直接操作 workspace.db。

> **Append-Only + 偏移量设计**（借鉴 nanobot）：messages 只增不删，`lastConsolidated` 记录已整合到第 N 条消息的偏移量。上下文组装时只取 `messages[lastConsolidated:]` 的尾部，已整合的消息归档到 memories 中但原始记录保留（审计可追溯）。这种设计有利于 LLM cache 命中（前缀不变），也避免了删除消息导致的数据丢失。

### 用户偏好（主数据库）

用户级的偏好设置，量少、结构化，存主数据库。Server 在组装上下文时直接读取，注入到 system prompt。

```
user_preferences {
  id:         uuid PK
  userId:     uuid FK UNIQUE      // 一个用户一条记录
  language:   string?             // 回复语言偏好，如 'zh-CN'
  style:      string?             // 回复风格，如 '简洁' | '详细'
  customRules: text?              // 用户自定义规则（自由文本，如"不要加 emoji"、"代码注释用英文"）
  agentModel:  string?            // Agent 默认模型（如 'claude-sonnet-4-6'），覆盖系统默认
  maxTokens:   integer?           // 单次回复最大 token 数（默认 8192）
  contextWindowTokens: integer?   // 上下文窗口大小（默认 200000），影响整合触发阈值
  temperature: real?              // 温度参数（默认 0.1），控制回复随机性
  reasoningEffort: string?        // 推理强度（'low' | 'medium' | 'high'），支持 extended thinking
  toolConfirmMode: string?        // 工具确认模式（'auto' | 'confirm_dangerous' | 'confirm_all'）
  updatedAt:  timestamp
}
```

用户通过「个人设置 → 偏好」页面管理，也可在对话中通过 Agent 自动更新（如用户说"以后回复用中文"）。

#### 偏好配置项详细说明

**回复行为**

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `language` | string | `null`（跟随用户输入语言） | 回复语言偏好。支持：`zh-CN`（简体中文）、`en`（英文）、`ja`（日文）等。注入 system prompt 时表述为"请使用 {language} 回复"。`null` 时 Agent 自动跟随用户输入语言。 |
| `style` | string | `null`（默认平衡风格） | 回复风格偏好。可选值：`concise`（简洁，省略解释直接给方案）、`detailed`（详细，包含原理和示例）、`tutorial`（教程式，逐步引导新手）。注入 system prompt 引导 Agent 调整详略。 |
| `customRules` | text | `null` | 用户自定义规则，自由文本。直接追加到 system prompt。示例：`"不要加 emoji"` / `"代码注释用英文"` / `"优先使用函数式编程风格"` / `"给出方案前先分析利弊"`。多条规则用换行分隔。 |

**模型参数**

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `agentModel` | string | `null`（使用 Provider 默认模型） | 用户级默认模型。如 `claude-sonnet-4-6`、`claude-opus-4-6`。覆盖系统默认模型，但不覆盖工作区级绑定的模型。优先级：工作区绑定模型 > 用户默认模型 > 系统默认模型。 |
| `maxTokens` | integer | `8192` | 单次 Agent 回复的最大 token 数。较高值允许更长的回复但消耗更多 token。范围：`1024 ~ 32768`。 |
| `contextWindowTokens` | integer | `200000` | Agent 上下文窗口大小（token 数）。影响上下文整合触发阈值（超过 50% 时触发整合）。不同模型上下文窗口不同，Claude Opus/Sonnet 为 200K。范围：`8192 ~ 1000000`。 |
| `temperature` | real | `0.1` | 回复随机性。`0.0` 最确定性（代码生成推荐），`1.0` 最随机（创意写作推荐）。范围：`0.0 ~ 1.0`。 |
| `reasoningEffort` | string | `null`（不启用） | Extended thinking 推理强度。`low`：快速回复，适合简单任务；`medium`：平衡模式；`high`：深度推理，适合复杂架构设计和 debug。启用后 token 消耗会显著增加。 |

**安全与确认**

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `toolConfirmMode` | string | `confirm_dangerous` | 工具执行确认模式。`auto`：所有工具自动执行（高级用户）；`confirm_dangerous`：仅危险操作需确认（如 `git push --force`，由 ToolGuard 判定）；`confirm_all`：所有工具调用都需用户确认（安全优先）。 |

**偏好注入 system prompt 示例**：

```
你是 CCCLaw 的 AI 助手，运行在工作区沙箱中。
遵循三层安全规则：不执行破坏性操作、不泄露敏感信息、不超出工作区范围。

[用户偏好]
- 回复语言：中文
- 回复风格：简洁，省略不必要的解释
- 用户自定义规则：
  不要加 emoji
  代码注释用英文
  优先使用 TypeScript
```

**偏好优先级（由低到高）**：

```
系统默认值 → 用户偏好（user_preferences） → 工作区设置（workspace.settings） → 对话中临时指令
```

### 工作区记忆（workspace.db + 向量检索）

工作区记忆与会话/消息共同存放在工作区的 `workspace.db` 中，跟随工作区一起存储在 Runner 侧。Agent 直接本地读写，不走 API。

**存储位置**：
```
/data/ccclaw/workspaces/{workspace-slug}/internal/workspace.db   # SQLite + WAL
```

> `workspace.db` 位于 `internal/` 系统数据区，包含四张表：`sessions`（会话）、`messages`（消息）、`memories`（记忆）、`todos`（待办任务）。与用户代码分离，不受 git 操作影响，便于独立备份/迁移。

**todos 表结构**：
```
todos {
  id:         text PK (uuid)
  sessionId:  text?              // 关联会话（可选，NULL 表示工作区级 todo）
  content:    text NOT NULL
  status:     text NOT NULL      // 'pending' | 'in_progress' | 'completed'
  createdAt:  text (ISO 8601)
  updatedAt:  text (ISO 8601)
}
```

> Todo 数据并入 workspace.db 而非独立 JSON 文件，避免全量读写的并发问题，与 sessions/messages/memories 统一事务管理。

**memories 表结构**：
```
memories {
  id:         text PK (uuid)
  name:       text UNIQUE
  type:       text               // 'project' | 'reference' | 'decision' | 'feedback' | 'log'
  content:    text
  compressed: boolean DEFAULT false  // 是否已被压缩（压缩后全文仍保留，注入使用压缩版）
  compressedContent: text?           // 压缩后的摘要内容（compressed=true 时注入此字段）
  embedding:  blob?               // 向量嵌入（sqlite-vec）
  updatedAt:  text (ISO 8601)
}
```

**Memory type 含义与加载层级**：

| type | 含义 | 加载层级 | 注入方式 | 更新策略 |
|------|------|---------|---------|---------|
| `decision` | 架构/技术决策（"选 WS 不选 SSE"） | **必注入** | 全文内联 system prompt | 同名覆盖 |
| `feedback` | Agent 行为纠正（"不要 mock 数据库"） | **必注入** | 全文内联 system prompt | 同名覆盖 |
| `project` | 项目知识（"用 Next.js 14 + Drizzle"） | **索引** | name + type 摘要列表 | 同名覆盖 |
| `reference` | 资源指引（"Bug 在 Linear INGEST"） | **索引** | name + type 摘要列表 | 同名覆盖 |
| `log` | 工作日志（"修了 auth token 过期"） | **搜索** | 仅搜索命中时带入 | 每次新建 |

- **必注入层**：decision + feedback 是行为约束，Agent 必须始终遵守，全文注入 system prompt。当总 token 超过 4000 时触发 LLM 压缩合并（原文保留，标记 `compressed: true`，注入 `compressedContent`）
- **索引层**：project + reference 可能积累较多，仅以 XML 摘要列表注入，Agent 需要详情时调用 `memory_read` 按需读取
- **搜索层**：log 高频写入、异步不阻塞对话，不主动注入上下文。仅在向量/关键词搜索命中时带入。适合记录每次会话的关键操作、代码变更摘要、调试过程与结论等

**向量检索**：
- 使用 `sqlite-vec` 扩展，embedding 列存储向量
- 写入记忆时调用 Embedding API 生成向量（可用开源模型如 `bge-small` 本地生成，或对接 Provider 的 embedding 接口，或暂不启用向量检索）
- 上下文组装时：索引层记忆可按向量相似度排序摘要列表（相关度高的排前面），搜索层按 top-K 召回
- **降级策略**：向量检索为可选能力，未配置 embedding 模型时，索引层全量列出摘要，搜索层按时间倒序取最近 N 条

**WAL 模式**：首次打开时执行 `PRAGMA journal_mode=WAL`，支持同一工作区多个 Session 并发读写。

**数据存储分层**：
- 用户偏好 = 这个人是谁、喜欢什么风格 → 主数据库，所有工作区共享
- 工作区数据 = 对话历史 + 项目知识积累 → `workspace.db`，跟随工作区
- 全局统计 = token 用量、审计日志 → 主数据库，跨工作区聚合

### 技能（两级，统一 Tool + Skill）

> **设计原则**：Skill 是 Agent 能力的唯一扩展机制。纯知识/流程指导型 Skill 注入 system prompt，可执行型 Skill（含 `command` 字段）同时注册为 Tool。不再有独立的"自定义 Tool"概念。
>
> **兼容性说明**：`command`、`confirm`、`trust`、`requires` 等扩展字段是**推荐规范，非强制要求**。市场上的 Skill（如 skills.sh 社区）普遍只有 `name`、`description` 等基础字段，可执行逻辑直接写在 prompt 中引导 Agent 调用 bash 工具。这类 Skill 同样有效，但绕过了声明式安全管控链路。详见下方"两条执行路径与安全策略"。

**主数据库 skills 表**（存储用户级 + 工作区级 Skill 元数据）：

```
skills {
  id:         uuid PK
  userId:     uuid FK
  workspaceId:  uuid? FK           // null = 用户级
  name:       string
  description: string
  content:    text               // Markdown 格式（frontmatter + prompt 正文）
  source:     string             // 'builtin' | 'marketplace' | 'user'
  trust:      string?              // 'sandbox' | 'prompt' | 'trusted'（用户可覆盖，仅可执行 Skill）
  always:     boolean DEFAULT false // 是否全文内联 system prompt
  status:     string DEFAULT 'available'  // 'available' | 'unavailable'（依赖检查结果）
  createdAt:  timestamp
  updatedAt:  timestamp
  UNIQUE (userId, workspaceId, name)
}
```

**SKILL.md frontmatter 字段**：

```yaml
---
name: deploy                    # 技能名称
description: 部署项目到指定环境   # 一行描述
# ── 可执行 Skill 专属字段 ──
command: ./deploy.sh            # 有此字段 = 可执行 Skill，注册为 Tool
confirm: true                   # 执行前是否需要用户确认（默认 true）
timeout: 300000                 # 执行超时（毫秒，默认 120000）
workdir: home                   # 执行目录：home（用户代码区）| internal
# ── 通用字段 ──
always: false                   # 是否全文内联 system prompt（默认 false）
trust: prompt                   # 信任级别（系统写入，非作者声明）
requires:
  bins: [aws]                   # 依赖的 CLI 工具
  env: [AWS_PROFILE]            # 依赖的环境变量
  runtime: python>=3.10         # 运行时版本检查（可选）
  deps: requirements.txt        # 依赖声明文件，相对于 Skill 目录（可选）
setup: setup.sh                 # 首次安装脚本（可选）
---
```

**Skill 目录结构**：

Skill 不只是一个 SKILL.md 文件，而是一个**目录**，可以包含脚本、依赖声明、资源文件：

```
skills/{skill-name}/
├── SKILL.md              # 必须：技能描述 + frontmatter
├── scripts/              # 可选：脚本文件目录
│   ├── main.py           # 主脚本（command 指向）
│   ├── utils.py          # 辅助脚本
│   └── ...
├── requirements.txt      # 可选：Python 依赖（deps 字段指向）
├── package.json          # 可选：Node.js 依赖
├── setup.sh              # 可选：首次安装脚本
└── resources/            # 可选：参考资料、模板等
    └── template.md
```

**依赖安装流程**：

```
Skill 加载（Runner 启动 / 用户安装时）
  ↓
requires 检查
  ├── bins:    which <command> 是否存在
  ├── env:     环境变量是否设置
  ├── runtime: <command> --version 版本比对
  └── deps:    依赖声明文件是否存在
  ↓
未安装依赖 → UI 提示用户确认安装
  ↓
执行安装（按 deps 文件类型自动选择）：
  ├── requirements.txt → pip install -r requirements.txt
  ├── package.json     → npm install
  ├── Gemfile          → bundle install
  └── setup.sh         → bash setup.sh（自定义安装逻辑）
  ↓
安装完成 → 标记 installed: true，后续跳过
```

**依赖安装位置**：直接装在沙箱容器内（每个工作区独立 Docker 容器，不影响其他工作区）。依赖缓存到 `internal/skill-cache/` 目录，容器重建时加速重新安装。后续可增强为 venv/node_modules 隔离，防止 Skill 间依赖冲突。

**Skill 分类**：

| | 知识 Skill | 声明式可执行 Skill | 隐式可执行 Skill |
|---|---|---|---|
| 特征 | 无 command，无执行指令 | 有 `command` 字段 | 无 command，但 prompt 含执行指令 |
| 本质 | prompt 注入，教 Agent 怎么做 | CLI 命令包装，注册为 Tool | prompt 引导 Agent 调用 bash tool |
| 加载 | always=true 全文内联，否则 XML 摘要 | 注册到 ToolRegistry | 注入 system prompt |
| 安全管控 | 无需（纯文本） | command → ToolRegistry → trust → ToolGuard | **仅 bash tool 的 ToolGuard 规则** |
| 示例 | TDD 流程、代码审查规范 | deploy.sh、kubectl | skill-creator、市场大部分 Skill |

> 市场上的 Skill（如 skills.sh 社区）普遍采用隐式可执行模式——SKILL.md 里直接写"运行 `python scripts/xxx.py`"，Agent 读到后自行调用 bash tool 执行。这类 Skill 绕过了 command → ToolRegistry → trust 链路，但**无法绕过 bash tool 自身的 ToolGuard 拦截**。

**两条执行路径与安全策略**：

```
路径 A（声明式）：command 字段 → ToolRegistry 注册 → trust 级别控制 → ToolGuard → 沙箱
路径 B（隐式）：  prompt 指令 → Agent 自主调用 bash tool ──────────→ ToolGuard → 沙箱
```

| 路径 | 触发方式 | 安全层级 | 管控粒度 |
|------|---------|---------|---------|
| A. 声明式 | `command` 字段 → ToolRegistry | trust + ToolGuard + 沙箱 | Skill 级别（可针对单个 Skill 设置信任） |
| B. 隐式 | prompt 里写执行指令 → bash tool | ToolGuard + 沙箱 | 命令级别（只能拦截危险命令模式） |

**安全重心**：bash tool 的 ToolGuard 是所有执行的最终出口，不管 Skill 走哪条路径都必须经过。因此 ToolGuard 的命令拦截规则是安全的**底线防御**，必须覆盖所有危险操作模式。

**Skill 安全模型（五层防御）**：

1. **安装时内容扫描**：安装 Skill 时自动扫描 SKILL.md 内容，检测执行指令模式（`bash`、`python`、`sh`、`curl|bash`、`chmod`、`rm` 等），分类标记：

| 检测结果 | 标记 | 安装行为 |
|---------|------|---------|
| 有 `command` 字段 | 声明式可执行 | 展示命令内容，用户确认安装 |
| 无 command 但 prompt 含执行指令 | ⚠️ 隐式可执行 | **警告**：此 Skill 包含未声明的执行指令，展示匹配内容，用户确认 |
| 纯知识型 | 安全 | 直接安装 |

2. **信任级别**（`trust` 字段，仅对声明式可执行 Skill 生效）：

| trust | 含义 | 行为 |
|-------|------|------|
| `sandbox` | 不信任 | 命令在受限子沙箱中执行（无网络、只读 home/） |
| `prompt` | **默认** | 每次执行前弹确认，展示完整命令和参数 |
| `trusted` | 用户手动信任 | 直接执行，不弹确认 |

3. **ToolGuard 运行时拦截**（所有路径的最终防线）：即使 trust=trusted，即使是隐式执行，bash tool 的 ToolGuard 黑名单仍生效（拦截 `rm -rf`、路径越权、密钥泄露等）
4. **Docker 沙箱隔离**：容器级别的文件系统、网络、资源限制兜底
5. **工作区级 bash 策略**（可选增强）：工作区设置中可配置 bash tool 的额外约束（如禁止网络访问、限制可执行路径），对该工作区所有 Skill 生效

**Skill 来源（source 字段）**：

| source | 含义 | 默认 trust |
|--------|------|-----------|
| `builtin` | 系统预置，创建工作区时自动复制 | `trusted` |
| `marketplace` | 从技能市场安装 | `prompt`（有 command）/ `trusted`（无 command） |
| `user` | 用户自行创建 | `prompt`（有 command）/ `trusted`（无 command） |

**可执行 Skill 示例**：

系统 CLI 工具包装（无脚本文件，直接调用系统命令）：
```markdown
---
name: kubectl
description: Kubernetes 集群管理
command: kubectl
confirm: true
requires:
  bins: [kubectl]
  env: [KUBECONFIG]
---

## 用法约束
- 只操作 namespace: dev 和 staging，禁止操作 production
- 查询类操作无需确认，修改/删除类需确认

## 常用操作
- 查看 pod: `kubectl get pods -n <ns>`
- 查看日志: `kubectl logs <pod> -n <ns> --tail=100`
- 重启: `kubectl rollout restart deployment/<name> -n <ns>`

## 禁止操作
- `kubectl delete namespace`
- `kubectl apply` 未经审查的 YAML
```

用户自定义脚本（脚本文件与 SKILL.md 同目录）：
```markdown
---
name: db-backup
description: 备份工作区数据库
command: ./backup.sh
confirm: true
timeout: 600000
requires:
  bins: [pg_dump]
  env: [DATABASE_URL]
---

## 参数
- `target` (string, required): 备份目标，local 或 s3
- `compress` (boolean, optional): 是否压缩，默认 true

## 输出
成功时输出备份文件路径，失败时输出错误日志。
```

复合型 Skill（知识 + 多脚本 + 依赖，如 skill-creator）：
```
skills/skill-creator/
├── SKILL.md                    # 描述如何创建/测试 Skill + 调用脚本的指令
├── scripts/
│   ├── create_skill.py         # 创建 Skill 骨架
│   ├── run_eval.py             # 运行 Skill 评估
│   └── benchmark.py            # 性能基准测试
├── resources/
│   └── skill_template.md       # Skill 模板
├── requirements.txt            # pandas, pyyaml, ...
└── setup.sh                    # pip install -r requirements.txt
```

```markdown
---
name: skill-creator
description: 创建、修改和测试自定义 Skill
command: python scripts/create_skill.py
requires:
  runtime: python>=3.10
  deps: requirements.txt
setup: setup.sh
---

## 概述
本 Skill 帮助你创建、优化和评估自定义 Skill。

## 可用脚本

### 创建 Skill
`python scripts/create_skill.py --name <name> --type <knowledge|executable>`
从模板生成 Skill 骨架目录。

### 运行评估
`python scripts/run_eval.py --skill <path> --cases <n>`
对指定 Skill 运行自动化评估，输出准确率和延迟报告。

### 性能基准
`python scripts/benchmark.py --skill <path> --iterations <n>`
多次运行 Skill 并统计方差，评估稳定性。

## 创建好 Skill 的原则
1. 描述清晰，让 Agent 一读就懂
2. 参数用自然语言描述，包含类型、示例、边界情况
3. 危险操作标记 confirm: true
...
```

> SKILL.md 既是 Agent 的"操作手册"（哪些脚本可用、怎么调用），也是领域知识（怎么写好 Skill）。**command 字段指向默认入口脚本**，但 SKILL.md 中可以描述多个脚本的用法——Agent 根据上下文选择调用 bash 执行不同脚本。

> 可执行 Skill 的参数**不需要 JSON Schema**——LLM 直接阅读 markdown 文档理解参数含义，构造命令行参数。这比结构化 schema 更灵活，也更符合用户写文档的习惯。

**系统预置 Skill**：

系统内置若干通用 Skill，存放在 `packages/server/src/skills/` 目录下。用户创建工作区时，预置 Skill 自动复制到工作区的 `internal/skills/` 目录，作为工作区级 Skill 加载。用户可在工作区中编辑、删除或新增 Skill。

预置 Skill 来源（按目录组织在 `packages/server/src/skills/` 下）：

**find-skills**（技能发现）：
- `find-skills`：浏览和安装社区 Skill，数据源对接 [skills.sh](https://skills.sh/) 技能市场

**skill-creator**（技能开发）：
- `skill-creator`：创建、修改和测试自定义 Skill

**superpowers 系列**（开发工作流增强）：
- `brainstorming`：需求脑暴 → 设计文档
- `writing-plans`：设计文档 → 实现计划
- `executing-plans`：按计划逐步执行
- `subagent-driven-development`：子 Agent 并行开发
- `test-driven-development`：TDD 工作流
- `systematic-debugging`：系统化排查 bug
- `requesting-code-review` / `receiving-code-review`：CR 发起与接收
- `verification-before-completion`：完成前验证检查
- `using-git-worktrees`：Git worktree 隔离开发
- `finishing-a-development-branch`：分支收尾合并
- `dispatching-parallel-agents`：并行任务分发

**anthropic-skills 系列**（文档与工具）：
- `schedule`：定时任务配置
- `pdf` / `docx` / `xlsx` / `pptx`：文档格式读写
- `frontend-design`：前端界面设计与实现

> 预置 Skill 仅在创建工作区时复制一次，后续系统更新预置 Skill 不会覆盖用户已有的工作区 Skill。

### 工作区 Skill 管理（WebUI）

工作区设置页提供 Skill 管理面板，支持查看、配置和信任管理：

**Skill 列表视图**：

| 列 | 说明 |
|----|------|
| 名称 | Skill 名称 + 图标（可执行: ⚡ / 知识: 📖） |
| 描述 | 一行描述 |
| 类型 | `可执行` / `知识` 标签 |
| 来源 | `系统预置` / `市场` / `用户自建` 标签 |
| 状态 | `可用` / `不可用`（缺少依赖时显示原因） |
| 信任 | `沙箱` / `需确认` / `已信任` 下拉切换（仅可执行 Skill 显示） |
| 加载 | `始终加载` / `按需加载` 开关 |
| 操作 | 查看 / 编辑 / 删除 |

**Skill 详情页**：

```
┌─ kubectl ──────────────────────────────────────────────┐
│ 类型: ⚡ 可执行          来源: 用户自建                   │
│ 命令: kubectl            信任: [需确认 ▾]                │
│ 依赖: ✅ kubectl  ✅ KUBECONFIG                         │
│ 超时: 120s               加载: 按需                      │
├────────────────────────────────────────────────────────┤
│ [SKILL.md 内容预览 / 编辑器]                             │
│                                                         │
│ ## 用法约束                                              │
│ - 只操作 namespace: dev 和 staging...                    │
│                                                         │
│ ## 常用操作                                              │
│ - 查看 pod: kubectl get pods -n <ns>                    │
│ ...                                                      │
├────────────────────────────────────────────────────────┤
│ [脚本源码预览]（如有关联脚本文件）                         │
│                                                         │
│ #!/bin/bash                                              │
│ ...                                                      │
└────────────────────────────────────────────────────────┘
```

**操作权限**：
- 系统预置 Skill：可编辑内容和信任级别，可删除（删除后可从预置库重新安装）
- 市场 Skill：可编辑内容和信任级别，可删除，可查看原始市场页面
- 用户自建 Skill：完全控制（创建/编辑/删除）

**批量操作**：
- 全部设为"需确认" / 全部设为"已信任"
- 检查依赖状态（重新扫描 bins/env）
- 导出 Skill（打包为 .zip 分享或备份）

### MCP Server 配置（两级）

```
mcp_servers {
  id:         uuid PK
  userId:     uuid FK
  workspaceId:  uuid? FK           // null = 用户级
  name:       string               // 显示名称
  command:    string               // 启动命令（如 'npx'）
  args:       jsonb                // 命令参数（如 ['-y', '@modelcontextprotocol/server-filesystem']）
  env:        jsonb?               // 环境变量（敏感值 AES-256-GCM 加密）
  enabled:    boolean
  enabledTools: jsonb DEFAULT '["*"]'  // 工具白名单过滤（["*"] 表示全部启用）
  createdAt:  timestamp
  updatedAt:  timestamp
  UNIQUE (userId, workspaceId, name)
}
```

两级同 memory/skill：
- **用户级**（workspaceId=null）：用户配置的通用 MCP Server，跨所有工作区生效
- **工作区级**（workspaceId=X）：特定工作区的 MCP Server，仅该工作区生效

Agent 运行时启动时，合并用户级 + 工作区级 MCP Server 配置（同名工作区级覆盖用户级），通过 stdio 方式启动各 MCP Server 子进程，将获取到的工具注入 Agent 可用工具集。

### 定时任务

```
scheduled_tasks {
  id:         uuid PK
  workspaceId:  uuid FK
  name:       string
  cron:       string
  prompt:     text
  enabled:    boolean
  lastRunAt:  timestamp?
  nextRunAt:  timestamp?
  createdBy:  uuid FK (users.id)
  createdAt:  timestamp
  updatedAt:  timestamp
}

task_runs {
  id:         uuid PK
  taskId:     uuid FK
  sessionId:  uuid FK
  status:     'running' | 'success' | 'failed'
  startedAt:  timestamp
  finishedAt: timestamp?
  error:      text?
}
```

### 审计日志

```
audit_logs {
  id:         uuid PK
  userId:     uuid FK
  action:     string             // 'workspace.create', 'session.message' 等
  target:     string
  detail:     jsonb?
  ip:         string
  createdAt:  timestamp
}
```

### 渠道绑定

```
channels {
  id:         uuid PK
  userId:     uuid FK (users.id) ON DELETE CASCADE
  type:       string               // 'telegram' | 'feishu' | 'wecom'
  config:     jsonb (AES-256-GCM 加密)  // 渠道认证配置（bot token、webhook secret 等）
  enabled:    boolean DEFAULT true
  createdAt:  timestamp
  updatedAt:  timestamp
}
```

### Refresh Token

```
refresh_tokens {
  id:         uuid PK
  userId:     uuid FK (users.id) ON DELETE CASCADE
  token:      string UNIQUE        // refresh token 值（bcrypt hash）
  expiresAt:  timestamp
  createdAt:  timestamp
}
```

> 单用户单设备单 token。刷新时旧 token 删除，插入新 token。

### Token 用量

```
token_usage {
  id:         uuid PK
  userId:     uuid FK (users.id)
  workspaceId:  uuid FK (workspaces.id)
  sessionId:  text                 // 逻辑关联 workspace.db sessions（跨库，不强制 FK）
  providerId: uuid FK (providers.id)
  model:      string               // 'claude-sonnet-4-6' 等
  inputTokens:  integer
  outputTokens: integer
  createdAt:  timestamp
  INDEX (userId, createdAt)
  INDEX (workspaceId, createdAt)
}
```

### 系统设置

```
admin_settings {
  key:        string PK            // 设置键（如 'maxSandboxes', 'defaultProvider'）
  value:      jsonb                // 设置值
  updatedAt:  timestamp
}
```

### 索引与约束

**主数据库索引**：

| 表 | 索引 | 说明 |
|----|------|------|
| users | UNIQUE(email), INDEX(role) | 登录查询、admin 筛选 |
| workspaces | INDEX(createdBy), UNIQUE(slug) | 用户工作区列表 |
| providers | INDEX(userId), PARTIAL UNIQUE(userId) WHERE isDefault=true | 用户 Provider 列表、保证单默认 |
| skills | INDEX(userId, workspaceId) | Skill 列表查询 |
| mcp_servers | INDEX(userId, workspaceId) | MCP 列表查询 |
| scheduled_tasks | INDEX(workspaceId, enabled) | 调度扫描 |
| task_runs | INDEX(taskId, startedAt) | 任务执行历史 |
| audit_logs | INDEX(userId, createdAt), INDEX(action) | 日志查询 |
| token_usage | INDEX(userId, createdAt), INDEX(workspaceId, createdAt) | 统计聚合 |
| refresh_tokens | UNIQUE(token), INDEX(userId) | Token 查找和清理 |

**workspace.db 索引（SQLite）**：

| 表 | 索引 | 说明 |
|----|------|------|
| sessions | INDEX(workspaceId, status), INDEX(userId) | 会话列表、活跃会话 |
| messages | INDEX(sessionId, createdAt) | 消息历史查询 |
| memories | INDEX(type), UNIQUE(name) | 按类型加载、名称去重 |
| todos | INDEX(sessionId) | 会话关联查询 |

**级联删除策略**：

| 父表 | 子表 | 策略 | 说明 |
|------|------|------|------|
| users | workspaces, providers, skills, mcp_servers, refresh_tokens, channels | CASCADE | 删除用户时清理所有关联资源 |
| users | audit_logs, token_usage | SET NULL | 保留审计和统计记录，userId 置空 |
| users | invite_codes.createdBy | SET NULL | 保留邀请码记录 |
| workspaces | skills, mcp_servers, scheduled_tasks | CASCADE | 删除工作区时清理配置 |
| scheduled_tasks | task_runs | CASCADE | 删除任务时清理执行记录 |

> 工作区删除时需额外清理磁盘目录（`home/` + `internal/`），由应用层在事务提交后异步执行。

**workspace.db Schema 版本管理**：

workspace.db 采用内嵌版本号管理迁移：

```sql
-- workspace.db 首次创建时
PRAGMA user_version = 1;

-- 应用启动时检查版本，按需执行迁移
-- version 1: 初始 schema（sessions + messages + memories + todos）
-- version 2: memories 增加 compressed/compressedContent 字段
-- ...
```

Runner 启动时读取 `PRAGMA user_version`，与代码中声明的最新版本对比，依次执行增量迁移 SQL。迁移在事务中执行，失败则回滚并报错。

## 权限模型

### 系统角色

| 角色 | 说明 | 权限 |
|------|------|------|
| admin | 系统管理员 | 用户管理、系统设置、日志查看 |
| user | 普通用户 | 创建和管理自己的工作区、对话、Provider、memory/skill |

### 工作区权限

- 工作区通过 `createdBy` 归属用户，只有创建者可以访问和管理
- 用户之间不共享工作区，无协作功能
- 路由中间件只需验证 `workspace.createdBy === user.id`

### Provider 绑定优先级

```
工作区绑定（settings.providerId）> 用户默认（isDefault=true）
```
