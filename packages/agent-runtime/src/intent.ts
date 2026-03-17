export type Intent = 'stop' | 'correction' | 'continue';

export function classifyIntent(message: string): Intent {
  const normalized = message.trim().toLowerCase();
  const stopExact = ['/stop', '/cancel', '停止', '取消'];
  if (stopExact.includes(normalized)) return 'stop';
  const correctionExact = ['/retry', '/redo', '重来', '重试'];
  if (correctionExact.includes(normalized)) return 'correction';
  return 'continue';
}
