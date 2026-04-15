COMPOSE       ?= docker compose
COMPOSE_DEV   := $(COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml

.PHONY: help build up down restart logs shell dev dev-down dev-logs

help:
	@echo "Targets:"
	@echo "  build     Build production image"
	@echo "  up        Start production stack (detached)"
	@echo "  down      Stop production stack"
	@echo "  restart   Restart production stack"
	@echo "  logs      Tail production logs"
	@echo "  shell     Open a shell in the running container"
	@echo "  dev       Start dev stack with compose watch (run 'pnpm dev' on host to rebuild dist/)"
	@echo "  dev-down  Stop dev stack"
	@echo "  dev-logs  Tail dev logs"

build:
	$(COMPOSE) build

up:
	$(COMPOSE) up -d

down:
	$(COMPOSE) down

restart:
	$(COMPOSE) restart

logs:
	$(COMPOSE) logs -f --tail=100

shell:
	$(COMPOSE) exec shrimp sh

dev:
	pnpm build
	pnpm exec tsdown --watch & \
	  TSDOWN_PID=$$!; \
	  trap "kill $$TSDOWN_PID 2>/dev/null" EXIT INT TERM; \
	  $(COMPOSE_DEV) up --watch

dev-down:
	$(COMPOSE_DEV) down

dev-logs:
	$(COMPOSE_DEV) logs -f --tail=100
