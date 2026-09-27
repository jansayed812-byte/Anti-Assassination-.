# سامانه ارزیابی امنیتی محیط‌های عملیاتی

**سند معماری:** [ARCHITECTURE.md](./ARCHITECTURE.md)  
**برنامه پیاده‌سازی:** [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md)  
**لیست بررسی:** [MASTER_IMPLEMENTATION_CHECKLIST.md](./MASTER_IMPLEMENTATION_CHECKLIST.md)

## 📋 وضعیت

🟢 **تمام ۱۲ فاز تکمیل شد**

## 🖥️ کنسول عملیات (Operations Console)

رابط کاربری طراحی‌شده (Nocturne · RTL/فارسی) به‌صورت یک برنامهٔ یکپارچه پیاده‌سازی شده است: داشبورد React در `dashboard/` و بک‌اند API/WebSocket در `services/server/` که روی ماژول‌های موجود پلتفرم (موتور ریسک، تلفیق Kalman، موتور شبیه‌سازی، JWT/RBAC، Gateway) ساخته شده است. این حالت **بدون Docker** و بدون پایگاه داده اجرا می‌شود (وضعیت در حافظه).

```bash
npm run setup          # نصب وابستگی‌های root، services و dashboard
npm run build          # بیلد داشبورد + typecheck سرویس‌ها
npm start              # UI + API + WebSocket روی http://localhost:8000
# یا حالت توسعه: API با watch روی :8000 و Vite روی :3000 (با proxy)
npm run dev
```

حساب‌های نمونه (گذرواژه: `demo`، قابل تغییر با `DEMO_PASSWORD`):

| کاربر | نقش | خانهٔ تطبیقی |
|------|-----|-------------|
| `maryam` | اپراتور داشبورد | زنده |
| `reza` | تحلیلگر امنیتی | تحلیل |
| `ali` | برنامه‌ریز اسکورت | برنامه‌ریزی |
| `ahmadi` | فرمانده (تنها نقش مجاز به تأیید پلن) | زنده |
| `sara` | تیم فنی | دارایی‌ها |

در `NODE_ENV=production` مقدار `JWT_SECRET` الزامی است و سوییچ نقش از منو (`DEMO_MODE`) به‌طور پیش‌فرض غیرفعال می‌شود. اجرای Docker: `make console`.

### ساختار

```
dashboard/src/
  app/        Shell (شبکهٔ واکنش‌گرا mobile/tablet/desktop/wall)، actions، roles، permissions، hooks
  api/        client (JWT + صف آفلاین)، types
  realtime/   streams (Socket.IO، resume بر اساس seq، حذف تکرار با integrity)، envelopes
  stores/     Zustand: ops (داده + UI)، session
  map/        صحنهٔ three.js (ترِین آفلاین، شبکهٔ ریسک شش‌ضلعی، مسیرهای PACE، واحدها با CEP)
  workspaces/ live · analysis · planning · sim · assets · admin
  ui/         AlertCard، CommandPalette (Ctrl+K)، PANIC، منوی حساب، Toast، بنر آفلاین
  i18n/       fa.json · en.json
services/server/
  app.ts      REST + Socket.IO، حلقه‌های ۵Hz تله‌متری و ۱Hz ریسک، میزبانی داشبورد بیلدشده
  realtime.ts envelope با seq + sha256 و بافر ۱۰k برای replay
  domain/     alerts (چرخهٔ ACK/ارتقا)، units (تلفیق FusionOrchestrator)، risk، plans (PACE)، sim، devices، detections، admin، users
```

میان‌برها: `Alt+1…6` فضاهای کاری، `Ctrl+K` جستجو/فرمان، `Esc` بستن. از منوی حساب می‌توان نقش، زبان (فا/EN)، «شبیه‌سازی قطع شبکه» و «نمایش نقاط اتصال API» را تغییر داد.

![کنسول زنده](docs/screenshots/live.png)

## 🚀 شروع سریع (زیرساخت کامل با Docker)

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
