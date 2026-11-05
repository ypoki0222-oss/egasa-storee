# دليل التشغيل الكامل — Mowarid (بالعربية)

متجر Mowarid يعمل على Cloudflare: **Worker** للخادم (Hono) + **D1** لقاعدة البيانات + **R2** لتخزين الصور. هذا الدليل يشرح التشغيل من الصفر خطوة بخطوة.

## المتطلبات الأساسية

1. **Node.js** الإصدار 22.12.0 أو أحدث (يُفضّل 22 LTS).
   ```bash
   node --version
   ```
2. **Wrangler** (أداة Cloudflare):
   ```bash
   npm install -g wrangler
   wrangler login
   ```
3. حساب Cloudflare نشط (الخطة المجانية تكفي للبدء).

---

## الخطوة 1: تثبيت الحزم

```bash
cd mowarid-store
npm install
```

## الخطوة 2: إنشاء قاعدة البيانات D1

```bash
wrangler d1 create DB
```

سيُظهر الأمر `database_id`. انسخه والصقه في `wrangler.toml` ضمن قسم `[[d1_databases]]`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "DB"
database_id = "<المعرف الذي نسخته>"
migrations_dir = "migrations"
```

## الخطوة 3: إنشاء حزم R2 للوسائط والنسخ الاحتياطية

```bash
wrangler r2 bucket create MEDIA
wrangler r2 bucket create BACKUPS
```

(أسماء الربط في `wrangler.toml` هي `MEDIA` و `BACKUPS` — تأكد من تطابق الأسماء.)

## الخطوة 4: ضبط سر التثبيت SETUP_TOKEN

اختر عبارة سرية طويلة (24 حرفاً على الأقل) ستدخلها مرة واحدة لإنشاء حساب المدير:

```bash
wrangler secret put SETUP_TOKEN
# اكتب السر عند الطلب (محلياً يمكنك وضعها في .dev.vars)
```

محلياً: انسخ `.dev.vars.example` إلى `.dev.vars` وضع السر فيه.

## الخطوة 5: تطبيق ترحيلات قاعدة البيانات

```bash
# محلياً (للتطوير):
wrangler d1 migrations apply DB --local
# أو عبر الاختصار:
npm run db:migrate

# على الإنتاج (بعد التأكد):
wrangler d1 migrations apply DB --remote
```

## الخطوة 6: التشغيل محلياً

```bash
npm run dev
# أو: wrangler dev --port 8788
```

افتح المتصفح على `http://localhost:8788`.

## الخطوة 7: الإعداد الأول (إنشاء حساب المدير)

1. افتح `http://localhost:8788/admin`.
2. أدخل `SETUP_TOKEN` الذي حددته.
3. أنشئ بريد المدير وكلمة المرور.
4. من لوحة التحكم أضف إعدادات المتجر (الاسم، الواتساب، الشحن، البكسلات...).

## الخطوة 8: النشر على الإنتاج

```bash
npm run deploy
# أو مباشرة: wrangler deploy
```

بعد النشر، طبّق الترحيلات عن بُعد (`--remote`) إن لم تفعل، ثم افتح `/admin` على النطاق الرسمي وأكمل الإعداد.

---

## استيراد بيانات متجر Egasa القديم

إذا كنت تنتقل من Egasa (Firebase):

1. صدّر بيانات Firestore إلى JSON — انظر **`docs/FIRESTORE_EXPORT.md`** بالتفصيل.
2. شغّل المهاجر:
   ```bash
   node scripts/migrate-from-egasa.mjs --input egasa-export.json --outdir migration-out
   ```
3. ارفع صور `migration-out/media/` إلى R2 (انظر نفس الدليل).
4. طبّق البيانات:
   ```bash
   wrangler d1 execute DB --remote --file migration-out/import.sql
   ```
5. روابط Egasa القديمة: انظر **`docs/REDIRECTS.md`** لجدول التحويل 301 الذي يطبّقه الخادم.

---

## الاختبار بعد التثبيت

1. افتح الصفحة الرئيسية وتأكد من ظهور المتجر بالعربية.
2. من `/admin` أنشئ منتجاً يحتوي على **حجمين ولونين** (متنوعات).
3. افتح صفحة المنتج واختبر اختيار الحجم/اللون.
4. أجرِ **طلباً تجريبياً** (COD) وتأكد من ظهوره في قائمة الطلبات.
5. ارفع صورة من لوحة الوسائط وتأكد من عرضها عبر `/media/<id>`.
6. شغّل الاختبارات الآلية إن رغبت: `npm test`.

---

## الأوامر المفيدة

| الأمر | الوظيفة |
| --- | --- |
| `npm run dev` | تشغيل محلي مع بناء تلقائي. |
| `npm run build` | بناء الإنتاج (لا تحتاجه للتطوير اليومي). |
| `npm run deploy` | النشر إلى Cloudflare. |
| `npm run db:migrate` | تطبيق الترحيلات محلياً. |
| `wrangler d1 execute DB --local --command "SELECT * FROM products"` | استعلام سريع محلي. |
| `wrangler tail` | مشاهدة سجلات Worker المباشرة. |
| `node scripts/migrate-from-egasa.mjs --help` | مساعدة المهاجر. |

## استكشاف الأخطاء الشائعة

- **خطأ `no such table`**: لم تطبّق الترحيلات — نفّذ `wrangler d1 migrations apply DB --local` (أو `--remote`).
- **خطأ ربط R2**: تأكد من إنشاء الحزمتين `MEDIA` و `BACKUPS` وتطابق أسمائهما مع `wrangler.toml`.
- **`SETUP_TOKEN` غير صحيح**: أعد ضبط السر بـ `wrangler secret put SETUP_TOKEN` وتحقق من `.dev.vars` محلياً.
- **الصور لا تظهر**: تأكد من رفعها إلى R2 وأن `products.image` يشير إلى `/media/<uuid>`.
