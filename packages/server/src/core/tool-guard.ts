// ToolGuard — Agent 行为安全拦截器
// 基于规则匹配工具调用，返回 allow / block / confirm

export type GuardDecision = 'allow' | 'block' | 'confirm';

interface GuardResult {
  decision: GuardDecision;
  reason?: string;
}

// 黑名单：直接拒绝
const BLOCKED_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /rm\s+(-[a-z]*)?r[a-z]*\s+\/($|\s)/, reason: '禁止删除根目录' },
  { pattern: /rm\s+(-[a-z]*)?r[a-z]*f[a-z]*\s+\/($|\s)/, reason: '禁止 rm -rf /' },
  { pattern: /mkfs/, reason: '禁止格式化磁盘' },
  { pattern: /dd\s+if=.*of=\/dev/, reason: '禁止直接写入设备' },
  { pattern: /curl\s+.*\|\s*(bash|sh|zsh)/, reason: '禁止从网络下载并执行脚本' },
  { pattern: /wget\s+.*\|\s*(bash|sh|zsh)/, reason: '禁止从网络下载并执行脚本' },
  { pattern: /chmod\s+777/, reason: '禁止设置过于宽松的权限' },
  { pattern: />\s*\/etc\//, reason: '禁止写入系统配置文件' },
  { pattern: /env\s+.*PASSWORD|env\s+.*SECRET|env\s+.*TOKEN|env\s+.*KEY/i, reason: '禁止在命令中传递密钥' },
];

// 确认名单：需要用户审批
const CONFIRM_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /git\s+push\s+.*--force/, reason: 'force push 可能覆盖远程历史' },
  { pattern: /git\s+push\s+-f/, reason: 'force push 可能覆盖远程历史' },
  { pattern: /git\s+reset\s+--hard/, reason: 'hard reset 会丢弃未提交的更改' },
  { pattern: /git\s+clean\s+-f/, reason: '会删除未跟踪的文件' },
  { pattern: /npm\s+publish/, reason: '发布包到 npm' },
  { pattern: /docker\s+rm/, reason: '删除 Docker 容器' },
  { pattern: /docker\s+rmi/, reason: '删除 Docker 镜像' },
  { pattern: /DROP\s+TABLE|DROP\s+DATABASE/i, reason: '执行数据库删除操作' },
  { pattern: /TRUNCATE\s+TABLE/i, reason: '清空数据表' },
  { pattern: /rm\s+(-[a-z]*)?r/, reason: '递归删除文件' },
];

/**
 * 检查 bash 命令是否安全
 */
export function checkBashCommand(command: string): GuardResult {
  for (const rule of BLOCKED_PATTERNS) {
    if (rule.pattern.test(command)) {
      return { decision: 'block', reason: rule.reason };
    }
  }

  for (const rule of CONFIRM_PATTERNS) {
    if (rule.pattern.test(command)) {
      return { decision: 'confirm', reason: rule.reason };
    }
  }

  return { decision: 'allow' };
}

/**
 * 检查文件操作路径是否安全
 */
export function checkFilePath(path: string, workspaceDir: string): GuardResult {
  const sensitivePatterns = [
    /\.env$/,
    /\.ssh\//,
    /id_rsa/,
    /\.gitconfig$/,
    /credentials/i,
    /secrets?\./i,
  ];

  for (const pattern of sensitivePatterns) {
    if (pattern.test(path)) {
      return { decision: 'confirm', reason: `访问敏感文件: ${path}` };
    }
  }

  // 路径越界检查
  const { resolve } = require('node:path');
  const resolved = resolve(workspaceDir, path);
  if (!resolved.startsWith(resolve(workspaceDir))) {
    return { decision: 'block', reason: '路径越界：禁止访问工作区外的文件' };
  }

  return { decision: 'allow' };
}

/**
 * 统一工具调用检查入口
 */
export function checkToolUse(toolName: string, input: Record<string, unknown>, workspaceDir: string): GuardResult {
  if (toolName === 'bash' && typeof input.command === 'string') {
    return checkBashCommand(input.command);
  }

  if (toolName === 'file' && typeof input.path === 'string') {
    return checkFilePath(input.path, workspaceDir);
  }

  return { decision: 'allow' };
}
