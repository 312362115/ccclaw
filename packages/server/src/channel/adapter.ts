// Channel 抽象 — 统一不同渠道（WebUI/Telegram/Feishu）的消息接口
export interface ChannelAdapter {
  /** 发送流式文本 */
  sendDelta(sessionId: string, content: string): void;
  /** 发送工具调用通知 */
  sendToolUse(sessionId: string, tool: string, input: unknown): void;
  /** 发送确认请求 */
  sendConfirmRequest(requestId: string, sessionId: string, tool: string, input: unknown, reason: string): void;
  /** 发送完成通知 */
  sendDone(sessionId: string, tokens: number): void;
  /** 发送错误 */
  sendError(sessionId: string, message: string): void;
}
