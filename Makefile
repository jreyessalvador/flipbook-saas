# /opt/flipbook-saas/Makefile

.PHONY: help dev build deploy clean

help:
	@echo "Flipbook SaaS - Comandos disponibles:"
	@echo "  make dev        - Iniciar entorno de desarrollo"
	@echo "  make build      - Build de imágenes Docker"
	@echo "  make deploy     - Deploy a Kubernetes"
	@echo "  make clean      - Limpiar contenedores y volúmenes"

dev:
	docker-compose up -d

build:
	docker build -t flipbook-backend:latest ./backend
	docker build -t flipbook-frontend:latest ./frontend
	docker build -t flipbook-workers:latest ./workers

deploy:
	kubectl apply -f k8s/base/
	kubectl apply -f k8s/backend/
	kubectl apply -f k8s/frontend/
	kubectl apply -f k8s/workers/
	kubectl apply -f k8s/ingress/

clean:
	docker-compose down -v
