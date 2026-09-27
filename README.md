# سامانه ارزیابی امنیتی محیط‌های عملیاتی

**سند معماری:** [ARCHITECTURE.md](./ARCHITECTURE.md)  
**برنامه پیاده‌سازی:** [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md)  
**لیست بررسی:** [MASTER_IMPLEMENTATION_CHECKLIST.md](./MASTER_IMPLEMENTATION_CHECKLIST.md)

## 📋 وضعیت

🟢 **تمام ۱۲ فاز تکمیل شد**

## 🚀 شروع سریع

### پیش‌نیازها

- Docker و Docker Compose
- Git
- Make (اختیاری)
- Node.js 20+

### راه‌اندازی

```bash
# کلون کردن repository
git clone https://github.com/jansayed812-byte/anti-assassination-
cd anti-assassination-

# تنظیم محیط
make setup

# شروع سرویس‌ها
make up

# بررسی وضعیت
make health
```

## 📚 دسترسی سرویس‌ها

| سرویس | پورت | توضیح |
|------|------|-------|
| PostgreSQL | 5432 | قاعده‌داده اصلی + PostGIS |
| TimescaleDB | 5433 | داده‌های سری زمانی |
| NATS | 4222 | شبکه پیام‌رسانی |
| NATS Dashboard | 8222 | مدیریت NATS |
| Redis | 6379 | کش و state کوتاه‌مدت |
| MinIO | 9000 | ذخیره‌سازی اشیاء |
| MinIO Console | 9001 | کنسول مدیریت MinIO |
| Dashboard | 3000 | رابط کاربری React |
| API Gateway | 8000 | REST + WebSocket |

## 🔧 دستورات مفید

```bash
# نمایش logs
make logs

# ورود به PostgreSQL
make db-shell

# ورود به Redis
make redis-cli

# متوقف کردن سرویس‌ها
make down

# پاکسازی و شروع مجدد
make clean
make up

# اجرای unit tests
npm test
```

## 📁 ساختار پروژه

```
ops-security-platform/
├── services/              # میکروسرویس‌ها
│   ├── comms/            # Message Bus + WebSocket + WAL
│   ├── fusion/           # Fusion موقعیت (Kalman)
│   ├── threat/           # موتور ریسک
│   ├── vision/           # تحلیل ویدئو
│   ├── simulation/       # موتور شبیه‌سازی
│   ├── intel/            # تحلیل مکانی (PostGIS)
│   └── auth/             # هویت و JWT
├── dashboard/            # رابط کاربری React
├── tests/                # Unit + Integration tests
├── init-db/              # فایل‌های initialization
├── .github/workflows/    # CI/CD
├── docker-compose.yml    # تعریف سرویس‌ها
├── .env.example          # متغیرهای محیط
└── Makefile              # دستورات راحتی
```

## 🔐 امنیت

```bash
cp .env.example .env
# تغییر password‌های پیش‌فرض
nano .env
```

## 📖 مستندات

- [معماری سامانه](./ARCHITECTURE.md)
- [برنامه پیاده‌سازی](./IMPLEMENTATION_PLAN.md)
- [لیست بررسی کامل](./MASTER_IMPLEMENTATION_CHECKLIST.md)

---

**آخرین بروز‌رسانی:** 2026-09-27  
**وضعیت:** 🟢 تمام ۱۲ فاز تکمیل
