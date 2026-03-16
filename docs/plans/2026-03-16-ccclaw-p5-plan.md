# CCCLaw P5 实现计划 — Agent Runtime 增强（v2）

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补齐 Agent Runtime 核心模块，让对话链路从 echo 占位变为真正可用的 AI Agent。

**Architecture:** 改动集中在 `packages/agent-runtime/`（Runner 侧）和 `packages/server/`（Server 侧）。Runner 通过 workspace.db 本地管理会话/记忆/todo，通过 SkillLoader 统一加载知识型和可执行型 Skill，通过 ToolRegistry 管理内置工具 + Skill 工具 + MCP 工具三层。Server 通过 MessageBus 解耦渠道与 AgentManager。

**Tech Stack:** 新增依赖：better-sqlite3（Runner 侧 workspace.db）、@anthropic-ai/sdk（LLM 调用 + MCP client）、gray-matter（SKILL.md frontmatter 解析）

**Spec:** `docs/specs/system-design/2026-03-15-ccclaw-design.md`（十一.5 ~ 十一.12 + Skill 合并 + 记忆分级 + 安全模型）

**Dependencies:** P0-P4 全部完成（20 个 Task 已交付）

**v2 变更（2026-03-16 设计迭代）:**
- todos.json → workspace.db todos 表
- 记忆分级加载（必注入/索引/搜索）+ compressed 字段
- Skill 合并 Tool（command 字段 + trust 安全模型 + 依赖管理）
- 隐式执行检测（五层安全防御）
- 工作区目录分离（home/ + internal/）
- 上下文组装顺序扩展为 7 步

---

## File Structure Overview（P5 新增/修改文件）

```
packages/
├── agent-runtime/src/
│   ├── workspace-db.ts              # 【新建】workspace.db 读写（sessions/messages/memories/todos）
│   ├── context-assembler.ts         # 【新建】上下文组装（7 步分级注入）
│   ├── consolidator.ts              # 【新建】Token 驱动整合 + 记忆压缩
│   ├── tool-registry.ts             # 【新建】工具注册表（内置 + Skill + MCP 三层）
│   ├── skill-loader.ts              # 【新建】Skill 加载（知识/声明式可执行/隐式可执行）
│   ├── mcp-manager.ts               # 【新建】MCP 懒连接 + 超时
│   ├── llm-client.ts                # 【新建】LLM 调用封装（重试/消毒/降级）
│   ├── subagent-manager.ts          # 【新建】子 Agent 隔离执行
│   ├── agent.ts                     # 【重写】对接 ToolRegistry + ContextAssembler + Consolidator
│   ├── index.ts                     # 【修改】启动时初始化新模块，适配 home/internal 目录
│   ├── tools/
│   │   ├── index.ts                 # 【修改】Tool 接口增加 schema 字段，注册新工具
│   │   ├── memory.ts                # 【新建】memory_write / read / search
│   │   ├── todo.ts                  # 【新建】todo_read / todo_write
│   │   └── spawn.ts                 # 【新建】子 Agent 启动工具
│   └── utils/
│       └── token-estimator.ts       # 【新建】Token 估算
├── server/src/
│   ├── bus/                          # 【新建】消息总线
│   │   ├── index.ts                 # MessageBus 实现
│   │   └── events.ts                # InboundMessage / OutboundMessage 类型
│   ├── channel/
│   │   ├── adapter.ts               # 【修改】对接 MessageBus
│   │   └── webui.ts                 # 【修改】通过 Bus 发布/消费
│   ├── core/
│   │   ├── agent-manager.ts         # 【修改】从 Bus 消费 + 使用扩展偏好字段
│   │   ├── workspace-storage.ts     # 【修改】home/ + internal/ 目录分离
│   │   └── heartbeat.ts             # 【新建】Heartbeat 自主唤醒服务
│   ├── api/
│   │   └── preferences.ts           # 【新建】偏好 API
│   ├── db/
│   │   ├── schema.pg.ts             # 【修改】user_preferences 新增字段
│   │   ├── schema.sqlite.ts         # 【修改】同上
│   │   └── schema.mysql.ts          # 【修改】同上
│   └── index.ts                     # 【修改】启动 MessageBus + Heartbeat
└── shared/src/
    └── types.ts                     # 【修改】InboundMessage / OutboundMessage 类型
```

---

## Chunk 1: 基础设施 — workspace.db + 目录分离 + Token 估算

> 最高优先级：让 Runner 能独立管理会话数据，适配新目录结构。

### Task 21: workspace.db 读写模块 + 目录分离

**Files:**
- Create: `packages/agent-runtime/src/workspace-db.ts`
- Modify: `packages/server/src/core/workspace-storage.ts`

- [ ] **Step 1: 更新 workspace-storage.ts 目录结构**

  将 `workspace/` + `skills/` + `workspace.db` 改为 `home/` + `internal/` 分离：

  ```typescript
  export async function initWorkspaceStorage(slug: string, gitRepo?: string | null, gitToken?: string | null) {
    const base = join(config.DATA_DIR, 'workspaces', slug);
    const homeDir = join(base, 'home');
    const internalDir = join(base, 'internal');
    const skillsDir = join(internalDir, 'skills');
    const skillCacheDir = join(internalDir, 'skill-cache');
    await mkdir(homeDir, { recursive: true });
    await mkdir(internalDir, { recursive: true });
    await mkdir(skillsDir, { recursive: true });
    await mkdir(skillCacheDir, { recursive: true });
    await chmod(base, 0o700);
    // ... workspace.db 初始化移到 internalDir
    // ... git clone 移到 homeDir
    // ... 预置 Skill 复制到 skillsDir（保留目录结构，非单文件）
  }
  ```

- [ ] **Step 2: 更新 getWorkspacePaths 和 buildSafeEnv**

  ```typescript
  export function getWorkspacePaths(slug: string) {
    const base = join(config.DATA_DIR, 'workspaces', slug);
    return {
      base,
      home: join(base, 'home'),
      internal: join(base, 'internal'),
      skills: join(base, 'internal', 'skills'),
      wsDb: join(base, 'internal', 'workspace.db'),
    };
  }

  export function buildSafeEnv(workspaceSlug: string): Record<string, string> {
    const paths = getWorkspacePaths(workspaceSlug);
    return {
      NODE_ENV: process.env.NODE_ENV || 'production',
      PATH: process.env.PATH || '',
      HOME: process.env.HOME || '',
      SOCKET_PATH: join(paths.base, 'agent.sock'),
      WORKSPACE_DIR: paths.home,
      INTERNAL_DIR: paths.internal,
      WORKSPACE_DB: paths.wsDb,
      ALLOWED_PATHS: [paths.home, paths.skills].join(':'),
    };
  }
  ```

- [ ] **Step 3: 实现 WorkspaceDB 类**

  ```typescript
  // packages/agent-runtime/src/workspace-db.ts
  import Database from 'better-sqlite3';

  export class WorkspaceDB {
    private db: Database.Database;

    constructor(dbPath: string) {
      this.db = new Database(dbPath);
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('foreign_keys = ON');
      this.initSchema();
    }

    private initSchema() {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          channel_type TEXT NOT NULL DEFAULT 'webui',
          title TEXT NOT NULL DEFAULT '新会话',
          status TEXT NOT NULL DEFAULT 'active',
          summary TEXT,
          last_consolidated INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          tool_calls TEXT,
          tokens INTEGER,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS memories (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          type TEXT NOT NULL CHECK(type IN ('project','reference','decision','feedback','log')),
          content TEXT NOT NULL,
          compressed INTEGER NOT NULL DEFAULT 0,
          compressed_content TEXT,
          embedding BLOB,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS todos (
          id TEXT PRIMARY KEY,
          session_id TEXT,
          content TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','in_progress','completed')),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    }

    // Sessions CRUD
    createSession(session: NewSession): Session { ... }
    getSession(id: string): Session | null { ... }
    updateSession(id: string, updates: Partial<Session>): void { ... }
    listSessions(): Session[] { ... }

    // Messages（Append-Only）
    appendMessage(msg: NewMessage): Message { ... }
    getMessages(sessionId: string, offset?: number): Message[] { ... }  // lastConsolidated 偏移
    countMessages(sessionId: string): number { ... }

    // Memories（分级加载）
    upsertMemory(memory: NewMemory): Memory { ... }  // 同名更新（log 除外）
    getMemory(name: string): Memory | null { ... }
    getMemoriesByTier(): { mustInject: Memory[]; index: Memory[]; search: Memory[] } {
      // decision + feedback → mustInject（全文，优先 compressed_content）
      // project + reference → index（仅 name + type + 首行摘要）
      // log → search（不返回，需用 searchMemories）
    }
    searchMemories(query: string, limit?: number): Memory[] { ... }
    deleteMemory(id: string): void { ... }

    // Todos
    upsertTodo(todo: NewTodo): Todo { ... }
    getTodos(sessionId?: string): Todo[] { ... }
    deleteTodo(id: string): void { ... }

    close(): void { this.db.close(); }
  }
  ```

- [ ] **Step 4: 更新 workspace-storage.ts 的 initWorkspaceStorage 中 workspace.db schema**

  同步 WorkspaceDB 的 schema：新增 `last_consolidated`、`compressed`、`compressed_content`、`todos` 表。

- [ ] **Step 5: 单元测试**

  ```
  - CRUD 基本操作
  - Append-Only 语义（messages 只增不删）
  - lastConsolidated 偏移读取
  - 记忆分级加载（getMemoriesByTier 返回三层）
  - todos CRUD
  - WAL 模式验证
  ```

- [ ] **Step 6: 提交**

---

### Task 22: Token 估算工具

**Files:**
- Create: `packages/agent-runtime/src/utils/token-estimator.ts`

- [ ] **Step 1: 实现 estimateTokens 函数**

  ```typescript
  /** 估算文本 token 数（1 token ≈ 4 chars 英文，1 token ≈ 2 chars 中文） */
  export function estimateTokens(text: string): number {
    let count = 0;
    for (const char of text) {
      count += char.charCodeAt(0) > 0x7F ? 0.5 : 0.25;  // 中文 0.5 char/token, 英文 0.25
    }
    return Math.ceil(count);
  }

  /** 估算消息数组的 token 数（含 role 标记开销） */
  export function estimateMessagesTokens(messages: Array<{ role: string; content: string }>): number {
    let total = 0;
    for (const msg of messages) {
      total += estimateTokens(msg.content) + 4; // 4 tokens per message overhead
    }
    return total;
  }

  /** 估算完整 prompt 的 token 数 */
  export function estimateSessionTokens(
    systemPrompt: string,
    memories: string[],
    messages: Array<{ role: string; content: string }>,
  ): number {
    return estimateTokens(systemPrompt)
      + memories.reduce((sum, m) => sum + estimateTokens(m), 0)
      + estimateMessagesTokens(messages);
  }
  ```

- [ ] **Step 2: 单元测试**

  测试纯英文、纯中文、混合文本的估算精度。

- [ ] **Step 3: 提交**

---

## Chunk 2: ToolRegistry + 内置工具补全

> 统一工具管理，补齐 memory/todo/spawn 工具。

### Task 25: ToolRegistry 工具注册表

**Files:**
- Create: `packages/agent-runtime/src/tool-registry.ts`
- Modify: `packages/agent-runtime/src/tools/index.ts`

- [ ] **Step 1: 扩展 Tool 接口，增加 schema 字段**

  ```typescript
  // packages/agent-runtime/src/tools/index.ts
  export interface ToolSchema {
    type: 'object';
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required?: string[];
  }

  export interface Tool {
    name: string;
    description: string;
    schema?: ToolSchema;          // 内置工具用 JSON Schema，可执行 Skill 无 schema
    execute(input: Record<string, unknown>): Promise<string>;
  }
  ```

- [ ] **Step 2: 实现 ToolRegistry**

  ```typescript
  // packages/agent-runtime/src/tool-registry.ts
  const MAX_TOOL_RESULT_CHARS = 16_000;

  export class ToolRegistry {
    private tools = new Map<string, Tool>();

    register(tool: Tool): void { ... }
    registerMCP(serverName: string, tools: MCPTool[]): void { ... }
    unregister(name: string): void { ... }
    getDefinitions(): ToolDefinition[] { ... }

    async execute(name: string, params: Record<string, unknown>): Promise<string> {
      const tool = this.tools.get(name);
      if (!tool) return `Error: Unknown tool "${name}"\n\nAvailable tools: ${[...this.tools.keys()].join(', ')}`;
      try {
        const casted = tool.schema ? castParams(params, tool.schema) : params;
        let result = await tool.execute(casted);
        if (result.length > MAX_TOOL_RESULT_CHARS) {
          result = result.slice(0, MAX_TOOL_RESULT_CHARS) + '\n...(truncated)';
        }
        return result;
      } catch (err: any) {
        return `Error: ${err.message}\n\nAnalyze the error above and try a different approach.`;
      }
    }
  }
  ```

- [ ] **Step 3: castParams 实现**

  支持 string→number、string→boolean、递归处理 object/array。

- [ ] **Step 4: 注册现有 6 个内置工具到 ToolRegistry**

  为 bash/file/git/glob/grep/web-fetch 补充 schema 字段。

- [ ] **Step 5: 单元测试**

  测试注册/注销、类型修正、结果截断、错误提示、未知工具。

- [ ] **Step 6: 提交**

---

### Task 26: Memory 工具（分级加载）

**Files:**
- Create: `packages/agent-runtime/src/tools/memory.ts`
- Modify: `packages/agent-runtime/src/tools/index.ts`

- [ ] **Step 1: 实现 memory_write / memory_read / memory_search**

  ```typescript
  export function createMemoryTools(db: WorkspaceDB): Tool[] {
    return [
      {
        name: 'memory_write',
        description: '写入工作区记忆...',
        schema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '记忆名称（同名覆盖，log 类型除外）' },
            type: { type: 'string', description: '类型', enum: ['project','reference','decision','feedback','log'] },
            content: { type: 'string', description: '记忆内容' },
          },
          required: ['name', 'type', 'content'],
        },
        async execute(input) {
          const { name, type, content } = input as { name: string; type: string; content: string };
          db.upsertMemory({ name, type, content });
          return `Memory "${name}" (${type}) saved.`;
        },
      },
      {
        name: 'memory_read',
        description: '按名称读取记忆，或不传 name 返回索引列表',
        schema: { ... },
        async execute(input) {
          const { name } = input as { name?: string };
          if (name) {
            const mem = db.getMemory(name);
            return mem ? `[${mem.type}] ${mem.name}\n${mem.content}` : `Memory "${name}" not found.`;
          }
          // 返回分级索引
          const tiers = db.getMemoriesByTier();
          const lines: string[] = [];
          lines.push('## 行为约束（decision + feedback）');
          for (const m of tiers.mustInject) lines.push(`- [${m.type}] ${m.name}`);
          lines.push('## 工作区知识（project + reference，使用 memory_read 读取详情）');
          for (const m of tiers.index) lines.push(`- [${m.type}] ${m.name}: ${m.content.slice(0, 80)}...`);
          lines.push(`## 日志（共 ${tiers.search.length} 条，使用 memory_search 搜索）`);
          return lines.join('\n');
        },
      },
      {
        name: 'memory_search',
        description: '搜索记忆（关键词匹配）',
        schema: { ... },
        async execute(input) {
          const { query, limit } = input as { query: string; limit?: number };
          const results = db.searchMemories(query, limit ?? 5);
          return results.map(m => `[${m.type}] ${m.name}\n${m.content}`).join('\n---\n');
        },
      },
    ];
  }
  ```

- [ ] **Step 2: 注册到 ToolRegistry + 单元测试**

- [ ] **Step 3: 提交**

---

### Task 27: Todo 工具

**Files:**
- Create: `packages/agent-runtime/src/tools/todo.ts`
- Modify: `packages/agent-runtime/src/tools/index.ts`

- [ ] **Step 1: 实现 todo_read / todo_write**

  ```typescript
  export function createTodoTools(db: WorkspaceDB): Tool[] {
    return [
      {
        name: 'todo_write',
        description: '更新待办任务列表（全量替换）',
        schema: { ... },
        async execute(input) {
          const { todos } = input as { todos: Array<{ content: string; status: string }> };
          // 全量替换当前 session 的 todos
          ...
        },
      },
      {
        name: 'todo_read',
        description: '读取当前待办任务列表',
        schema: { ... },
        async execute() {
          const todos = db.getTodos();
          return todos.map(t => `[${t.status}] ${t.content}`).join('\n') || '(empty)';
        },
      },
    ];
  }
  ```

- [ ] **Step 2: 注册到 ToolRegistry + 单元测试**

- [ ] **Step 3: 提交**

---

## Chunk 3: 上下文组装 + 整合

> 核心：将 7 步分级组装和 Token 驱动整合串联起来。

### Task 23: ContextAssembler 上下文组装

**Files:**
- Create: `packages/agent-runtime/src/context-assembler.ts`

- [ ] **Step 1: 实现 ContextAssembler**

  ```typescript
  interface AssembledContext {
    systemPrompt: string;
    messages: Array<{ role: string; content: string }>;
    tools: ToolDefinition[];
  }

  export class ContextAssembler {
    constructor(
      private db: WorkspaceDB,
      private skillLoader: SkillLoader,
      private toolRegistry: ToolRegistry,
      private homeDir: string,
    ) {}

    async assemble(params: {
      sessionId: string;
      userPreferences: UserPreferences;
      serverContext: ServerContext;  // skills, mcpServers from Server
    }): Promise<AssembledContext> {
      const parts: string[] = [];

      // 1. Bootstrap 文件（home/ 目录下 AGENTS.md → SOUL.md → USER.md → TOOLS.md）
      parts.push(this.loadBootstrapFiles());

      // 2. 用户偏好 → system prompt
      parts.push(this.buildPreferencesPrompt(params.userPreferences));

      // 3. 记忆（分级注入）
      const tiers = this.db.getMemoriesByTier();
      // A. 必注入：decision + feedback 全文（compressed 时用 compressed_content）
      if (tiers.mustInject.length > 0) {
        parts.push('## 行为约束\n' + tiers.mustInject.map(m =>
          `[${m.type}] ${m.compressed ? m.compressedContent : m.content}`
        ).join('\n'));
      }
      // B. 索引：project + reference 仅 name + type 摘要
      if (tiers.index.length > 0) {
        const xml = tiers.index.map(m =>
          `  <memory name="${m.name}" type="${m.type}">${m.content.slice(0, 100)}</memory>`
        ).join('\n');
        parts.push(`<memories count="${tiers.index.length}">\n${xml}\n  使用 memory_read 工具按名称读取完整内容\n</memories>`);
      }

      // 4. Skills（渐进加载：always 全文 + 其余 XML 摘要）
      parts.push(this.skillLoader.getAlwaysActiveContent());
      parts.push(this.skillLoader.getSummaryXML());

      // 5-6. 工具 schema 由 toolRegistry.getDefinitions() 提供
      const tools = this.toolRegistry.getDefinitions();

      // 7. session 历史
      const session = this.db.getSession(params.sessionId);
      const messages = this.db.getMessages(params.sessionId, session?.lastConsolidated ?? 0);

      return { systemPrompt: parts.filter(Boolean).join('\n\n'), messages, tools };
    }

    private loadBootstrapFiles(): string {
      const files = ['AGENTS.md', 'SOUL.md', 'USER.md', 'TOOLS.md'];
      const parts: string[] = [];
      for (const file of files) {
        const path = join(this.homeDir, file);
        try {
          const content = readFileSync(path, 'utf-8');
          parts.push(`## ${file}\n${content}`);
        } catch { /* 不存在则跳过 */ }
      }
      return parts.join('\n---\n');
    }
  }
  ```

- [ ] **Step 2: 单元测试**

  测试分级注入（必注入/索引/搜索）、Bootstrap 加载、空数据处理。

- [ ] **Step 3: 提交**

---

### Task 24: Consolidator Token 驱动整合

**Files:**
- Create: `packages/agent-runtime/src/consolidator.ts`

- [ ] **Step 1: 实现 Consolidator**

  ```typescript
  export class Consolidator {
    constructor(
      private db: WorkspaceDB,
      private contextWindowTokens: number,  // 默认 200000
      private callLLM: (params: LLMCallParams) => Promise<LLMResponse>,
    ) {}

    async consolidateIfNeeded(sessionId: string): Promise<void> {
      const session = this.db.getSession(sessionId);
      if (!session) return;

      const messages = this.db.getMessages(sessionId, session.lastConsolidated);
      const estimated = estimateMessagesTokens(messages);
      const threshold = this.contextWindowTokens * 0.5;

      if (estimated <= threshold) return;

      const boundary = this.pickBoundary(messages, estimated - threshold * 0.6);
      const chunk = messages.slice(0, boundary);
      const success = await this.consolidateChunk(chunk);
      if (success) {
        this.db.updateSession(sessionId, {
          lastConsolidated: session.lastConsolidated + boundary,
        });
      }
    }

    private pickBoundary(messages: Message[], tokensToRemove: number): number {
      // 从头累加 token 直到超过 tokensToRemove，前移到最近的 user 消息起点
      ...
    }

    private async consolidateChunk(chunk: Message[]): Promise<boolean> {
      // 三级降级：
      // 1. forced tool_choice → save_memory
      // 2. auto tool_choice
      // 3. 原始归档（直接写入 log 记忆）
      ...
    }
  }
  ```

- [ ] **Step 2: 记忆压缩**

  当 decision + feedback 总 token 超过 4000 时：
  - 调用 LLM 合并压缩
  - 写入 `compressed_content`，标记 `compressed: true`

- [ ] **Step 3: 边界查找算法 + 单元测试**

- [ ] **Step 4: 提交**

---

## Chunk 4: Skill 加载 + MCP 管理

> Skill 体系统一化：知识型 / 声明式可执行 / 隐式可执行。

### Task 29: Skill Loader

**Files:**
- Create: `packages/agent-runtime/src/skill-loader.ts`

- [ ] **Step 1: 实现 SkillLoader 核心**

  ```typescript
  import matter from 'gray-matter';

  interface SkillMeta {
    name: string;
    description: string;
    command?: string;        // 有 = 可执行 Skill
    confirm?: boolean;       // 默认 true
    timeout?: number;        // 默认 120000
    workdir?: 'home' | 'internal';
    always?: boolean;        // 默认 false
    trust?: 'sandbox' | 'prompt' | 'trusted';  // 默认 prompt
    requires?: {
      bins?: string[];
      env?: string[];
      runtime?: string;      // e.g. "python>=3.10"
      deps?: string;         // e.g. "requirements.txt"
    };
    setup?: string;          // 首次安装脚本
  }

  type SkillType = 'knowledge' | 'executable_declared' | 'executable_implicit';

  interface LoadedSkill {
    meta: SkillMeta;
    type: SkillType;
    content: string;         // SKILL.md 全文
    dir: string;             // Skill 目录路径
    available: boolean;      // requires 检查结果
    missingReason?: string;  // 不可用原因
  }

  export class SkillLoader {
    constructor(
      private skillsDirs: string[],
      private toolRegistry: ToolRegistry,
      private homeDir: string,
    ) {}

    loadAll(): LoadedSkill[] { ... }
    getAlwaysActiveContent(): string { ... }
    getSummaryXML(): string { ... }
    registerExecutableSkills(): void { ... }
  }
  ```

- [ ] **Step 2: Skill 分类逻辑**

  ```typescript
  private classifySkill(meta: SkillMeta, content: string): SkillType {
    if (meta.command) return 'executable_declared';
    // 隐式执行检测：扫描 content 中的执行指令模式
    const execPatterns = [
      /```(?:bash|sh|shell|python|node)\b/i,
      /\bpython\s+scripts?\//i,
      /\bbash\s+-c\b/i,
      /\bcurl\s+.*\|\s*(?:bash|sh)\b/i,
      /\bnpm\s+(?:run|exec)\b/i,
    ];
    if (execPatterns.some(p => p.test(content))) return 'executable_implicit';
    return 'knowledge';
  }
  ```

- [ ] **Step 3: requires 检查**

  ```typescript
  private checkRequires(requires: SkillMeta['requires'], skillDir: string): { ok: boolean; reason?: string } {
    if (!requires) return { ok: true };
    // bins: which <command>
    // env: process.env[key]
    // runtime: 解析 "python>=3.10"，执行 python3 --version 比较
    // deps: 检查文件是否存在
    ...
  }
  ```

- [ ] **Step 4: 可执行 Skill 注册到 ToolRegistry**

  ```typescript
  registerExecutableSkills(): void {
    for (const skill of this.skills) {
      if (skill.type !== 'executable_declared' || !skill.available) continue;
      this.toolRegistry.register({
        name: `skill_${skill.meta.name}`,
        description: skill.content,  // SKILL.md 全文作为 description
        // 无 schema — LLM 从 markdown 理解参数
        async execute(input) {
          const args = (input as any).args || '';
          const cwd = skill.meta.workdir === 'internal' ? internalDir : homeDir;
          // trust 级别检查
          // confirm=true 时需要发送 confirm_request
          const result = execSync(`${skill.meta.command} ${args}`, {
            cwd,
            timeout: skill.meta.timeout ?? 120_000,
            encoding: 'utf-8',
          });
          return result;
        },
      });
    }
  }
  ```

- [ ] **Step 5: 单元测试**

  测试三种 Skill 分类、requires 检查（bins/env/runtime）、可执行 Skill 注册。

- [ ] **Step 6: 提交**

---

### Task 30: MCP Manager 懒连接 + 超时

**Files:**
- Create: `packages/agent-runtime/src/mcp-manager.ts`

- [ ] **Step 1: 实现 MCPManager**

  ```typescript
  export class MCPManager {
    constructor(
      private servers: MCPServerConfig[],
      private toolRegistry: ToolRegistry,
    ) {}

    async ensureConnected(): Promise<void> { ... }  // 幂等懒连接
    async disconnect(): Promise<void> { ... }
  }
  ```

  关键特性：
  - 首次消息时才连接（`ensureConnected()` 幂等）
  - 支持 stdio / SSE / streamable-http 三种传输
  - 工具命名：`mcp_{serverName}_{toolName}`
  - `enabledTools` 白名单过滤
  - 每次工具调用独立 30s 超时

- [ ] **Step 2: MCPToolWrapper — 将 MCP 工具包装为 ToolRegistry 兼容 Tool**

- [ ] **Step 3: 单元测试（mock MCP Server）**

- [ ] **Step 4: 提交**

---

## Chunk 5: Agent Loop 重构 + LLM 容错

> 将所有模块串联：echo agent → 真实 Agent Loop。

### Task 28: Agent Loop 重构

**Files:**
- Rewrite: `packages/agent-runtime/src/agent.ts`
- Modify: `packages/agent-runtime/src/index.ts`

- [ ] **Step 1: 重写 agent.ts — 实现真实 Agent Loop**

  ```typescript
  export async function runAgent(
    request: AgentRequest,
    onStream: StreamCallback,
    deps: {
      db: WorkspaceDB;
      assembler: ContextAssembler;
      toolRegistry: ToolRegistry;
      consolidator: Consolidator;
      llmClient: LLMClient;
      maxIterations: number;
    },
  ): Promise<void> {
    const { sessionId, message, context } = request.params;

    // 1. 追加用户消息到 workspace.db
    deps.db.appendMessage({ sessionId, role: 'user', content: message });

    // 2. 组装上下文
    const ctx = await deps.assembler.assemble({
      sessionId,
      userPreferences: context.userPreferences,
      serverContext: context,
    });

    // 3. Agent 迭代循环
    let iteration = 0;
    const messages = [...ctx.messages];
    while (iteration < deps.maxIterations) {
      iteration++;
      const response = await deps.llmClient.call({
        systemPrompt: ctx.systemPrompt,
        messages,
        tools: ctx.tools,
      });

      // 流式输出文本
      if (response.content) {
        onStream({ type: 'text_delta', text: response.content });
        deps.db.appendMessage({ sessionId, role: 'assistant', content: response.content });
      }

      // 工具调用
      if (response.toolCalls?.length) {
        for (const call of response.toolCalls) {
          onStream({ type: 'tool_use', name: call.name, input: call.params });
          const result = await deps.toolRegistry.execute(call.name, call.params);
          onStream({ type: 'tool_result', name: call.name, output: result });
          deps.db.appendMessage({ sessionId, role: 'tool', content: result, toolCalls: JSON.stringify(call) });
          messages.push({ role: 'assistant', content: '', toolCalls: [call] });
          messages.push({ role: 'tool', content: result });
        }
      } else {
        break;  // 无工具调用 = 对话结束
      }
    }

    // 4. 整合检查
    await deps.consolidator.consolidateIfNeeded(sessionId);

    onStream({ type: 'done', usage: { inputTokens: 0, outputTokens: 0 } });
  }
  ```

- [ ] **Step 2: 更新 Runner 入口 index.ts**

  启动时初始化所有模块：
  ```typescript
  const WORKSPACE_DIR = process.env.WORKSPACE_DIR || '/home/agent';
  const INTERNAL_DIR = process.env.INTERNAL_DIR || '/internal';
  const WORKSPACE_DB = process.env.WORKSPACE_DB || join(INTERNAL_DIR, 'workspace.db');

  // 初始化
  const db = new WorkspaceDB(WORKSPACE_DB);
  const toolRegistry = new ToolRegistry();
  const skillLoader = new SkillLoader([join(INTERNAL_DIR, 'skills')], toolRegistry, WORKSPACE_DIR);
  const assembler = new ContextAssembler(db, skillLoader, toolRegistry, WORKSPACE_DIR);
  const consolidator = new Consolidator(db, 200_000, llmClient.call);

  // 注册内置工具
  toolRegistry.register(bashTool);
  toolRegistry.register(fileTool);
  // ... 其他内置工具
  for (const tool of createMemoryTools(db)) toolRegistry.register(tool);
  for (const tool of createTodoTools(db)) toolRegistry.register(tool);

  // 加载 Skill 并注册可执行 Skill
  skillLoader.loadAll();
  skillLoader.registerExecutableSkills();
  ```

- [ ] **Step 3: 集成测试 — echo agent 替换为真实 Agent Loop**

- [ ] **Step 4: 提交**

---

### Task 33: LLM 调用容错增强

**Files:**
- Create: `packages/agent-runtime/src/llm-client.ts`
- Modify: `packages/agent-runtime/src/agent.ts`

- [ ] **Step 1: 实现 LLMClient + callWithRetry**

  指数退避重试（1s → 2s → 4s），瞬态错误检测（429/5xx/timeout/connection），非瞬态直接抛出。

  ```typescript
  export class LLMClient {
    constructor(private apiKey: string, private apiBase?: string) {}

    async call(params: LLMCallParams): Promise<LLMResponse> {
      return callWithRetry(() => this.rawCall(params));
    }
  }

  const RETRY_DELAYS = [1000, 2000, 4000];
  async function callWithRetry<T>(fn: () => Promise<T>): Promise<T> { ... }
  function isTransientError(err: unknown): boolean { ... }
  ```

- [ ] **Step 2: 空内容消毒 sanitizeEmptyContent**

- [ ] **Step 3: 图片降级**

- [ ] **Step 4: 消息历史清洁**

- [ ] **Step 5: 单元测试**

- [ ] **Step 6: 提交**

---

## Chunk 6: 消息总线 + 渠道重构

### Task 31: MessageBus 实现

**Files:**
- Create: `packages/server/src/bus/events.ts`
- Create: `packages/server/src/bus/index.ts`
- Modify: `packages/shared/src/types.ts`

- [ ] **Step 1: 定义 InboundMessage / OutboundMessage 类型**

- [ ] **Step 2: 实现 MessageBus**

  基于 EventEmitter，支持 publishInbound / publishOutbound / onInbound / onOutbound。

- [ ] **Step 3: 单元测试**

- [ ] **Step 4: 提交**

---

### Task 32: 渠道适配器重构

**Files:**
- Modify: `packages/server/src/channel/adapter.ts`
- Modify: `packages/server/src/channel/webui.ts`
- Modify: `packages/server/src/core/agent-manager.ts`
- Modify: `packages/server/src/index.ts`

- [ ] **Step 1: WebUI Channel 改为通过 MessageBus 通信**

- [ ] **Step 2: AgentManager 改为从 MessageBus 消费**

- [ ] **Step 3: 验证现有 WebUI 对话流程不受影响**

- [ ] **Step 4: 提交**

---

## Chunk 7: Bootstrap + 偏好 API + Skill 增强

### Task 35: Bootstrap 文件加载

**Files:**
- Modify: `packages/agent-runtime/src/context-assembler.ts`

> 已在 Task 23 的 ContextAssembler 中实现 loadBootstrapFiles()。此 Task 仅补充测试和边界处理。

- [ ] **Step 1: 补充 Bootstrap 文件边界处理**

  - 文件编码统一 UTF-8，超过 10,000 chars 截断并标记
  - 文件名不匹配大小写的处理

- [ ] **Step 2: 单元测试（mock home/ 目录）**

- [ ] **Step 3: 提交**

---

### Task 36: 用户偏好 API + schema 扩展

**Files:**
- Create: `packages/server/src/api/preferences.ts`
- Modify: `packages/server/src/api/index.ts`
- Modify: `packages/shared/src/schemas.ts`
- Modify: `packages/server/src/db/schema.pg.ts`
- Modify: `packages/server/src/db/schema.sqlite.ts`
- Modify: `packages/server/src/db/schema.mysql.ts`

- [ ] **Step 1: 数据库 schema 更新**

  user_preferences 表新增字段：`agentModel`, `maxTokens`, `contextWindowTokens`, `temperature`, `reasoningEffort`, `toolConfirmMode`。生成迁移。

- [ ] **Step 2: 实现偏好 API**

  ```
  GET    /api/settings/preferences     读取当前用户偏好
  PUT    /api/settings/preferences     更新偏好（Zod 校验）
  ```

- [ ] **Step 3: AgentManager.buildSystemPrompt 增强**

  使用完整偏好字段构建 system prompt，传递 model/temperature/maxTokens 给 Runner。

- [ ] **Step 4: 单元测试**

- [ ] **Step 5: 提交**

---

### Task 34: Skill Loader 增强 — 依赖安装 + 安全扫描

**Files:**
- Modify: `packages/agent-runtime/src/skill-loader.ts`

> 在 Task 29 基础上增强。

- [ ] **Step 1: 依赖安装流程**

  ```typescript
  async installDeps(skill: LoadedSkill): Promise<void> {
    if (!skill.meta.requires?.deps) return;
    const depsFile = join(skill.dir, skill.meta.requires.deps);
    if (skill.meta.setup) {
      // 自定义安装脚本
      execSync(`bash ${join(skill.dir, skill.meta.setup)}`, { cwd: skill.dir });
    } else {
      // 按文件类型自动选择
      if (depsFile.endsWith('requirements.txt')) execSync(`pip install -r ${depsFile}`);
      else if (depsFile.endsWith('package.json')) execSync('npm install', { cwd: skill.dir });
    }
  }
  ```

- [ ] **Step 2: runtime 版本检查**

  解析 `python>=3.10` → 执行 `python3 --version` → 比较语义版本。

- [ ] **Step 3: 隐式执行安全扫描增强**

  除 Step 2 of Task 29 的基础模式匹配外，增加：
  - 检测 `chmod +x`、`curl ... | bash`、`eval`、`exec` 等高危模式
  - 检测 prompt injection 特征（如 `ignore previous instructions`）
  - 返回安全扫描报告（用于 UI 安装审查展示）

- [ ] **Step 4: 单元测试**

- [ ] **Step 5: 提交**

---

## Chunk 8: 子 Agent + Heartbeat

### Task 37: SubagentManager

**Files:**
- Create: `packages/agent-runtime/src/subagent-manager.ts`
- Create: `packages/agent-runtime/src/tools/spawn.ts`
- Modify: `packages/agent-runtime/src/tools/index.ts`

- [ ] **Step 1: 实现 SubagentManager**

  - `spawn(task, label)` — 创建独立子 Agent
  - 子 Agent 使用独立 ToolRegistry（禁用 spawn，防递归）
  - 迭代限制 15 轮
  - 同一 Session 最多 3 个并发子 Agent

- [ ] **Step 2: spawn 工具**

- [ ] **Step 3: 单元测试**

- [ ] **Step 4: 提交**

---

### Task 38: Heartbeat 自主唤醒服务

**Files:**
- Create: `packages/server/src/core/heartbeat.ts`
- Modify: `packages/server/src/index.ts`

- [ ] **Step 1: 实现 HeartbeatService**

  1. 扫描启用了 heartbeat 的工作区
  2. 读取 HEARTBEAT.md
  3. 通过 RunnerManager 发送决策请求
  4. LLM 判断 skip/run
  5. run 时创建临时 Session 执行 Agent Loop

- [ ] **Step 2: 集成到 Server 启动流程**

- [ ] **Step 3: 单元测试**

- [ ] **Step 4: 提交**

---

## Chunk 9: 集成验证

### Task 39: 全链路集成验证

- [ ] **Step 1: typecheck 四个包全量通过**

- [ ] **Step 2: 运行全部单元测试**

- [ ] **Step 3: 手动集成测试**

  - 启动 dev 环境（`make dev`）
  - 创建工作区 → 验证 `home/` + `internal/` 目录结构
  - 发起对话 → 验证 Agent 真实 LLM 调用（非 echo）
  - 验证工具调用（bash/file/memory/todo）
  - 验证记忆分级注入（decision 全文 + project 索引）
  - 验证上下文整合（大量消息后 lastConsolidated 前进）
  - 放入 SKILL.md（含 command）→ 验证可执行 Skill 注册和调用
  - 放入 AGENTS.md → 验证 Bootstrap 加载
  - 配置 MCP Server → 验证懒连接和工具注入

- [ ] **Step 4: 更新 progress.md**

---

## Task 依赖关系

```
组 1（独立基础）:
  Task 21 (workspace-db + 目录分离)
  Task 22 (token-estimator)
  Task 25 (tool-registry)
  Task 36 (偏好 API)
      ↓
组 2（依赖组 1）:
  Task 26 (memory tools) ← 21 + 25
  Task 27 (todo tools)   ← 21 + 25
  Task 23 (context-assembler) ← 21 + 22
  Task 24 (consolidator) ← 21 + 22
      ↓
组 3（独立模块）:
  Task 29 (skill-loader) ← 25
  Task 30 (mcp-manager)  ← 25
  Task 31 (message-bus)
  Task 33 (LLM client)
      ↓
组 4（集成）:
  Task 28 (agent loop 重构) ← 23 + 24 + 25 + 26 + 27 + 29 + 30 + 33
  Task 32 (渠道重构) ← 31
  Task 34 (skill 增强) ← 29
  Task 35 (bootstrap) ← 23
      ↓
组 5（高级功能）:
  Task 37 (subagent) ← 28
  Task 38 (heartbeat) ← 28
      ↓
组 6（验证）:
  Task 39 (全链路集成)
```

## 并行策略

| 并行组 | Tasks | 说明 |
|--------|-------|------|
| 组 1 | 21 + 22 + 25 + 36 | workspace-db / token-estimator / tool-registry / 偏好 API 互相独立 |
| 组 2 | 23 + 24 + 26 + 27 | 依赖组 1，但彼此独立 |
| 组 3 | 29 + 30 + 31 + 33 | skill-loader / mcp-manager / message-bus / LLM client 互相独立 |
| 组 4 | 28 + 32 + 34 + 35 | agent loop 集成 + 渠道重构 + skill 增强 + bootstrap |
| 组 5 | 37 + 38 | subagent + heartbeat |
| 最后 | 39 | 全量集成验证 |
