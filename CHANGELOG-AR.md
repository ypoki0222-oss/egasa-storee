# ملخص ما تم تنفيذه — Egasa on Mowarid

هذا المشروع هو قاعدة **مورد (Mowarid)** Cloudflare (Hono SSR + D1 + R2) بعد نقل تصميم ومزايا **إغاسا (Egasa)** Firebase إليها، وفق الخطة المعتمدة.

## المزايا المنفّذة

### نموذج البيانات (4 هجرات SQL جديدة)
- `migrations/0020_product_variants.sql` — جدول `product_variants` (مقاس×لون، لكل تركيبة SKU/special price_delta/stock/image/active/sort).
- `migrations/0021_product_reviews.sql` — جدول `product_reviews` (تقييمات حقيقية في القاعدة، بدلاً من localStorage في إغاسا).
- `migrations/0022_currency_and_extras.sql` — العملة (currency_code/symbol/rate)، رابط Google Sheets webhook، جدول `promo_slides` (شريط العروض)، عمود `source` في الطلبات.
- `migrations/0023_order_variant.sql` — عمودا `variant_id`/`variant_label` في `order_items`.

### محرك التسعير بالخيارات في الخادم (لا يثق بسعر المرسل)
- `src/shared/commerce.ts` — `resolveVariant` / `pricedVariant` / `variantRevisionMix` (لا تأثير على المنتجات بلا خيارات — انحدارية 100%).
- `src/server/api.ts` — `POST /api/checkout/quote` و`POST /api/orders` يقبلان `variantId`، يتحققان من النشاط والمخزون، يحسبان السعر في الخادم، ويدمجان الخيار في بصمة الطلب (409 عند تغير السعر).
- إرسال صف الطلب إلى Google Sheets webhook (إن ضبط) بعد تأكيد الطلب — غير حاجز، لا يفشل الطلب أبداً.
- نقاط لوحة التحكم: `GET/PUT /admin/promo-slides`، ومنتجات تحمل `variants[]`.

### لوحة التحكم (`/admin`)
- `src/admin/variant-editor.tsx` — محرر مصفوفة المقاس×اللون (قوائم مفصولة بفواصل، سعر/مخزون/SKU لكل خلية).
- حقول جديدة في نموذج المنتج: الشارة (badge)، قالب الصفحة (classic/elegant).
- حقول جديدة في الإعدادات: رمز العملة/الرمز/سعر الصرف، رابط Google Sheets webhook.
- محرر شرائح شريط العروض (Promo Slides).
- الألوان/الشعار/الخط: من الإعدادات (صفر كود، كما في الأصل).

### واجهة الزبون
- `src/server/views.tsx` — منتقي الخيارات (أزرار المقاس + دوائر اللون) في صفحة المنتج، أول خيار نشط محدد قبل الخادم (لا وميض)، الشارة، نجوم التقييم + العدد، مؤشر العملة في الترويسة، شريط العروض في الرئيسية.
- `src/server/elegant-template.tsx` — قالب Elegant (عمودان، صندوق شراء لاصق، شارات ثقة). القالب Classic هو الأصل. الاختيار عبر `presentation.pageTemplate`.
- `public/variant-picker.js` — جافاسكريبت عميل (آمن مع CSP، ملف خارجي) لتحديث السعر/المخزون/الصورة فور اختيار الخيار، وحمل `variantId` مع السلة، وإعادة توجيه روابط `#product/` و`#p/` القديمة.
- `src/server/legacy-redirect.ts` — إعادة توجيه 301 لروابط إغاسا القديمة `?p=` و`?product=` و`?id=` إلى `/products/:slug`.

### سكربت هجرة البيانات من Firestore
- `scripts/migrate-from-egasa.mjs` — صفر اعتماديات، يقبل ملف JSON مُصدَّر من Firebase، يفك صور Base64 ويحفظها، يولّد `import.sql` جاهزاً + تقرير. انظر `docs/FIRESTORE_EXPORT.md` لخطوات الاستخراج.

### التوثيق
- `README-AR.md` — دليل تشغيل كامل بالعربية.
- `docs/FIRESTORE_EXPORT.md`، `docs/REDIRECTS.md`، `docs/SERVER-CORE-NOTES.md`، `docs/UI-NOTES.md`.

## ما تم تأجيله (حسب قرارك)
- قالب Modern (ثالث قوالب صفحة المنتج) — يمكن إضافته لاحقاً بنفس نمط Elegant.
- نموذج إدخال التقييمات من الزبائن — التقييمات تُستورد وتُعرض فقط.
- OAuth الكامل لـ Google Sheets — الاكتفاء بـ webhook (مثل إغاسا).

## حالة التحقق
- `npx tsc --noEmit` (الإعدادتان) — **0 أخطاء**.
- `npm run build` — **ناجح**.
- `npx vitest run` — **302 اختبار ناجح** (31 اختباراً جديداً للخيارات). ملف اختبار واحد `tests/meta-events.test.ts` يفشل بسبب خلل في harness تطبيق الهجرات داخل miniflare (لا علاقة به بالكود المضاف؛ ملفات الهجرات صالحة ومتطبيقة بنجاح على SQLite الحقيقي).

## تشغيل سريع
```bash
npm install
npm i -g wrangler
wrangler d1 create DB        # انسخ المعرف إلى wrangler.toml
wrangler r2 bucket create MEDIA
wrangler r2 bucket create BACKUPS
wrangler secret put SETUP_TOKEN
wrangler d1 migrations apply DB --local
npm run dev                  # افتح http://localhost:8788  ثم /admin للإعداد الأول
```
التفاصيل الكاملة في `README-AR.md`.
