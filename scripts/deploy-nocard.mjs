// Egasa no-card edition — prints the ready-to-paste wrangler commands.
// Usage: node scripts/deploy-nocard.mjs
// This script does NOT deploy anything; it only prints the commands you copy/paste.
const bucket = process.env.FIREBASE_STORAGE_BUCKET || 'egasa-87fcd.appspot.com';
const cmds = [
  '# ===== Egasa — نشر مجاني بدون بطاقة ائتمانية =====',
  '# 1) تسجيل الدخول (يفتح المتصفح، مجاني بدون بطاقة)',
  'npx wrangler login',
  '',
  '# 2) إنشاء مساحة KV واحدة للنسخ الاحتياطية المشفرة',
  'npx wrangler kv namespace create BACKUPS',
  '# الصق المعرف المطبوع في wrangler.toml عند [[kv_namespaces]] binding = "BACKUPS"',
  '',
  '# 3) إنشاء قاعدة البيانات D1',
  'npx wrangler d1 create DB',
  '# الصق المعرف في wrangler.toml عند [[d1_databases]] database_id',
  '',
  '# 4) تطبيق migrations على قاعدة البيانات البعيدة',
  'npx wrangler d1 migrations apply DB --remote',
  '',
  '# 5) استيراد بيانات إغاسا الحقيقية (الإعدادات + المنتج + التنوعات)',
  'npx wrangler d1 execute DB --remote --file=data/egasa-real-products.sql',
  '',
  '# 6) الأسرار (Secrets) — يُطلب منك اللصق سطراً سطراً',
  'npx wrangler secret put SETUP_TOKEN',
  '#    (كلمة سر الإعداد الأولي، اخترها أنت)',
  'npx wrangler secret put FIREBASE_SERVICE_ACCOUNT',
  '#    (الصق محتوى ملف JSON لحساب الخدمة من Firebase كاملاً)',
  '',
  `# 7) تأكد من ضبط متغير القربة في wrangler.toml: FIREBASE_STORAGE_BUCKET = "${bucket}"`,
  '',
  '# 8) النشر',
  'npm run deploy',
  '',
  '# 9) بعد النشر: افتح /admin وأكمل الإعداد الأولي (مالك + كلمة مرور)',
  '',
  '# اختياري: دومين مخصص + Turnstile + APP_ORIGIN في لوحة Cloudflare',
];
console.log(cmds.join('\n'));
