/**
 * ContextAssembler — 7 步分级上下文组装
 *
 * 1. Bootstrap 文件（home/.ccclaw/ 下 AGENTS.md → SOUL.md → USER.md → TOOLS.md）
 * 2. 用户偏好
 * 3. 记忆（分级注入：必注入全文 + 索引摘要）
 * 4. Skills（always 全文 + 其余 XML 摘要）
 * 5-6. 工具 schema（由 ToolRegistry 提供）
 * 7. Session 历史
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WorkspaceDB, Memory } from './workspace-db.js';
import type { ToolRegistry, ToolDefinition } from './tool-registry.js';
import { stripImageContent } from './llm/base.js';
import type { ProviderCapabilities } from './llm/types.js';

// ====== Types ======

export interface AssembledContext {
  systemPrompt: string;
  messages: Array<{ role: string; content: string; tool_calls?: string | null }>;
  tools: ToolDefinition[];
}

/** 用户偏好（从 Server 侧传入） */
export interface UserPreferences {
  agentModel?: string;
  maxTokens?: number;
  temperature?: number;
  reasoningEffort?: string;
  toolConfirmMode?: string;
  customInstructions?: string;
}

/** Server 侧传入的上下文信息 */
export interface ServerContext {
  workspaceId: string;
  workspaceName: string;
  userPreferences: UserPreferences;
}

/** SkillLoader 接口（Task 29 实现，这里定义最小接口） */
export interface ISkillLoader {
  getAlwaysActiveContent(): string;
  getSummaryXML(): string;
}

// ====== Constants ======

const BOOTSTRAP_FILES = ['AGENTS.md', 'SOUL.md', 'USER.md', 'TOOLS.md'];
const BOOTSTRAP_MAX_CHARS = 10_000;

// ====== ContextAssembler ======

export class ContextAssembler {
  constructor(
    private db: WorkspaceDB,
    private skillLoader: ISkillLoader | null,
    private toolRegistry: ToolRegistry,
    private homeDir: string,
  ) {}

  /** 组装完整上下文 */
  assemble(params: {
    sessionId: string;
    serverContext: ServerContext;
    capabilities?: ProviderCapabilities;
  }): AssembledContext {
    const parts: string[] = [];
    const { sessionId, serverContext } = params;

    // Step 1: Bootstrap 文件
    const bootstrap = this.loadBootstrapFiles();
    if (bootstrap) parts.push(bootstrap);

    // Step 2: 用户偏好
    const prefs = this.buildPreferencesPrompt(serverContext.userPreferences);
    if (prefs) parts.push(prefs);

    // Step 3: 记忆（分级注入）
    const memorySection = this.buildMemorySection();
    if (memorySection) parts.push(memorySection);

    // Step 4: Skills
    if (this.skillLoader) {
      const alwaysContent = this.skillLoader.getAlwaysActiveContent();
      if (alwaysContent) parts.push(alwaysContent);
      const summaryXML = this.skillLoader.getSummaryXML();
      if (summaryXML) parts.push(summaryXML);
    }

    // Step 5-6: 工具 schema（由 tools 字段返回）
    const tools = this.toolRegistry.getDefinitions();

    // Step 7: Session 历史
    const session = this.db.getSession(sessionId);
    let messages = this.db.getMessages(sessionId, session?.last_consolidated ?? 0);

    // Vision-aware: strip image content when provider doesn't support vision
    if (params.capabilities?.vision === false) {
      const stripped = stripImageContent(
        messages.map((m) => ({ role: m.role as 'user' | 'assistant' | 'tool', content: m.content })),
      );
      messages = messages.map((m, i) => ({ ...m, content: stripped[i].content as string }));
    }

    return {
      systemPrompt: parts.filter(Boolean).join('\n\n'),
      messages,
      tools,
    };
  }

  /** Step 1: 加载 Bootstrap 文件 */
  private loadBootstrapFiles(): string {
    const parts: string[] = [];
    const bootstrapDir = join(this.homeDir, '.ccclaw');

    for (const file of BOOTSTRAP_FILES) {
      const filePath = join(bootstrapDir, file);
      try {
        let content = readFileSync(filePath, 'utf-8');
        if (content.length > BOOTSTRAP_MAX_CHARS) {
          content = content.slice(0, BOOTSTRAP_MAX_CHARS) + '\n...(truncated)';
        }
        parts.push(`## ${file}\n${content}`);
      } catch {
        // 文件不存在则跳过
      }
    }

    return parts.length > 0 ? parts.join('\n---\n') : '';
  }

  /** Step 2: 构建用户偏好 prompt */
  private buildPreferencesPrompt(prefs: UserPreferences): string {
    const lines: string[] = [];

    if (prefs.customInstructions) {
      lines.push(`## 用户自定义指令\n${prefs.customInstructions}`);
    }

    if (prefs.toolConfirmMode) {
      lines.push(`工具确认模式: ${prefs.toolConfirmMode}`);
    }

    return lines.join('\n');
  }

  /** Step 3: 构建记忆段 */
  private buildMemorySection(): string {
    const tiers = this.db.getMemoriesByTier();
    const parts: string[] = [];

    // A. 必注入：decision + feedback 全文（compressed 时用 compressed_content）
    if (tiers.mustInject.length > 0) {
      const memLines = tiers.mustInject.map((m: Memory) =>
        `### [${m.type}] ${m.name}\n${m.compressed && m.compressed_content ? m.compressed_content : m.content}`,
      );
      parts.push('## 行为约束\n' + memLines.join('\n\n'));
    }

    // B. 索引：project + reference 仅 name + type 摘要
    if (tiers.index.length > 0) {
      const xml = tiers.index.map((m) =>
        `  <memory name="${m.name}" type="${m.type}">${m.summary}</memory>`,
      ).join('\n');
      parts.push(
        `<memories count="${tiers.index.length}">\n${xml}\n  使用 memory_read 工具按名称读取完整内容\n</memories>`,
      );
    }

    return parts.join('\n\n');
  }
}
