# تصدير بيانات Egasa من Firestore وتشغيل المهاجر

هذا الدليل يشرح خطوة بخطوة كيف تُخرِج بيانات متجر Egasa (المنتجات والطلبات والإعدادات) من Firebase Firestore إلى ملف JSON، ثم تشغيل `scripts/migrate-from-egasa.mjs` لتحويلها إلى صيغة Mowarid (D1 + R2).

## 1) المتطلبات

- Node.js الإصدار 22 أو أحدث.
- الوصول إلى مشروع Firebase الذي يحتوي متجر Egasa.
- (اختياري) حساب خدمة (service account) للتصدير الآلي.

## 2) الطريقة الأولى: التصدير اليدوي من Firebase Console

1. افتح [Firebase Console](https://console.firebase.google.com/) واختر مشروع Egasa.
2. اذهب إلى **Build → Firestore Database**.
3. ستجد المجموعات الثلاث الرئيسية:
   - `products` (المنتجات)
   - `orders` (الطلبات)
   - `settings` (وثيقة `global` أو مجموعة settings)
4. انسخ بيانات كل مجموعة يدوياً أو استخدم أداة التصدير. الطريقة الأسرع والأكثر ثقة هي الطريقة الآتية بأداة `firestore-export-json`.

## 3) الطريقة الثانية (موصى بها): التصدير الآلي بمفتاح حساب الخدمة

### أ) الحصول على مفتاح حساب الخدمة (Service Account Key)

1. في Firebase Console: أيقونة الترس ⚙️ → **Project settings** → **Service accounts**.
2. انقر **Generate new private key** ثم **Generate key**.
3. يُنزَّل ملف JSON (مثل `egasa-firebase-adminsdk-xxxx.json`). **احتفظ به سراً** — لا ترفعه لأي مستودع عام.

### ب) تثبيت أداة التصدير وتشغيلها

من داخل مجلد المشروع (أي مجلد مؤقت):

```bash
npm install -g firestore-export-json
# أو تشغيل مباشر بدون تثبيت:
npx firestore-export-json
```

أنشئ ملف `export-config.json`:

```json
{
  "serviceAccount": "./egasa-firebase-adminsdk-xxxx.json",
  "collections": ["products", "orders", "settings"],
  "output": "./egasa-export.json"
}
```

ثم نفّذ:

```bash
npx firestore-export-json -c export-config.json
```

النتيجة: ملف `egasa-export.json` بالشكل المتداخل الذي يتوقعه المهاجر تلقائياً:

```json
{
  "products": { "<product-id>": { ... } },
  "orders":   { "<order-id>": { ... } },
  "settings": { "global": { ... } }
}
```

> ملاحظة: المهاجر يقبل أيضاً الشكل المسطّح `{ "products": [...], "orders": [...], "settings": {...} }` ويكتشف الشكل تلقائياً، فلا داعي للقلق إن اختلفت الأداة.

### ج) بديل بسيط بدون أداة خارجية: سكربت Node صغير

إذا لم ترغب باستخدام `firestore-export-json`، أنشئ `export.mjs` مع تثبيت `firebase-admin`:

```bash
npm install firebase-admin
```

```js
// export.mjs
import admin from 'firebase-admin';
import fs from 'node:fs';
import serviceAccount from './egasa-firebase-adminsdk-xxxx.json' assert { type: 'json' };

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const out = {};
for (const col of ['products', 'orders', 'settings']) {
  const snap = await db.collection(col).get();
  out[col] = {};
  snap.forEach((d) => { out[col][d.id] = d.data(); });
}
fs.writeFileSync('egasa-export.json', JSON.stringify(out, null, 2));
console.log('تم التصدير:', Object.keys(out.products).length, 'منتج');
process.exit(0);
```

```bash
node export.mjs
```

## 4) تشغيل المهاجر

```bash
# تجربة جافة (عدّادات فقط، بدون كتابة ملفات):
node scripts/migrate-from-egasa.mjs --input egasa-export.json --dry-run

# تشغيل فعلي:
node scripts/migrate-from-egasa.mjs --input egasa-export.json --outdir migration-out
```

المخرجات في `migration-out/`:

| الملف | الوصف |
| --- | --- |
| `import.sql` | أوامر INSERT ملفوفة داخل معاملة، جاهز للتطبيق على D1. |
| `media/` | الصور المفكّكة من base64 (`<slug>-<n>.<ext>`). |
| `media-manifest.json` | خريطة كل صورة (مستخرجة أم تحتاج رفعاً يدوياً). |
| `migration-report.json` | العدّادات + التحذيرات + الأخطاء + الخطوات التالية. |

## 5) رفع الوسائط إلى R2

Mowarid يقدّم الصور من حزمة R2 باسم `MEDIA` عبر المسار `/media/:id`.

```bash
# تسجيل الدخول (مرة واحدة)
npx wrangler login

# رفع ملف واحد (اسم الكائن يُفضّل أن يكون UUID.webp):
npx wrangler r2 object put MEDIA/<uuid>.webp --file migration-out/media/leather-gloves-0.png

# أو رفع كل الصور دفعة واحدة (bash):
for f in migration-out/media/*; do
  uuid=$(node -e "console.log(crypto.randomUUID())")
  npx wrangler r2 object put MEDIA/$uuid.webp --file "$f"
  echo "$f -> MEDIA/$uuid.webp"
done
```

> نصيحة: حوّل الصور إلى webp قبل الرفع لتقليل الحجم (انظر سطر sharp الموجود في تعليقات أعلى ملف المهاجر). بعد الرفع، حدّد حقول `products.image` و `products.gallery` و `product_variants.image_id` بمعرّفات الوسائط الجديدة بالرجوع إلى `media-manifest.json` — أو ارفعها من لوحة تحكم `/admin` مباشرة.

## 6) تطبيق `import.sql` على قاعدة البيانات

```bash
# محلياً (للاختبار):
npx wrangler d1 execute DB --local --file migration-out/import.sql

# على الإنتاج (بعد التأكد من صحة البيانات):
npx wrangler d1 execute DB --remote --file migration-out/import.sql
```

## 7) التحقق النهائي

1. افتح `/admin` وتحقق من ظهور المنتجات والتصنيفات.
2. افتح صفحة منتج وتحقق من المتنوعات (الأحجام/الألوان) والتقييمات.
3. أجرِ طلباً تجريبياً وتحقق من ظهوره في قائمة الطلبات بجانب الطلبات المؤرشفة (الموسومة `source = egasa-import`).
4. إذا لزم الأمر، أعد تشغيل المهاجر — فهو ثابت (idempotent) بفضل `INSERT OR IGNORE`.
