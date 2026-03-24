FROM node:22-alpine

# git/bash/curl for agent tools, python3/make/g++ for native module compilation (better-sqlite3, node-pty)
RUN apk add --no-cache git bash curl python3 make g++ gcc musl-dev

RUN adduser -D -h /home/agent agent

# 复制 shared 包（编译产物）+ 安装其依赖
COPY packages/shared/dist /shared/dist
COPY packages/shared/package.json /shared/package.json
RUN cd /shared && npm install --omit=dev

# 复制 agent-runtime
COPY packages/agent-runtime/dist /app
COPY packages/agent-runtime/package.json /app/package.json
WORKDIR /app

# 将 workspace:* 替换为本地路径引用，然后安装
RUN sed -i 's|"workspace:\*"|"file:/shared"|g' package.json && \
    npm install --omit=dev

# Remove build tools to reduce image size
RUN apk del python3 make g++ gcc musl-dev

USER agent

ENTRYPOINT ["node", "/app/index.js"]
