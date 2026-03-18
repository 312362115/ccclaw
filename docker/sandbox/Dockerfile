FROM node:22-alpine

# git/bash/curl for agent tools, python3/make/g++ for native module compilation (better-sqlite3, node-pty)
RUN apk add --no-cache git bash curl python3 make g++ gcc musl-dev

RUN adduser -D -h /home/agent agent

COPY packages/agent-runtime/dist /app
COPY packages/agent-runtime/package.json /app/package.json
WORKDIR /app
RUN npm install --production

# Remove build tools to reduce image size
RUN apk del python3 make g++ gcc musl-dev

USER agent

ENTRYPOINT ["node", "/app/index.js"]
