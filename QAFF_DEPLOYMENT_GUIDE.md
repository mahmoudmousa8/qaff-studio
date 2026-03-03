# 📋 تقرير الفحص الشامل - Qaff Studio Streaming

## ✅ ملخص الإصلاحات المنجزة

### 1. نظام تسجيل الدخول (Authentication)
- ✅ إضافة صفحة Login محمية
- ✅ تخزين كلمة المرور مشفرة (SHA-256 + Salt)
- ✅ سكربت `scripts/set-admin-password.mjs` لإنشاء/تغيير كلمة المرور
- ✅ Session مخزنة في sessionStorage

### 2. Stream Manager Security
- ✅ Bind على `127.0.0.1:3002` فقط (وليس 0.0.0.0)
- ✅ جميع endpoints تتطلب `x-qaff-token` (عدا /health)
- ✅ Token مخزن في قاعدة البيانات ويُولّد تلقائياً

### 3. Staggered Start (التشغيل المتدرج)
- ✅ فاصل زمني **1.5 ثانية** بين كل تشغيل
- ✅ Queue نظام يضمن تشغيل متتابع
- ✅ لا يحدث spike في الـ CPU/RAM

### 4. FFmpeg Copy Mode
- ✅ استخدام `-c copy` دائماً (بدون ترميز فيديو)
- ✅ ffprobe قبل التشغيل للتحقق من الملف
- ✅ Masking لـ streamKey في الـ logs (يظهر أول 4 وآخر 4 أحرف فقط)

### 5. Logging System
- ✅ TTL cleanup: حذف تلقائي للـ logs الأقدم من 12 ساعة
- ✅ Limit: 500 logs كحد أقصى
- ✅ Cleanup يعمل كل ساعة في Stream Manager

### 6. UI Fixes
- ✅ إزالة عمود RTMP Server (الافتراضي YouTube)
- ✅ إظهار Stream Key (بدون إخفاء)
- ✅ تغيير اسم "Channel" إلى "Details"
- ✅ تقليل حجم عمود Status

### 7. Path Traversal Protection
- ✅ التحقق من المسارات في:
  - `/api/folders`
  - `/api/upload`
  - `/api/download`
  - `/api/slots/[index]/start`

---

## 🚀 دليل نشر Ubuntu VPS (22.04/24.04)

### الخطوة 1: تحديث النظام
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl wget git sqlite3 ffmpeg
```

### الخطوة 2: تثبيت Node.js 20
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version  # يجب أن يظهر v20.x.x
```

### الخطوة 3: تثبيت PM2
```bash
sudo npm install -g pm2
```

### الخطوة 4: رفع المشروع
```bash
# إنشاء مجلد المشروع
sudo mkdir -p /home/qaff/qaff-studio
sudo chown -R $USER:$USER /home/qaff

# نسخ ملفات المشروع
# (استخدم scp أو rsync أو git clone)
```

### الخطوة 5: تثبيت التبعيات والبناء
```bash
cd /home/qaff/qaff-studio

# تثبيت التبعيات
npm install

# توليد Prisma Client
npx prisma generate

# إنشاء قاعدة البيانات
npx prisma db push

# بناء المشروع
npm run build
```

### الخطوة 6: إعداد كلمة المرور
```bash
# إنشاء كلمة مرور المشرف
node scripts/set-admin-password.mjs YOUR_PASSWORD

# احفظ الـ Token الذي يظهر - ستحتاجه لاحقاً
```

### الخطوة 7: إنشاء مجلد الـ logs
```bash
sudo mkdir -p /var/log/qaff
sudo chown -R $USER:$USER /var/log/qaff
```

### الخطوة 8: إنشاء مجلد الفيديوهات
```bash
mkdir -p /home/qaff/qaff-studio/videos
```

### الخطوة 9: تشغيل PM2
```bash
# تعديل المسارات في ecosystem.config.cjs
nano ecosystem.config.cjs
# تأكد من أن cwd يشير إلى /home/qaff/qaff-studio

# تشغيل الخدمات
pm2 start ecosystem.config.cjs

# حفظ الـ processes
pm2 save

# إعداد auto-start عند إعادة التشغيل
pm2 startup
# (انسخ الأمر الذي يظهره وشغله)
```

### الخطوة 10: إعداد Firewall
```bash
# السماح بالمنافذ المطلوبة فقط
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 3000/tcp  # Web App
sudo ufw enable
sudo ufw status

# تأكد أن 3002 غير مفتوح!
```

---

## ✅ أوامر التحقق (Smoke Tests)

### 1. فحص حالة الخدمات
```bash
pm2 status
pm2 logs qaff-web --lines 50
pm2 logs qaff-stream-manager --lines 50
```

### 2. فحص Web App
```bash
curl http://localhost:3000
# يجب أن يرجع صفحة HTML
```

### 3. فحص Stream Manager (داخلياً فقط)
```bash
# بدون token - يجب أن يفشل
curl http://127.0.0.1:3002/status
# Expected: {"error":"Unauthorized - valid x-qaff-token required"}

# مع token - يجب أن ينجح
TOKEN="qaff-YOUR-TOKEN-HERE"
curl -H "x-qaff-token: $TOKEN" http://127.0.0.1:3002/status
# Expected: {"activeStreams":[], "count":0, ...}
```

### 4. فحص أن 3002 غير متاح خارجياً
```bash
# من جهاز آخر أو عبر IP العام
curl http://YOUR_SERVER_IP:3002/status
# Expected: Connection refused (جيد!)
```

### 5. فحص Bind Address
```bash
ss -ltnp | grep 3002
# Expected: 127.0.0.1:3002 (وليس 0.0.0.0:3002)
```

### 6. اختبار Staggered Start
```bash
# افتح الـ logs
pm2 logs qaff-stream-manager

# من الـ UI، اضغط "Start All" على عدة slots
# راقب الـ logs - يجب أن ترى:
# "Slot X queued for staggered start"
# "Stagger: waiting 1500ms before next stream..."
```

---

## 🔧 كيفية تغيير كلمة المرور

```bash
cd /home/qaff/qaff-studio
node scripts/set-admin-password.mjs NEW_PASSWORD

# سيظهر Token جديد - احفظه!
```

---

## 📊 المراقبة اليومية

```bash
# حالة الخدمات
pm2 status

# استهلاك الموارد
pm2 monit

# آخر الأخطاء
pm2 logs qaff-web --err --lines 20
pm2 logs qaff-stream-manager --err --lines 20

# مساحة القرص
df -h

# حجم قاعدة البيانات
ls -lh /home/qaff/qaff-studio/db/custom.db
```

---

## 🛠️ إعادة التشغيل والصيانة

```bash
# إعادة تشغيل كل الخدمات
pm2 restart all

# إعادة تشغيل خدمة محددة
pm2 restart qaff-web
pm2 restart qaff-stream-manager

# إيقاف كل الخدمات
pm2 stop all

# تحديث الكود
cd /home/qaff/qaff-studio
git pull
npm install
npx prisma generate
npm run build
pm2 restart all
```

---

## ⚠️ ملاحظات مهمة

1. **الذاكرة**: كل FFmpeg process يستهلك حوالي 50-100MB RAM في Copy Mode
2. **الـ CPU**: Copy Mode لا يستهلك CPU تقريباً
3. **التزامن**: Max concurrent streams يعتمد على سرعة الإنترنت وقراءة القرص
4. **الـ Token**: احتفظ به آمناً - ستحتاجه لأي API calls مباشرة

---

## 📁 هيكل الملفات المهمة

```
/home/qaff/qaff-studio/
├── db/custom.db          # قاعدة البيانات (SQLite)
├── videos/               # مجلد الفيديوهات
├── .next/standalone/     # التطبيق المبني
├── ecosystem.config.cjs  # إعدادات PM2
└── scripts/
    └── set-admin-password.mjs  # سكربت تغيير كلمة المرور

/var/log/qaff/
├── web-error.log
├── web-out.log
├── stream-manager-error.log
└── stream-manager-out.log
```

---

## ✅ تأكيد المتطلبات

| المتطلب | الحالة |
|---------|--------|
| نشر على Ubuntu VPS | ✅ جاهز |
| دخول عبر IP:3000 | ✅ جاهز |
| Stream Manager على 127.0.0.1:3002 | ✅ جاهز |
| Token للحماية | ✅ جاهز |
| Copy Mode (بدون ترميز) | ✅ جاهز |
| Staggered Start ≥1s | ✅ جاهز (1.5s) |
| كلمة مرور مشفرة | ✅ جاهز |
| TTL للـ logs | ✅ جاهز |
| PM2 بدون Docker | ✅ جاهز |
| Firewall (22, 3000 فقط) | ✅ جاهز |

---

**🎉 المشروع جاهز للنشر على Ubuntu VPS!**
