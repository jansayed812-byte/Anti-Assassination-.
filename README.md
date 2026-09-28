# سیستم ارزیابی امنیتی محیط‌های عملیاتی

**Security Assessment · Operations console** — دری · پښتو · English

**سند معماری:** [ARCHITECTURE.md](./ARCHITECTURE.md) ·
**پلان تطبیق:** [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) ·
**فهرست بررسی:** [MASTER_IMPLEMENTATION_CHECKLIST.md](./MASTER_IMPLEMENTATION_CHECKLIST.md) ·
**راپور آزمایش:** [docs/TEST_REPORT.md](./docs/TEST_REPORT.md) ·
**واژه‌نامه:** [docs/i18n/GLOSSARY.md](./docs/i18n/GLOSSARY.md) ·
**فلسفهٔ طراحی:** [docs/design/design-philosophy.md](./docs/design/design-philosophy.md)

> **معلومات تمرینی:** واحدها، رویدادها، پلان‌ها و دستگاه‌هایی که در کنسول دیده می‌شوند ساختگی و برای تمرین اند.
> نقشهٔ پایه از OpenStreetMap است؛ در صورت نبود معلومات OSM در مخزن، یک شبکهٔ سرک ساختگی و علامه‌گذاری‌شده به کار می‌رود.

## کنسول عملیات

کنسول یک برنامهٔ یکپارچه است: داشبورد React در `dashboard/` و بک‌اند REST/Socket.IO در `services/server/`.
بدون Docker و بدون دیتابیس اجرا می‌شود (وضعیت در حافظه).

```bash
npm run setup          # نصب وابستگی‌های root، services و dashboard
npm run build          # ساختن داشبورد + بررسی typeهای سرویس‌ها
npm start              # UI + API + WebSocket روی http://localhost:8000
npm run dev            # حالت انکشاف: API روی :8000 و Vite روی :3000 (با proxy)
npm test               # آزمایش‌های واحد و ادغام (vitest)
npm run test:e2e       # آزمایش‌های کاربری در مرورگر (Playwright)
npm run test:perf      # آزمایش کارایی (بار REST، Socket.IO و مسیریابی)
```

### قابلیت‌ها

- **نقشهٔ سه‌بعدی واقعی:** MapLibre GL با کاشی‌های برداری OpenStreetMap (OpenFreeMap)، تعمیرات سه‌بعدی، عوارض زمین (DEM)
  و سایه‌روشن. نقشه به‌طور پیش‌فرض روی **مزار شریف** باز می‌شود و تمام محدودهٔ شهری را نشان می‌دهد؛ بزرگنمایی، چرخش،
  تغییر زاویه، حالت دوبعدی/سه‌بعدی و «نمایش تمام شهر». مختصات در سراسر سیستم WGS84 با شش رقم اعشاری (حدود ۰٫۱ متر) اند.
  اگر کاشی‌ها در دسترس نباشند، نقشهٔ پایهٔ آفلاین از شبکهٔ سرک‌های خود شعبه ساخته می‌شود.
- **ارزیابی ریسک روی نقشه:** شبکهٔ H3 (دقت ۹، خانه‌های تقریباً ۰٫۱ کیلومتر مربع) که به محدودهٔ شهر بریده شده است؛ نمرهٔ هر
  خانه از تهدید رویدادها، فاصله تا پولیس/شفاخانه و خلای پوشش به دست می‌آید. **خطرناک‌ترین** و **امن‌ترین** محل‌ها با رنگ
  و شکل متفاوت رتبه‌بندی و با دلایل نمره نمایش داده می‌شوند.
- **نقاط کور:** ساحه‌های بدون پوشش شبکه (مدل افت مسیر رله‌ها)، بدون نظارت (زاویهٔ دید کمره‌ها و پوشش درون) و با دسترسی
  محدود به‌طور خودکار تشخیص، با الگوی راه‌راه اخطار روی نقشه مشخص و برای هرکدام راپور مفصل (مساحت، ریسک، مسیرهای عبوری،
  نزدیک‌ترین پشتیبانی، اقدام پیشنهادی) ساخته می‌شود. خاموش شدن یک رله نقطهٔ کور جدید و اخطار می‌سازد.
- **پلانگذاری حرکت اسکورت:** چهار مسیر PACE روی شبکهٔ سرک‌ها با در نظر گرفتن ریسک؛ رنگ‌بندی امن/ناامن هر بخش، زمان سفر،
  زمان در خطر بلند، توقفگاه‌های امن، نقاط پشتیبانی، پوسته‌های کنترول، اخطارهای مسیر و منحنی ریسک. **ویرایش دستی مسیر** با
  افزودن، کشیدن و حذف نقاط عبور روی نقشه، برگشت، و ارزیابی دوبارهٔ خودکار؛ ویرایش پلان تأییدشده آن را دوباره برای تأیید می‌فرستد.
- **چند شعبه:** مزار شریف (مرکز)، کابل و هرات با معلومات جداگانه؛ دسترسی کاربران به هر شعبه با نقش همان شعبه؛ کارمندان منطقه‌ای
  همهٔ شعبه‌ها را فقط می‌خوانند. هماهنگ‌سازی معلومات ضروری بین شعبه‌ها (اخطارهای بحرانی، رویدادهای تأییدشده، وضعیت پلان‌ها،
  رهنمودهای مرکز) با حذف تکرار و اعتبار جدیدترین نسخه، و راپور جداگانه برای هر شعبه (JSON، CSV و HTML قابل چاپ).
- **سه زبان:** دری (معیار افغانستان)، پشتو و انگلیسی در همهٔ بخش‌ها، پیام‌ها، راپورها و اخطارها. تغییر زبان در همهٔ صفحات بدون
  بارگذاری دوباره انجام می‌شود و ترجیح کاربر روی سرور ذخیره می‌گردد؛ ارقام افغانی و تقویم هجری شمسی.
- **طراحی «Lapis Signal»:** نمای تاریک و روشن، طیف ریسک مناسب برای افراد کوررنگ، واکنش‌گرا برای موبایل، تبلیت، دسکتاپ و دیوار نمایش.

### حساب‌های نمایشی

گذرواژهٔ همه `demo` است (قابل تغییر با `DEMO_PASSWORD`).

| کاربر | نقش و شعبه |
|---|---|
| `ahmadi` | قوماندان مرکز مزار شریف — منطقه‌ای (خواندن همهٔ شعبه‌ها) |
| `maryam` | اپراتور مزار شریف |
| `reza` | تحلیلگر امنیتی مزار شریف |
| `ali` | پلانگذار اسکورت مزار شریف و کابل (ترجیح زبان: پشتو) |
| `sara` | تیم تخنیکی مزار شریف و هرات |
| `karimi` · `farida` | قوماندان · اپراتور کابل |
| `sultani` · `wahidi` | قوماندان · اپراتور هرات |
| `admin` | مدیر سیستم (همهٔ شعبه‌ها) |

در `NODE_ENV=production` تعیین `JWT_SECRET` لازمی است و تبدیل نقش نمایشی (`DEMO_MODE`) به‌طور پیش‌فرض غیرفعال است.

### تنظیمات

| متغیر | کاربرد |
|---|---|
| `MAP_STYLE_URL` | آدرس سبک نقشهٔ برداری (پیش‌فرض OpenFreeMap liberty) |
| `MAP_TERRAIN_URL`، `MAP_TERRAIN_ENCODING` | کاشی‌های DEM برای عوارض زمین (terrarium یا mapbox) |
| `BRANCHES` | شعبه‌های فعال، مثلاً `MZR,KBL,HRT` |
| `OSM_DIR` | پوشهٔ معلومات OpenStreetMap (پیش‌فرض `services/data/osm`) |
| `RATE_LIMIT_RPM` | حد درخواست در دقیقه برای هر آدرس IP |

برای استقرار کاملاً آفلاین، کاشی‌های نقشه و DEM را روی سرور داخلی میزبانی و آدرس‌ها را تنظیم کنید. معلومات سرک‌ها و محل‌های
هر شعبه با `npm run fetch:osm` (یا `make osm`) از OpenStreetMap دریافت و در مخزن ذخیره می‌شود تا کنسول بدون انترنت کار کند.

### میان‌برها

`Alt+1…6` بخش‌های کاری، `Ctrl+K` جستجو و فرمان، `Esc` بستن. از منوی حساب: زبان، نمای رنگ، نقش نمایشی، «شبیه‌سازی قطع شبکه»
و «نمایش آدرس‌های API».

### تصاویر

| زنده (دری، تاریک) | تحلیل سه‌بعدی ریسک |
|---|---|
| ![زنده](docs/screenshots/live.png) | ![تحلیل](docs/screenshots/analysis.png) |
| **ویرایش مسیر (پشتو، روشن)** | **کابل با عوارض زمین (فقط خواندن)** |
| ![پلانگذاری](docs/screenshots/planning.png) | ![کابل](docs/screenshots/branch-kabul.png) |

## زیرساخت کامل با Docker

پیش‌نیازها: Docker و Docker Compose، Git، Node.js 20+ و در صورت خواست Make.

```bash
git clone https://github.com/jansayed812-byte/anti-assassination-
cd anti-assassination-
make setup     # ساختن .env
make up        # آغاز سرویس‌ها
make health    # بررسی صحت
make console   # کنسول عملیات روی http://localhost:8000
```

| سرویس | پورت | توضیح |
|---|---|---|
| PostgreSQL | 5432 | دیتابیس اصلی + PostGIS |
| TimescaleDB | 5433 | معلومات سری زمانی |
| NATS | 4222 / 8222 | شبکهٔ پیام‌رسانی و مدیریت آن |
| Redis | 6379 | کش و وضعیت کوتاه‌مدت |
| MinIO | 9000 / 9001 | ذخیرهٔ فایل‌ها و کنسول آن |
| کنسول عملیات | 8000 | UI + REST + WebSocket |

## ساختار پروژه

```
dashboard/src/
  app/        Shell واکنش‌گرا، actions، roles، permissions، hooks
  map/        MapView (MapLibre، lazy)، MapControls، geo
  workspaces/ live · analysis · planning · sim · assets · admin
  i18n/       dr.json · ps.json · en.json
  styles/     theme.css (نشانه‌های طراحی) · app.css
services/server/
  app.ts            REST + Socket.IO، شعبه‌ها، هماهنگ‌سازی، راپورها
  branch-context.ts همه‌چیز یک شعبه (ریسک، پلان‌ها، واحدها، دستگاه‌ها، نقاط کور، شبیه‌سازی)
  geodata/          شعبه‌ها، بارگذاری OSM، شهر ساختگی
  routing/          گراف سرک‌ها، A*، پلانگذار PACE
  domain/           alerts، risk (H3)، blindspots، plans، units، devices، detections، sim، users، admin
  i18n/             پیام‌های سه‌زبانه
  sync.ts · reports.ts · seed.ts
services/{auth,comms,fusion,threat,vision,simulation,intel}/  ماژول‌های پلتفرم
scripts/fetch-osm.mjs                                          دریافت معلومات OpenStreetMap
tests/{unit,integration,perf,e2e}/                             آزمایش‌ها
```

## امنیت

```bash
cp .env.example .env
# گذرواژه‌های پیش‌فرض و JWT_SECRET را تغییر دهید
```

---

### English summary

Operations console for protective security in Afghanistan: a realistic 3D map (MapLibre + OpenStreetMap + terrain)
centred on Mazar-i-Sharif, an H3 risk grid with ranked most-dangerous and safest sites, automatic blind-spot
detection (network, monitoring, access) with per-zone reports, risk-aware PACE escort routing with manual route
editing, multi-branch tenancy (Mazar-i-Sharif HQ, Kabul, Herat) with inter-branch sync and per-branch reports, and a
fully trilingual interface (Dari, Pashto, English) with an in-place language switcher and a per-user saved preference.
Run `npm run setup && npm run build && npm start` and open http://localhost:8000 (e.g. user `ahmadi`, password `demo`).
