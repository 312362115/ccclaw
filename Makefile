# CCCLaw 开发命令
# 使用方式: make <target>

# ====== 首次初始化 ======

.PHONY: setup
setup: ## 首次初始化：安装依赖 + 生成 .env + 创建数据目录 + DB 迁移 + Seed admin
	@echo "==> 安装依赖"
	pnpm install
	@if [ ! -f .env ]; then \
		echo "==> 生成 .env（从 .env.example）"; \
		cp .env.example .env; \
		JWT_SECRET=$$(openssl rand -hex 32); \
		ENCRYPTION_KEY=$$(openssl rand -hex 32); \
		RUNNER_SECRET=$$(openssl rand -hex 16); \
		sed -i '' "s/change-me-to-a-random-string/$$JWT_SECRET/" .env; \
		sed -i '' "s/change-me-to-a-64-char-hex-string-representing-32-bytes-aes256xx/$$ENCRYPTION_KEY/" .env; \
		echo "RUNNER_SECRET=$$RUNNER_SECRET" >> .env; \
		echo "  .env 已生成，请修改 ADMIN_EMAIL / ADMIN_PASSWORD"; \
	else \
		echo "  .env 已存在，跳过"; \
	fi
	@mkdir -p /data/ccclaw 2>/dev/null || mkdir -p ./data && echo "DATA_DIR=./data" >> .env && echo "  使用 ./data 作为数据目录"
	@echo "==> 生成数据库迁移"
	$(MAKE) db-generate
	@echo "==> 执行数据库迁移"
	$(MAKE) db-migrate
	@echo "==> Seed admin 用户"
	$(MAKE) db-seed
	@echo ""
	@echo "✅ 初始化完成！运行 make dev 启动开发环境"

# ====== 开发启动 ======

.PHONY: dev
dev: ## 同时启动 Server + Web（前台运行，Ctrl+C 停止）
	@echo "==> 启动 Server (port 3000) + Web (port 5173)"
	@trap 'kill 0' INT; \
		pnpm --filter @ccclaw/server dev & \
		pnpm --filter @ccclaw/web dev & \
		wait

.PHONY: server
server: ## 仅启动 Server（dev 模式，热重载）
	pnpm --filter @ccclaw/server dev

.PHONY: web
web: ## 仅启动 Web（Vite dev server，自动代理到 Server）
	pnpm --filter @ccclaw/web dev

.PHONY: runner
runner: ## 启动本地 Runner（需要先启动 Server）
	@. ./.env 2>/dev/null; \
	RUNNER_ID=$${RUNNER_ID:-runner-local} \
	SERVER_URL=$${SERVER_URL:-ws://127.0.0.1:$${PORT:-3000}/ws/runner} \
	AUTH_TOKEN=$${RUNNER_SECRET} \
	WORKSPACE_DIR=$${DATA_DIR:-./data}/workspaces/default/workspace \
	ALLOWED_PATHS=$${DATA_DIR:-./data}/workspaces/default/workspace \
	node --import tsx packages/agent-runtime/src/index.ts

# ====== 数据库 ======

.PHONY: db-generate
db-generate: ## 生成 DB 迁移文件
	pnpm --filter @ccclaw/server generate

.PHONY: db-migrate
db-migrate: ## 执行 DB 迁移
	pnpm --filter @ccclaw/server migrate

.PHONY: db-seed
db-seed: ## Seed admin 用户
	pnpm --filter @ccclaw/server seed

# ====== 构建 & 测试 ======

.PHONY: build
build: ## 构建所有包
	pnpm -r build

.PHONY: typecheck
typecheck: ## 全量类型检查
	pnpm -r typecheck

.PHONY: test
test: ## 运行所有测试
	pnpm --filter @ccclaw/shared exec vitest run
	pnpm --filter @ccclaw/server exec vitest run

.PHONY: lint
lint: ## Lint 检查
	pnpm lint

# ====== Docker ======

.PHONY: docker-dev
docker-dev: ## Docker Compose 开发环境（PG + Caddy）
	docker compose -f docker/compose.dev.yml up -d

.PHONY: docker-prod
docker-prod: ## Docker Compose 生产部署
	docker compose -f docker/compose.yml up -d --build

.PHONY: docker-sqlite
docker-sqlite: ## Docker Compose SQLite 模式
	docker compose -f docker/compose.sqlite.yml up -d --build

.PHONY: docker-sandbox
docker-sandbox: ## 构建沙箱镜像
	docker build -t ccclaw-runner:latest -f docker/sandbox/Dockerfile .

.PHONY: docker-down
docker-down: ## 停止所有 Docker 容器
	docker compose -f docker/compose.yml down 2>/dev/null; \
	docker compose -f docker/compose.dev.yml down 2>/dev/null; \
	docker compose -f docker/compose.sqlite.yml down 2>/dev/null; true

# ====== 清理 ======

.PHONY: clean
clean: ## 清理构建产物
	rm -rf packages/*/dist dist/

# ====== 帮助 ======

.PHONY: help
help: ## 显示帮助
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

.DEFAULT_GOAL := help
