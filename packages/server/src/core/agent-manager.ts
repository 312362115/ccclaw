import { db, schema } from '../db/index.js';
import { eq, and, isNull, or } from 'drizzle-orm';
import { decrypt } from '@ccclaw/shared';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { runnerManager } from './runner-manager.js';
import type { AgentRequest, AgentResponse, RuntimeConfig } from './runner-manager.js';
import { messageBus } from '../bus/instance.js';
import type { InboundMessage, OutboundMessage } from '../bus/index.js';
import { OAuthTokenManager } from './oauth-token-manager.js';

interface StreamCallback {
  onDelta: (msg: AgentResponse) => void;
  onDone: (msg: AgentResponse) => void;
  onError: (msg: AgentResponse) => void;
}

export class AgentManager {
  /**
   * 组装上下文：userPreferences + skills + mcpServers + systemPrompt
   * 注意：history 和 memories 由 Runner 从 workspace.db 本地加载，不在此组装
   */
  async assembleContext(workspaceId: string, userId: string) {
    // 1. 加载用户偏好（主数据库）
    const [prefs] = await db.select().from(schema.userPreferences)
      .where(eq(schema.userPreferences.userId, userId)).limit(1);

    // 2. 加载技能（用户级 + 工作区级，工作区级同名覆盖用户级）
    const skills = await db.select().from(schema.skills).where(
      and(
        eq(schema.skills.userId, userId),
        or(
          isNull(schema.skills.workspaceId),
          eq(schema.skills.workspaceId, workspaceId),
        ),
      ),
    );

    // 3. 加载 MCP Server 配置（用户级 + 工作区级，工作区级同名覆盖用户级）
    const mcpServers = await db.select().from(schema.mcpServers).where(
      and(
        eq(schema.mcpServers.userId, userId),
        eq(schema.mcpServers.enabled, true),
        or(
          isNull(schema.mcpServers.workspaceId),
          eq(schema.mcpServers.workspaceId, workspaceId),
        ),
      ),
    );

    // 合并 MCP Server（工作区级同名覆盖用户级）
    const mcpMap = new Map<string, typeof mcpServers[0]>();
    for (const mcp of mcpServers) {
      if (!mcp.workspaceId) mcpMap.set(mcp.name, mcp);
    }
    for (const mcp of mcpServers) {
      if (mcp.workspaceId) mcpMap.set(mcp.name, mcp);
    }

    return {
      // history 和 memories 由 Runner 从 workspace.db 本地加载
      memories: [] as string[],
      skills: skills.map((s: any) => `## ${s.name}\n${s.content}`),
      history: [] as Array<{ role: string; content: string }>,
      systemPrompt: this.buildSystemPrompt(prefs),
    };
  }

  private buildSystemPrompt(prefs?: { language?: string | null; style?: string | null; customRules?: string | null }): string {
    const parts = [
      '你是 CCCLaw 的 AI 助手，运行在工作区沙箱中。',
      '遵循三层安全规则：不执行破坏性操作、不泄露敏感信息、不超出工作区范围。',
    ];
    if (prefs?.customRules) parts.push(`\n用户自定义规则：${prefs.customRules}`);
    return parts.join('\n');
  }

  /** 解析 Provider：工作区绑定 > 用户默认 */
  async resolveProvider(workspaceId: string, userId: string): Promise<{ apiKey: string; apiBase?: string; providerType: string; model?: string }> {
    const rows = await db.select().from(schema.workspaces)
      .where(eq(schema.workspaces.id, workspaceId)).limit(1);
    const settings = (rows[0]?.settings as any) || {};
    const workspaceModel: string | undefined = settings.model;

    let provider;

    // 1. 工作区绑定的 Provider
    if (settings.providerId) {
      const p = await db.select().from(schema.providers)
        .where(and(eq(schema.providers.id, settings.providerId), eq(schema.providers.userId, userId))).limit(1);
      if (p.length) provider = p[0];
    }

    // 2. 用户默认 Provider
    if (!provider) {
      const p = await db.select().from(schema.providers)
        .where(and(eq(schema.providers.userId, userId), eq(schema.providers.isDefault, true))).limit(1);
      if (p.length) provider = p[0];
    }

    if (!provider) throw new Error('没有可用的 Provider，请在个人设置中配置');

    const providerType = provider.type as string;

    // OAuth 认证：使用 OAuthTokenManager 获取有效 token
    if (provider.authType === 'oauth' && provider.oauthState) {
      const tokenManager = new OAuthTokenManager();
      const apiKey = await tokenManager.getToken(provider.oauthState as string, config.ENCRYPTION_KEY, providerType);
      return { apiKey, providerType };
    }

    // API Key 认证：解密 config 获取 key 和 apiBase
    const cfg = JSON.parse(decrypt(provider.config as string, config.ENCRYPTION_KEY));
    let apiBase = cfg.baseURL || cfg.apiBase;
    // 去掉尾部 /v1，OpenAI adapter 会自动拼接
    if (typeof apiBase === 'string') apiBase = apiBase.replace(/\/v1\/?$/, '');
    return { apiKey: cfg.key, apiBase, providerType, model: workspaceModel };
  }

  /**
   * 完整对话流程 — 通过 RunnerManager 路由到正确的运行环境
   * workspaceId: 主 DB 中的 workspace UUID
   * sessionId: workspace.db 中的 session UUID（由 Runner 管理）
   */
  /** 构建 RuntimeConfig 供 runner 缓存 */
  async buildRuntimeConfig(workspaceId: string, userId: string): Promise<RuntimeConfig> {
    const { apiKey, apiBase, providerType, model } = await this.resolveProvider(workspaceId, userId);
    const context = await this.assembleContext(workspaceId, userId);
    return {
      apiKey,
      providerType,
      apiBase,
      model,
      systemPrompt: context.systemPrompt,
      skills: context.skills,
    };
  }

  async chat(
    workspaceId: string,
    userId: string,
    sessionId: string,
    message: string,
    callbacks: StreamCallback,
  ) {
    // 1. 确保 Runner 就绪
    const { slug } = await runnerManager.ensureRunner(workspaceId);

    // 2. 推送配置（Runner 侧会缓存，已有则跳过重复创建）
    const runtimeConfig = await this.buildRuntimeConfig(workspaceId, userId);
    runnerManager.sendConfig(slug, runtimeConfig);

    // 3. 发送精简请求 — 只有 sessionId + message
    const request: AgentRequest = {
      method: 'run',
      params: { sessionId, message },
    };

    await runnerManager.send(slug, request, (msg) => {
      if (msg.type === 'done' || msg.type === 'session_done') callbacks.onDone(msg);
      else if (msg.type === 'error') callbacks.onError(msg);
      else callbacks.onDelta(msg);
    });
  }

  /**
   * 启动 MessageBus 监听 — 消费入站消息，发布出站消息
   * 在 Server 启动时调用一次
   */
  startListening(): void {
    messageBus.onInbound((msg: InboundMessage) => {
      if (msg.type === 'user_message') {
        this.handleInboundMessage(msg).catch((err) => {
          const errMsg = err instanceof Error ? err.message : String(err);
          const errStack = err instanceof Error ? err.stack : '';
          logger.error({ err: errMsg, stack: errStack }, `Bus inbound 处理失败: session=${msg.sessionId}`);
          messageBus.publishOutbound({
            type: 'error',
            sessionId: msg.sessionId,
            message: errMsg || '未知错误',
          });
        });
      }

      if (msg.type === 'confirm_response') {
        this.handleConfirmResponse(msg).catch((err) => {
          logger.error(err, `confirm_response 转发失败: session=${msg.sessionId}`);
        });
      }

      // cancel 暂不处理，后续 Task 扩展
    });
  }

  private async handleConfirmResponse(msg: InboundMessage & { type: 'confirm_response' }) {
    const { workspaceId, requestId, approved } = msg;
    const [workspace] = await db.select().from(schema.workspaces)
      .where(eq(schema.workspaces.id, workspaceId)).limit(1);
    if (!workspace) {
      logger.warn({ workspaceId }, 'confirm_response: 工作区不存在');
      return;
    }
    runnerManager.sendConfirmResponse(workspace.slug, requestId, approved);
  }

  private async handleInboundMessage(msg: InboundMessage & { type: 'user_message' }) {
    const { workspaceId, userId, sessionId, content } = msg;

    const callbacks: StreamCallback = {
      onDelta: (m) => messageBus.publishOutbound({
        type: 'text_delta',
        sessionId,
        content: String((m as any).delta ?? (m as any).text ?? (m as any).content ?? ''),
      }),
      onDone: (m) => messageBus.publishOutbound({
        type: 'done',
        sessionId,
        tokens: (m.tokens as number) ?? 0,
      }),
      onError: (m) => {
        const errMsg: string = (typeof m.message === 'string' ? m.message : null)
          || (m.error instanceof Error ? m.error.message : null)
          || (typeof m.error === 'string' ? m.error : null)
          || '未知错误';
        logger.error({ agentError: errMsg }, 'Agent onError');
        messageBus.publishOutbound({
          type: 'error',
          sessionId,
          message: errMsg,
        });
      },
    };

    await this.chat(workspaceId, userId, sessionId, content, callbacks);
  }
}

export const agentManager = new AgentManager();
