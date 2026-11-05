# تحويل روابط Egasa القديمة (301 Redirects)

متجر Egasa القديم يستخدم روابط على شكل استعلام أو هاش (`?p=...`, `#product/...`). Mowarid يستخدم روابط نظيفة `/products/<slug>`. لكي لا تضيع الزيارات القادمة من الإعلانات القديمة ومحركات البحث، يجب تطبيق تحويل دائم (301) من الأشكال القديمة إلى الجديدة.

## ⚠️ مهم: لماذا لا نستخدم `public/_redirects`؟

Mowarid يعمل على **Cloudflare Worker أولاً** (`run_worker_first` في `wrangler.toml` يشمل كل المسارات)، لذا ملف `_redirects` الثابت الخاص بـ Cloudflare Pages **لا يُطبَّق** — كل الطلبات تمر عبر الـ Worker (Hono). لذلك يجب تنفيذ التحويلات داخل كود الخادم في middleware Hono، وليس في ملف ثابت.

## جدول التحويل المطلوب (ينفّذه وكيل الخادم في Hono)

| شكل الرابط القديم | مثال | الوجهة (301) |
| --- | --- | --- |
| `?p=<slug>` | `https://old.example.com/?p=leather-gloves` | `/products/leather-gloves` |
| `?product=<slug>` | `/?product=leather-gloves` | `/products/leather-gloves` |
| `?id=<id>` | `/?id=prod_leather_gloves` | `/products/<slug المقابل لهذا id>` |
| `#product/<slug>` | `/#product/leather-gloves` | `/products/leather-gloves` |
| `#p/<slug>` | `/#p/leather-gloves` | `/products/leather-gloves` |

### ملاحظات تقنية

1. **الهاش (`#...`) لا يصل إلى الخادم**: الجزء بعد `#` لا يُرسَل في طلب HTTP. لتحويل روابط `#product/<slug>` و `#p/<slug>` يجب إضافة سكربت صغير في `<head>` يقرأ `location.hash` قبل تحميل الصفحة ويحوّل:
   ```js
   const m = location.hash.match(/^#(?:product|p)\/([^/?#]+)/);
   if (m) location.replace('/products/' + decodeURIComponent(m[1]));
   ```
2. **`?id=<id>`**: يتطلب البحث عن الـ slug المقابل لمعرّف المنتج القديم. المهاجر يحفظ `originalId` داخل `products.presentation.egasaImport.originalId`، فيمكن للخادم الاستعلام عنه أو بناء خريطة `{originalId → slug}` مرة واحدة عند التهيئة.
3. **الحالة**: استخدم `301 Moved Permanently` للحفاظ على ترتيب SEO. لا تستخدم 302.
4. **الاستعلامات الأخرى**: أي استعلام غير معروف (`?utm_source=...` إلخ) يُمرَّر كما هو إلى الوجهة للحفاظ على قياس الإعلانات.

### نموذج middleware في Hono (مرجع لوكيل الخادم)

```ts
app.use('*', async (c, next) => {
  const url = new URL(c.req.url);
  const p = url.searchParams.get('p') || url.searchParams.get('product');
  if (p) return c.redirect(`/products/${encodeURIComponent(p)}`, 301);
  const id = url.searchParams.get('id');
  if (id) {
    const slug = await slugByOriginalId(c.env.DB, id); // استعلام من presentation
    if (slug) return c.redirect(`/products/${encodeURIComponent(slug)}`, 301);
  }
  return next();
});
```

## ملف `public/_redirects` كاحتياطي

لا يُنشأ ملف `_redirects` لأنه لن يُطبَّق (Worker أولاً). إذا نُقل الموقع لاحقاً إلى استضافة Pages ثابتة، فيمكن إضافة:

```
/*  /index.html  200
```

ولكن هذا غير مطلوب حالياً وقد يتعارض مع سلوك Worker.
