# CCCLaw Server — 多阶段构建
FROM node:22-alpine AS builder
WORKDIR /build

# 安装 pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# 先复制依赖声明，利用 Docker 缓存
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
COPY packages/agent-runtime/package.json packages/agent-runtime/

RUN pnpm install --frozen-lockfile

# 复制源码并构建
COPY tsconfig.base.json ./
COPY packages/ packages/

RUN pnpm --filter @ccclaw/shared build && \
    pnpm --filter @ccclaw/server build && \
    pnpm --filter @ccclaw/web build

# ====== 运行阶段 ======
FROM node:22-alpine
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

# 复制构建产物
COPY --from=builder /build/package.json /build/pnpm-lock.yaml /build/pnpm-workspace.yaml ./
COPY --from=builder /build/packages/shared/package.json packages/shared/
COPY --from=builder /build/packages/shared/dist packages/shared/dist/
COPY --from=builder /build/packages/server/package.json packages/server/
COPY --from=builder /build/packages/server/dist packages/server/dist/
COPY --from=builder /build/packages/server/drizzle packages/server/drizzle/
COPY --from=builder /build/packages/agent-runtime/package.json packages/agent-runtime/
COPY --from=builder /build/packages/agent-runtime/dist packages/agent-runtime/dist/

# WebUI 静态文件
COPY --from=builder /build/dist/web dist/web/

# 安装生产依赖
RUN pnpm install --prod --frozen-lockfile

# 创建数据目录
RUN mkdir -p /data/ccclaw

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/data/ccclaw

EXPOSE 3000

CMD ["node", "packages/server/dist/index.js"]
