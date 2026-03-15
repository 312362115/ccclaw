FROM node:22-alpine

RUN apk add --no-cache git bash curl

RUN adduser -D -h /home/agent agent

COPY packages/agent-runtime/dist /app
COPY packages/agent-runtime/package.json /app/package.json
WORKDIR /app
RUN npm install --production

USER agent

ENTRYPOINT ["node", "/app/index.js"]
