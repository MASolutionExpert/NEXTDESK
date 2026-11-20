# NextDesk (نکست‌دسک)

**NextDesk** یک پیام‌رسان سازمانی و سیستم پشتیبانی (Helpdesk) خودمیزبان و بلادرنگ است که به‌صورت یکپارچه روی **Full-Stack Next.js 16** (App Router + سرور یکپارچه Express 5 / SSE / WebSocket + PostgreSQL/SQLite + ورکر مدیای FFmpeg) پیاده‌سازی شده است.

## امکانات کلیدی

- ⚡ **معماری یکپارچه Full-Stack Next.js 16**: یک سرور واحد (`server.mjs`) هم‌زمان فرانت‌اند Next.js App Router، تمام APIها، جریان بلادرنگ SSE (`/api/events`) و WebSocket (`/ws`) را سرویس می‌دهد.
- 🎧 **ماژول کامل پشتیبانی (Helpdesk)**: دپارتمان‌ها، نقش اپراتور، توزیع عادلانه درخواست‌ها (Round-Robin / Least-Busy)، صف گفتگوها و گزارش‌های مدیریتی.
- 💬 **پیام‌رسان کامل سازمانی**: پیام خصوصی، گروه، کانال، ریپلای، فوروارد، منشن، وضعیت خوانده‌شدن، کش آفلاین IndexedDB و PWA.
- 📞 **تماس صوتی و تصویری**: تماس WebRTC همراه با اشتراک‌گذاری صفحه و ابزار بررسی TURN.
- 📎 **مدیریت فایل و استوریج ابری**: پشتیبانی از حافظه محلی و S3 / Cloudflare R2 با رمزنگاری، ویس و تبدیل ویدئو با FFmpeg.
- 🌐 **دوزبانه بومی (فارسی و انگلیسی)**: پشتیبانی کامل RTL/LTR با فونت‌های Vazirmatn و DM Sans و انتخاب زبان برای هر کاربر.
- 🛡️ **لایه دیتابیس سخت‌سازی‌شده**: PostgreSQL (پیش‌فرض در سرور) و SQLite با ۴۳ مایگریشن idempotent، تایم‌اوت‌های Fail-Fast، بکاپ خودکار پیش از مایگریشن و ابزار تشخیصی صرفاً خواندنی `db:doctor`.

## نصب سریع روی سرور (Ubuntu 22.04 به بالا)

| کانال | برنچ | نسخه‌ها | دستور نصب |
|-------|------|---------|-----------|
| **اصلی / Stable** (پروداکشن) | `main` | `vX.Y.Z` | `curl -fsSL https://raw.githubusercontent.com/MASolutionExpert/NEXTDESK/main/scripts/install.sh \| bash` |
| **تست / Test** (پیش‌انتشار) | `dev` | `vX.Y.Z-dev.N` | `curl -fsSL https://raw.githubusercontent.com/MASolutionExpert/NEXTDESK/dev/scripts/install.sh \| REPO_BRANCH=dev bash` |

مدیریت کامل سرور با ابزار `nextdesk-deploy` (و معادل سازگار `chatdesk-deploy`):
- `nextdesk-deploy --status` — مشاهده نسخه نصب‌شده و کانال فعال (`dev` یا `main`).
- گزینه **2) Update** همیشه داخل همان کانال می‌ماند، ابتدا فایل‌های جدید را دریافت می‌کند و سپس نهایی‌سازی را به نسخه جدید اینستالر واگذار می‌کند (`--finalize-update`).
- گزینه **4) Switch channel** جابه‌جایی امن بین کانال تست (`dev`) و پایدار (`main`) را انجام می‌دهد.

## اجرای محلی (توسعه)

```bash
# نصب وابستگی‌ها (Node >= 24)
npm install
npm install --prefix server
npm install --prefix worker

# اجرای یکپارچه Full-Stack Next.js (فرانت + API + SSE + WebSocket)
npm run dev

# بیلد و اجرای نسخه پروداکشن
npm run build
npm start
```

## مجوز

MIT — فایل [LICENSE](./LICENSE) را ببینید.
