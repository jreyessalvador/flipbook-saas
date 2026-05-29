.PHONY: help dev dev-down prod prod-down build push db-migrate db-seed
.PHONY: db-shell db-backup migrate-k8s logs logs-backend shell-backend ps clean

COMPOSE := $(shell docker compose version > /dev/null 2>&1 && echo "docker compose" || echo "docker-compose")

help:
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk '{printf "  %-20s %s
", $$1, $$2}'

dev: ## Desarrollo local
	$(COMPOSE) up -d
	@echo "Frontend: http://localhost:5174 | API: http://localhost:8001/api/docs"

dev-down: ## Detener dev
	$(COMPOSE) down

dev-reset: ## Eliminar volumenes dev
	$(COMPOSE) down -v

prod: ## Produccion
	$(COMPOSE) -f docker-compose.prod.yml up -d

prod-down: ## Detener produccion
	$(COMPOSE) -f docker-compose.prod.yml down

build: ## Build imagenes
	docker build -t flipbook-backend:latest ./backend
	docker build --target production -t flipbook-frontend:latest ./frontend
	docker build -t flipbook-workers:latest ./workers

db-migrate: ## Migraciones Alembic
	$(COMPOSE) exec backend alembic upgrade head

db-seed: ## Datos iniciales
	$(COMPOSE) exec backend python -m app.db.init_db

db-shell: ## psql
	$(COMPOSE) exec postgres psql -U flipbook -d flipbook

db-backup: ## Backup manual
	bash deploy/scripts/backup.sh

migrate-k8s: ## Migrar desde K3s
	bash deploy/scripts/migrate-from-k8s.sh

logs: ## Todos los logs
	$(COMPOSE) logs -f --tail=100

logs-backend: ## Logs backend
	$(COMPOSE) logs -f backend

shell-backend: ## Shell backend
	$(COMPOSE) exec backend /bin/bash

ps: ## Estado contenedores
	$(COMPOSE) ps

test: ## Tests
	$(COMPOSE) exec backend pytest tests/ -v

clean: ## Limpiar dangling
	docker image prune -f
