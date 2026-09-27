---
agent: devin-local
session: healthy-heat
created: 2026-09-27T19:37:26Z
---
# اجرای لایه به لایه پلن جدید سامانه امنیتی عملیاتی

برنامه پیاده‌سازی جامع پلن جدید cleaned-operational-security-platform.md روی پروژه موجود با تغییرات اساسی در معماری، فناوری‌ها و قابلیت‌ها

## وضعیت فعلی vs پلن جدید

### تفاوت‌های کلیدی

**معماری و زیرساخت:**
- **فعلی**: PostgreSQL + PostGIS، Redis، ساختار monorepo ساده
- **جدید**: تغییر کامل به ساختار سرویس‌محور، NATS JetStream/Kafka، TimescaleDB، Object Storage، Edge Collector

**نقشه و سه‌بعدی:**
- **فعلی**: Leaflet برای نقشه دوبعدی
- **جدید**: پیاده‌سازی هر دو - Leaflet (دوبعدی) + CesiumJS (سه‌بعدی) با terrain و 3D Tiles

**جریان داده:**
- **فعلی**: WebSocket ساده، قرارداد رویداد استاندارد ندارد
- **جدید**: NATS JetStream/Kafka Message Bus، قرارداد رویداد پایه با ساختار مشخص، WebSocket channels خاص

**ساختار پروژه:**
- **فعلی**: monorepo ساده با backend/frontend
- **جدید**: ساختار سرویس‌محور با پوشه‌های جداگانه برای هر سرویس

**قابلیت‌های جدید:**
- موتور شبیه‌سازی با YAML
- تحلیل ویدئو پیشرفته (WebRTC، GStreamer، MediaMTX)
- Fusion پیشرفته (GNSS چندمنظومه، Wi-Fi RTT، BLE beacon، INS/IMU)
- موتور ریسک با فرمول علمی
- موتور سناریو
- تحلیل مکانی پیشرفته

## فاز ۱: زیرساخت پایه پیشرفته

### ۱.۱ تغییر ساختار پروژه به سرویس‌محور
- ایجاد ساختار جدید:
  ```
  ops-security-platform/
  ├── services/
  │   ├── fusion/
  │   ├── threat/
  │   ├── planning/
  │   ├── vision/
  │   ├── simulation/
  │   ├── comms/
  │   ├── intel/
  │   └── auth/
  ├── dashboard/
  ├── scenarios/
  ├── models/
  ├── map-data/
  ├── tests/
  │   ├── unit/
  │   ├── integration/
  │   ├── load/
  │   └── endurance/
  └── k8s/
  ```
- انتقال کد موجود به ساختار جدید
- ایجاد Dockerfile جداگانه برای هر سرویس

### ۱.۲ اضافه کردن سرویس‌های جدید به Docker Compose
- اضافه کردن NATS JetStream
- اضافه کردن TimescaleDB
- اضافه کردن MinIO (Object Storage)
- تنظیم شبکه داخلی سرویس‌ها
- تنظیم health checkها

### ۱.۳ تنظیمات محیطی و migration
- ایجاد فایل `.env.example` کامل
- فایل‌های migration برای PostgreSQL و TimescaleDB
- تنظیمات health check

## فاز ۲: پیاده‌سازی Message Bus و قرارداد رویداد

### ۲.۱ سرویس NATS JetStream
- اتصال به NATS
- ایجاد streamها و consumerها
- پیاده‌سازی قرارداد رویداد پایه:
  ```json
  {
    "event_id": "uuid",
    "source_id": "gnss-07",
    "source_type": "gnss",
    "captured_at": "2026-09-27T12:00:00.000Z",
    "received_at": "2026-09-27T12:00:00.084Z",
    "sequence": 18420,
    "quality": {"fix": "3d", "hdop": 0.9, "confidence": 0.98},
    "payload": {"lat": 0, "lon": 0, "alt_m": 0, "speed_mps": 0},
    "integrity": {"hash": "sha256:...", "signature": "..."}
  }
  ```

### ۲.۲ Edge Collector
- دریافت داده از حسگرها
- Local Buffer برای قطعی شبکه
- ارسال رویدادهای نسخه‌دار و قابل تکرار

## فاز ۳: Fusion پیشرفته موقعیت

### ۳.۱ سرویس Fusion جدید
- پشتیبانی از GNSS چندمنظومه (GPS، GLONASS، BeiDou، Galileo)
- اضافه کردن Wi-Fi RTT
- اضافه کردن BLE beacon
- اضافه کردن داده سلولی
- پیاده‌سازی INS/IMU برای پیش‌بینی کوتاه‌مدت

### ۳.۲ الگوریتم پیشرفته
- تبدیل به دستگاه محلی ENU
- هم‌ترازسازی زمانی
- اعتبارسنجی schema، timestamp، sequence
- پیش‌بینی با INS و تصحیح با covariance واقعی
- شناسایی داده پرت با residual و Mahalanobis gating
- نمایش drift در حالت INS خالص

### ۳.۳ API endpoints جدید
- `POST /v1/locations/analyze`
- `GET /v1/telemetry/latest`
- ذخیره‌سازی در TimescaleDB

## فاز ۴: موتور ریسک و رخداد

### ۴.۱ موتور ریسک علمی
- پیاده‌سازی فرمول: `risk = severity × likelihood × exposure × data_confidence`
- سطوح نمایشی: سبز، زرد، نارنجی، قرمز
- افزودن provenance و توضیح برای خروجی‌ها

### ۴.۲ ساختار رخداد پیشرفته
- منبع، زمان مشاهده، محدوده مکانی
- confidence، عمر اعتبار، evidence
- وضعیت تأیید انسانی

### ۴.۳ API endpoints
- `GET /v1/risk/grid`
- WebSocket: `wss://gateway.example/v1/stream/risk`

## فاز ۵: نقشه دوبعدی و سه‌بعدی

### ۵.۱ حفظ و بهبود Leaflet (دوبعدی)
- حفظ کامپوننت Map فعلی با Leaflet
- بهبود integration با سرویس‌های جدید
- افزودن لایه‌های ریسک و رخدادها
- پشتیبانی از آفلاین با tileهای محلی

### ۵.۲ اضافه کردن CesiumJS (سه‌بعدی)
- نصب CesiumJS در frontend
- ایجاد کامپوننت Map3D جدید
- بارگذاری tileهای برداری، DEM، 3D Tiles
- پرواز دوربین به موقعیت
- فعال‌سازی terrain و ساختمان‌های سه‌بعدی

### ۵.۳ قابلیت‌های مشترک نقشه
- دریافت نام مکان یا مختصات
- تبدیل ورودی به مختصات معتبر
- نمایش مسیر، موقعیت تیم، رخدادها
- لایه ریسک و عدم‌قطعیت
- قابلیت تغییر بین دوبعدی و سه‌بعدی

### ۵.۴ API endpoints
- `POST /v1/locations/analyze` (برای تبدیل مختصات)

## فاز ۶: موتور شبیه‌سازی

### ۶.۱ سرویس شبیه‌سازی
- پشتیبانی از YAML نسخه‌گذاری
- ساختار سناریو:
  - شناسه و نسخه
  - هدف آموزشی
  - محیط و شرایط جوی
  - رخدادها و triggerها
  - اهداف و معیار موفقیت
  - نقش‌ها و سطح دسترسی
  - مسیر توقف امن
  - داده مصنوعی

### ۶.۲ اجرای سناریو
- حداقل ۵۰ سناریوی آزمایشی
- گروه‌بندی: محیطی، ارتباطی، زیرساختی، امدادی، پایش
- جداسازی از سامانه واقعی
- گزارش پایان با timeline، زمان تشخیص، زمان بازیابی

### ۶.۳ API endpoints
- `POST /v1/scenarios/runs`
- `GET /v1/scenarios`
- `GET /v1/reports/{id}`

## فاز ۷: لایه ارتباطی پیشرفته

### ۷.۱ Adapterهای جداگانه
- MAVLink read-only با allow-list
- REST برای IoT و trackerها
- WebSocket برای تله‌متری و هشدار
- LTE/5G gateway
- صف محلی SQLite/WAL

### ۷.۲ رویدادهای پیشرفته
- شناسه یکتا، sequence، timestamp
- checksum و idempotency key
- جلوگیری از رویداد تکراری

### ۷.۳ WebSocket channels
- `wss://gateway.example/v1/stream/telemetry`
- `wss://gateway.example/v1/stream/risk`
- `wss://gateway.example/v1/stream/alerts`
- heartbeat، sequence، reconnect با backoff

## فاز ۸: تحلیل ویدئو پیشرفته

### ۸.۱ سرویس ویدئو
- WebRTC برای انتقال
- GStreamer برای پردازش
- MediaMTX برای streaming

### ۸.۲ خروجی detection
- شناسه جریان و frame
- timestamp و نسخه مدل
- کلاس و confidence
- bounding box
- وضعیت حرکت یا ورود به محدوده
- دلیل تولید هشدار

### ۸.۳ اندازه‌گیری عملکرد
- decode latency، bitrate، dropped frames
- memory و end-to-end latency
- تأیید ادعای 4K/30

## فاز ۹: تحلیل مکانی پیشرفته

### ۹.۱ سرویس تحلیل مکانی
- بررسی داده‌های مجاز در شعاع مشخص
- رخدادهای تاریخی مجاز
- مراکز امدادی و خدماتی
- ورودی‌ها و خروجی‌های ثبت‌شده
- محدودیت‌های مکانی و محیطی

### ۹.۲ گزارش تحلیل
- risk score، confidence، سطح
- فهرست منابع، فاصله، تاریخ داده
- توصیه‌های غیرتهاجمی کاهش ریسک
- کالیبراسیون confidence بالاتر از ۹۰٪

## فاز ۱۰: هویت، دسترسی و gateway پیشرفته

### ۱۰.۱ کنترل‌های امنیتی
- SSO یا هویت سازمانی
- MFA
- RBAC/ABAC با اصل کمترین اختیار
- access token کوتاه‌مدت و refresh امن
- rate limiting و schema validation
- mTLS در ارتباطات حساس

### ۱۰.۲ Audit و امنیت
- audit append-only با chain hash
- چرخش کلید در KMS/HSM
- جداسازی شبکه دستگاه، سرویس، UI
- ماتریس کنترل NIST و الزامات سازمانی

## فاز ۱۱: تجربه کاربری پیشرفته

### ۱۱.۱ داشبورد دوبعدی و سه‌بعدی
- نقشه دوبعدی (Leaflet) و سه‌بعدی (CesiumJS)
- لایه ریسک و رخدادها
- پنل ویدئو با detection
- پنل سناریو و گزارش
- هشدارهای بصری و صوتی

### ۱۱.۲ قابلیت‌های UX
- حالت آفلاین و صف همگام‌سازی
- دسترسی‌پذیری صفحه‌کلید
- کنتراست و متن جایگزین
- رنگ‌ها فقط برای اولویت دیداری

## فاز ۱۲: آزمون، CI/CD و استقرار

### ۱۲.۱ تست‌ها
- unit test برای تبدیل مختصات، fusion، ریسک
- integration test برای message bus، database
- contract test برای REST، WebSocket
- تست بار ۱۰۰ کاربر همزمان
- تست قطعی شبکه، packet loss، jitter
- تست امنیتی مجاز
- تست endurance ۷۲ ساعته

### ۱۲.۲ CI/CD
- pipeline lint، test، scan، build، deploy
- image scan و secret detection
- rolling update و health check

### ۱۲.۳ Kubernetes
- ساختار k8s برای استقرار تولیدی
- Helm charts یا manifests

## ترتیب اجرای پیشنهادی

1. **زیرساخت پایه پیشرفته** (فاز ۱)
2. **Message Bus و قرارداد رویداد** (فاز ۲)
3. **Fusion پیشرفته موقعیت** (فاز ۳)
4. **موتور ریسک و رخداد** (فاز ۴)
5. **نقشه دوبعدی و سه‌بعدی** (فاز ۵)
6. **موتور شبیه‌سازی** (فاز ۶)
7. **لایه ارتباطی پیشرفته** (فاز ۷)
8. **تحلیل ویدئو پیشرفته** (فاز ۸)
9. **تحلیل مکانی پیشرفته** (فاز ۹)
10. **هویت، دسترسی و gateway پیشرفته** (فاز ۱۰)
11. **تجربه کاربری پیشرفته** (فاز ۱۱)
12. **آزمون، CI/CD و استقرار** (فاز ۱۲)

## فایل‌های اصلی برای تغییر/ایجاد

### تغییرات اساسی:
- `docker-compose.yml` - اضافه کردن سرویس‌های جدید
- ساختار پروژه - تغییر به سرویس‌محور
- `backend/` - بازنویسی سرویس‌ها
- `frontend/` - اضافه کردن CesiumJS (حفظ Leaflet)

### فایل‌های جدید:
- `services/fusion/` - سرویس fusion پیشرفته
- `services/threat/` - موتور ریسک پیشرفته
- `services/planning/` - برنامه‌ریزی مسیر
- `services/vision/` - تحلیل ویدئو
- `services/simulation/` - موتور شبیه‌سازی
- `services/comms/` - لایه ارتباطی پیشرفته
- `services/intel/` - تحلیل مکانی
- `scenarios/` - فایل‌های YAML سناریو
- `tests/unit/`، `tests/integration/`، `tests/load/`، `tests/endurance/`
- `k8s/` - manifests Kubernetes

## ریسک‌ها و ملاحظات

1. **پیچیدگی بالا**: تغییر از ساختار ساده به معماری پیچیده
2. **زمان اجرا**: این یک پروژه بزرگ است که نیاز به زمان قابل توجهی دارد
3. **نیاز به سخت‌افزار**: GPU برای CesiumJS و ML، منابع برای TimescaleDB
4. **تغییر API**: نیاز به بازنویسی کل API endpoints
5. **یادگیری فناوری‌های جدید**: CesiumJS، NATS، TimescaleDB، GStreamer
6. **مهاجرت داده**: انتقال داده از ساختار فعلی به ساختار جدید

## پیشنهاد برای شروع

پیشنهاد می‌شود از فاز ۱ (زیرساخت پایه پیشرفته) شروع کنیم و به تدریج جلو برویم تا بتوانیم هر فاز را قبل از رفتن به فاز بعدی تست و تأیید کنیم.
