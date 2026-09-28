# Makefile - سیستم ارزیابی امنیتی (Security Assessment)
.PHONY: help setup up down logs test clean health install app-build app-start app-dev console osm

help:
	@echo "سیستم ارزیابی امنیتی محیط‌های عملیاتی — Security Assessment"
	@echo "========================================"
	@echo "فرمان‌ها:"
	@echo "  make setup        - آماده‌سازی محیط (کاپی .env)"
	@echo "  make up           - آغاز همهٔ سرویس‌ها"
	@echo "  make down         - توقف همهٔ سرویس‌ها"
	@echo "  make logs         - نمایش لاگ‌ها"
	@echo "  make health       - بررسی صحت سرویس‌ها"
	@echo "  make clean        - پاک‌کاری volumeها"
	@echo "  make db-shell     - ورود به PostgreSQL"
	@echo "  make nats-shell   - ورود به NATS"
	@echo "  make test         - اجرای آزمایش‌ها"
	@echo "  make install      - نصب وابستگی‌های root، services و dashboard"
	@echo "  make app-build    - ساختن داشبورد و بررسی typeهای سرویس‌ها"
	@echo "  make app-start    - اجرای کنسول عملیات (UI + API) روی :8000"
	@echo "  make app-dev      - اجرای حالت انکشاف (API :8000 + Vite :3000)"
	@echo "  make console      - اجرای کنسول در Docker (به JWT_SECRET ضرورت دارد)"
	@echo "  make osm          - دریافت معلومات OpenStreetMap برای شعبه‌ها (انترنت لازم است)"

setup:
	@if [ ! -f .env ]; then \
		cp .env.example .env; \
		echo "✓ فایل .env ساخته شد"; \
	else \
		echo "✓ فایل .env از قبل موجود است"; \
	fi

up:
	docker-compose up -d
	@echo "✓ سرویس‌ها آغاز شدند"
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
	@echo "بررسی صحت سرویس‌ها..."
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
	@echo "✓ همهٔ volumeها پاک شدند"

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

osm:
	npm run fetch:osm
