# Top Service — غسيل عربيات متنقلة في الكومباوندات

تطبيق شركة **Top Service** لغسيل العربيات داخل الكومباوندات: العميل يسجّل،
يضيف عربياته، يختار باقة شهرية، يطلب غسلة؛ والغسّال يعلّم "تم الغسيل"؛
والأدمن (صلاح) يتابع كل شيء من لوحة تحكم واحدة.

- **الحزمة:** `com.topservice.app`
- **التقنية:** Vite + React + TypeScript + Capacitor (أندرويد) + Firebase
  (Auth Phone OTP + Firestore) — بدون Firebase Storage (الصور Base64 مضغوطة).
- **السكريبت الكامل:** `~/workspace/goals/top-service-car-wash-app/files/TOP-SERVICE-SPEC.md`

## الحالة — المرحلة 1 (v1)

- دخول OTP خطوة بخطوة (دور ← تليفون ← كود) للعميل والغسّال والأدمن.
- بيانات العميل والعربية + باقات (100/4، 150/8، 200/12) + طلب غسلة
  (العميل يختار العربية فقط — اليوم حسب جدول الشركة الثابت لكل كومباوند).
- عدّاد الرصيد "متبقي X غسلات حتى تاريخ Y" — الغسلات غير المستخدمة
  تنتهي آخر الشهر ولا تُرحَّل، ولا توجد غسلة مفردة.
- الدفع في المرحلة 1 يدوي: الاشتراك يُسجَّل "بانتظار تأكيد الدفع" والأدمن
  يوافق/يرفض من لوحة التحكم (Paymob في المرحلة 2).
- الغسّال: عربيات اليوم مجمّعة بالكومباوند ثم العمارة + بحث فوري
  (لوحة/نوع/اسم/تليفون) + زرار "تم الغسيل" (ينقص الرصيد 1، بحماية من الخصم المزدوج).
- الأدمن: إحصائيات + بحث شامل + عملاء + مدفوعات معلّقة + إيصالات +
  إدارة الغسّالين والكومباوندات + غسلات اليوم.

## Firebase — غير مربوط بعد

المشروع الجديد **`top-service`** لم يُنشأ بعد في Firebase. الملف
`src/firebaseConfig.ts` فيه قيم نائبة (PLACEHOLDER) — التطبيق يعرض مودال
يوضح أن Firebase غير مربوط، ولا ينهار. خطوات الربط:

1. أنشئ مشروع Firebase جديد باسم `top-service` (لا تلمس `ind-toktok`
   ولا "تاجر جمله").
2. فعّل Firestore Database + Authentication (Phone) — بدون Storage.
3. من Project settings ← Web app انسخ الـ config والصقه في
   `src/firebaseConfig.ts` بدل القيم النائبة.
4. ضع `google-services.json` (من Android app بالحزمة `com.topservice.app`)
   في `android/app/` — انظر `android/app/README-google-services.md`.

## البناء

```bash
npm install
npm run build          # لازم ينجح قبل أي دفع
npx cap sync android
```

التحقق قبل كل دفع (إلزامي): `npx tsc -b --force` **و** `npm run build` —
كلاهما exit 0. ممنوع `npx tsc --noEmit` (لا يفحص شيئاً في هذا الإعداد).

الـ APK يُبنى عبر GitHub Actions (`.github/workflows/build-apk.yml`) —
البناء المحلي بـ Gradle لا يعمل في بيئة التطوير الحالية.
