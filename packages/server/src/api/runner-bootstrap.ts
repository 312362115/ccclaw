import { Hono } from 'hono';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { config } from '../config.js';
import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';

const runnerBootstrapRouter = new Hono();

// packages/ 目录（相对于 DATA_DIR 推断项目根）
function getPackagesDir(): string {
  // DATA_DIR 一般是 <project>/data，packages 在 <project>/packages
  return resolve(config.DATA_DIR, '..', 'packages');
}

// GET /api/runner-bootstrap?slug=xxx&token=xxx
// 返回一键启动 bash 脚本
runnerBootstrapRouter.get('/runner-bootstrap', async (c) => {
  const slug = c.req.query('slug');
  const token = c.req.query('token');

  if (!slug || !token) {
    return c.text('# Error: missing slug or token parameter\nexit 1', 400);
  }

  if (token !== config.RUNNER_SECRET) {
    return c.text('# Error: invalid token\nexit 1', 403);
  }

  const [ws] = await db.select().from(schema.workspaces)
    .where(eq(schema.workspaces.slug, slug)).limit(1);
  if (!ws) {
    return c.text(`# Error: workspace "${slug}" not found\nexit 1`, 404);
  }

  const settings = (ws.settings as any) || {};
  const runnerId = settings.runnerId || `runner-${slug}`;

  const proto = c.req.header('x-forwarded-proto') || 'http';
  const host = c.req.header('host') || 'localhost:3000';
  const serverWsUrl = `${proto === 'https' ? 'wss' : 'ws'}://${host}/ws/runner`;
  const bundleUrl = `${proto}://${host}/api/runner-bundle`;

  const script = `#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# CCCLaw Remote Runner 一键启动脚本
# 工作区: ${ws.name} (${slug})
# Runner ID: ${runnerId}
# ============================================================

RUNNER_ID="${runnerId}"
SERVER_URL="${serverWsUrl}"
AUTH_TOKEN="${token}"
BUNDLE_URL="${bundleUrl}"
INSTALL_DIR="\${CCCLAW_INSTALL_DIR:-\$HOME/.ccclaw-runner}"
WORKSPACE_DIR="\${INSTALL_DIR}/workspaces/${slug}/home"
INTERNAL_DIR="\${INSTALL_DIR}/workspaces/${slug}/internal"

echo "==> CCCLaw Remote Runner Installer"
echo "    工作区: ${ws.name} (${slug})"
echo "    Server: ${serverWsUrl}"
echo ""

# 1. 检查 Node.js
if ! command -v node &>/dev/null; then
  echo "==> Node.js 未安装，尝试自动安装..."
  if command -v curl &>/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs
  else
    echo "错误: 需要 Node.js >= 22，请先安装"
    exit 1
  fi
fi

NODE_VERSION=\$(node -v | sed 's/v//' | cut -d. -f1)
if [ "\$NODE_VERSION" -lt 22 ]; then
  echo "错误: Node.js 版本过低 (需要 >= 22，当前 \$(node -v))"
  exit 1
fi
echo "==> Node.js \$(node -v) ✓"

# 2. 创建目录
mkdir -p "\$INSTALL_DIR/app" "\$WORKSPACE_DIR" "\$INTERNAL_DIR"

# 3. 下载 Runtime Bundle
echo "==> 下载 Agent Runtime..."
curl -fsSL "\$BUNDLE_URL" | tar xz -C "\$INSTALL_DIR/app" --strip-components=0
echo "==> 下载完成 ✓"

# 4. 准备 package.json — 替换 workspace 协议
cd "\$INSTALL_DIR/app"
if [ -f package.json ]; then
  sed -i.bak 's|"workspace:\\*"|"file:../shared"|g' package.json 2>/dev/null || \\
  sed -i '' 's|"workspace:\\*"|"file:../shared"|g' package.json
  rm -f package.json.bak
fi

# 5. 安装依赖
echo "==> 安装依赖..."
npm install --omit=dev --silent 2>&1 | tail -1
echo "==> 依赖安装完成 ✓"

# 6. 启动 Runner
echo ""
echo "==> 启动 Runner (Ctrl+C 停止)"
echo "    Runner ID: \$RUNNER_ID"
echo "    Server:    \$SERVER_URL"
echo "    Workspace: \$WORKSPACE_DIR"
echo ""

exec env \\
  RUNNER_ID="\$RUNNER_ID" \\
  SERVER_URL="\$SERVER_URL" \\
  AUTH_TOKEN="\$AUTH_TOKEN" \\
  WORKSPACE_DIR="\$WORKSPACE_DIR" \\
  INTERNAL_DIR="\$INTERNAL_DIR" \\
  WORKSPACE_DB="\$INTERNAL_DIR/workspace.db" \\
  ALLOWED_PATHS="\$WORKSPACE_DIR:\$INTERNAL_DIR" \\
  node "\$INSTALL_DIR/app/index.js"
`;

  c.header('Content-Type', 'text/plain; charset=utf-8');
  return c.text(script);
});

// GET /api/runner-bundle
// 返回 agent-runtime/dist + shared/dist 的 tarball
runnerBootstrapRouter.get('/runner-bundle', async (c) => {
  const pkgDir = getPackagesDir();
  const runtimeDist = join(pkgDir, 'agent-runtime', 'dist');
  const sharedDist = join(pkgDir, 'shared', 'dist');

  if (!existsSync(runtimeDist) || !existsSync(sharedDist)) {
    return c.text('Runtime not built. Run: pnpm -r build', 500);
  }

  // 用系统 tar 打包: app/ (runtime) + shared/ (shared)
  const tarball = await new Promise<Buffer>((resolve, reject) => {
    // 构建 tarball: 把 agent-runtime 映射为 app/，shared 映射为 shared/
    const args = [
      'czf', '-',
      '-C', join(pkgDir, 'agent-runtime'), '--transform', 's,^,app/,',
      'dist', 'package.json',
    ];
    // 追加 shared 包
    args.push(
      '-C', join(pkgDir, 'shared'), '--transform', 's,^,shared/,',
      'dist', 'package.json',
    );

    execFile('tar', args, { maxBuffer: 50 * 1024 * 1024, encoding: 'buffer' }, (err, stdout) => {
      if (err) {
        // macOS tar 不支持 --transform，用 bsdtar 替代方案
        buildWithTwoTars(pkgDir).then(resolve).catch(reject);
      } else {
        resolve(stdout as unknown as Buffer);
      }
    });
  });

  return new Response(new Uint8Array(tarball), {
    headers: {
      'Content-Type': 'application/gzip',
      'Content-Disposition': 'attachment; filename="ccclaw-runner.tar.gz"',
    },
  });
});

// macOS 兼容：分别打包然后合并
async function buildWithTwoTars(pkgDir: string): Promise<Buffer> {
  const { mkdtemp, rm, cp, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const tmpDir = await mkdtemp(join(tmpdir(), 'ccclaw-bundle-'));

  try {
    // 构建临时目录结构: app/ + shared/
    await cp(join(pkgDir, 'agent-runtime', 'dist'), join(tmpDir, 'app', 'dist'), { recursive: true });
    await cp(join(pkgDir, 'agent-runtime', 'package.json'), join(tmpDir, 'app', 'package.json'));
    await cp(join(pkgDir, 'shared', 'dist'), join(tmpDir, 'shared', 'dist'), { recursive: true });
    await cp(join(pkgDir, 'shared', 'package.json'), join(tmpDir, 'shared', 'package.json'));

    return new Promise<Buffer>((resolve, reject) => {
      execFile('tar', ['czf', '-', '-C', tmpDir, 'app', 'shared'],
        { maxBuffer: 50 * 1024 * 1024, encoding: 'buffer' },
        (err, stdout) => {
          if (err) reject(err);
          else resolve(stdout as unknown as Buffer);
        },
      );
    });
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

export { runnerBootstrapRouter };
