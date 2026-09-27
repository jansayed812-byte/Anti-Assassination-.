# Makefile - سامانه ارزیابی امنیتی
.PHONY: help setup up down logs test clean health install app-build app-start app-dev console

help:
	@echo "سامانه ارزیابی امنیتی محیط‌های عملیاتی"
	@echo "========================================"
	@echo "دستورات:"
	@echo "  make setup        - تنظیم محیط (کپی .env)"
	@echo "  make up           - شروع تمام سرویس‌ها"
	@echo "  make down         - متوقف کردن تمام سرویس‌ها"
	@echo "  make logs         - نمایش logs"
	@echo "  make health       - بررسی وضعیت سرویس‌ها"
	@echo "  make clean        - پاکسازی volumes"
	@echo "  make db-shell     - ورود به PostgreSQL"
	@echo "  make nats-shell   - ورود به NATS"
	@echo "  make test         - اجرای تست‌ها"
	@echo "  make install      - نصب وابستگی‌های root، services و dashboard"
	@echo "  make app-build    - بیلد داشبورد و typecheck سرویس‌ها"
	@echo "  make app-start    - اجرای کنسول عملیات (UI + API) روی :8000"
	@echo "  make app-dev      - اجرای توسعه (API :8000 + Vite :3000)"
	@echo "  make console      - اجرای کنسول در Docker (نیازمند JWT_SECRET)"

setup:
	@if [ ! -f .env ]; then \
		cp .env.example .env; \
		echo "✓ فایل .env ایجاد شد"; \
	else \
		echo "✓ فایل .env قبلاً موجود است"; \
	fi

up:
	docker-compose up -d
	@echo "✓ سرویس‌ها شروع شدند"
	@echo "  PostgreSQL:  localhost:5432"
	@echo "  TimescaleDB: localhost:5433"
	@echo "  NATS:        localhost:4222 (مدیریت: localhost:8222)"
	@echo "  Redis:       localhost:6379"
	@echo "  MinIO:       localhost:9000 (کنسول: localhost:9001)"

down:
	docker-compose down
	@echo "✓ سرویس‌ها متوقف شدند"

logs:
	docker-compose logs -f

logs-postgres:
	docker-compose logs -f postgres

logs-nats:
	docker-compose logs -f nats

logs-redis:
	docker-compose logs -f redis

health:
	@echo "بررسی وضعیت سرویس‌ها..."
	@docker-compose ps
	@echo "\ntest connections:"
	@docker-compose exec postgres pg_isready -U ops_user || echo "❌ PostgreSQL"
	@docker-compose exec timescaledb pg_isready -U ts_user || echo "❌ TimescaleDB"
	@docker-compose exec nats curl -s http://localhost:8222/varz | grep -q "uptime" && echo "✓ NATS" || echo "❌ NATS"
	@docker-compose exec redis redis-cli ping || echo "❌ Redis"
	@docker-compose exec minio curl -s http://localhost:9000/minio/health/live && echo "✓ MinIO" || echo "❌ MinIO"

db-shell:
	docker-compose exec postgres psql -U ops_user -d ops_database

ts-shell:
	docker-compose exec timescaledb psql -U ts_user -d ts_database

nats-shell:
	docker-compose exec nats nats

redis-cli:
	docker-compose exec redis redis-cli -a ${REDIS_PASSWORD:-redis_secure_password}

clean:
	docker-compose down -v
	@echo "✓ تمام volumes پاک شدند"

restart:
	make down
	make up

build:
	docker-compose build

pull:
	docker-compose pull

test:
	npm test

dev:
	docker-compose -f docker-compose.yml -f docker-compose.dev.yml up -d

prod:
	docker-compose -f docker-compose.yml up -d

.DEFAULT_GOAL := help

install:
	npm run setup

app-build:
	npm run build

app-start: app-build
	npm start

app-dev:
	npm run dev

console:
	docker-compose up -d --build console
	@echo "✓ کنسول عملیات: http://localhost:8000"
