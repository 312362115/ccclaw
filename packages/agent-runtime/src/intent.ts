export type Intent = 'stop' | 'correction' | 'plan' | 'plan_execute' | 'continue';

/**
 * Plan 模式状态管理（session 维度）
 * 进入 /plan → 生成计划 → 用户确认 → 执行
 */
const planSessions = new Set<string>();

export function classifyIntent(message: string, sessionId?: string): Intent {
  const normalized = message.trim().toLowerCase();

  const stopExact = ['/stop', '/cancel', '停止', '取消'];
  if (stopExact.includes(normalized)) {
    // 退出 plan 模式
    if (sessionId) planSessions.delete(sessionId);
    return 'stop';
  }

  const correctionExact = ['/retry', '/redo', '重来', '重试'];
  if (correctionExact.includes(normalized)) return 'correction';

  // 进入计划模式
  const planPrefixes = ['/plan ', '/plan\n'];
  const planExact = ['/plan'];
  if (planExact.includes(normalized) || planPrefixes.some((p) => normalized.startsWith(p))) {
    if (sessionId) planSessions.add(sessionId);
    return 'plan';
  }

  // 如果当前 session 处于 plan 模式，用户的确认消息触发执行
  if (sessionId && planSessions.has(sessionId)) {
    const execKeywords = ['执行', '开始', '开干', 'go', 'execute', 'ok', '可以', '确认', 'yes', 'y'];
    if (execKeywords.includes(normalized)) {
      planSessions.delete(sessionId);
      return 'plan_execute';
    }
    // 用户在 plan 模式下发了新消息但不是确认 → 继续 plan 模式（可能在修改计划）
    return 'plan';
  }

  return 'continue';
}

/** 检查 session 是否处于 plan 模式 */
export function isInPlanMode(sessionId: string): boolean {
  return planSessions.has(sessionId);
}

/** 手动退出 plan 模式 */
export function exitPlanMode(sessionId: string): void {
  planSessions.delete(sessionId);
}
