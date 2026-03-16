/**
 * Token 估算工具
 *
 * 基于字符数的轻量级估算，无需外部依赖。
 * 英文 ≈ 4 chars/token，中文 ≈ 2 chars/token。
 * 后续可替换为 tiktoken 精确计算。
 */

/** 估算文本 token 数 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let count = 0;
  for (const char of text) {
    // 中文/日文/韩文等 CJK 字符：约 0.5 char/token
    // ASCII 及其他：约 0.25 char/token
    count += char.charCodeAt(0) > 0x7F ? 0.5 : 0.25;
  }
  return Math.ceil(count);
}

/** 估算消息数组的 token 数（含 role 标记开销） */
export function estimateMessagesTokens(
  messages: ReadonlyArray<{ role: string; content: string }>,
): number {
  const MESSAGE_OVERHEAD = 4; // 每条消息的 role/分隔符开销
  let total = 0;
  for (const msg of messages) {
    total += estimateTokens(msg.content) + MESSAGE_OVERHEAD;
  }
  return total;
}

/** 估算完整 session 上下文的 token 数 */
export function estimateSessionTokens(
  systemPrompt: string,
  memories: readonly string[],
  messages: ReadonlyArray<{ role: string; content: string }>,
): number {
  return (
    estimateTokens(systemPrompt) +
    memories.reduce((sum, m) => sum + estimateTokens(m), 0) +
    estimateMessagesTokens(messages)
  );
}
