# ملف google-services.json — غير موجود بعد (مقصود)

هذا الملف يأتي من مشروع Firebase الجديد **`top-service`** (منفصل عن مشروع
`ind-toktok` وعن مشروع "تاجر جمله")، بعد إنشاء المشروع في
console.firebase.google.com وتفعيل Firestore + Authentication (Phone).

الخطوات (بعد إنشاء المشروع):
1. في Firebase console ← Project settings ← Your apps ← Android app
   (الحزمة `com.topservice.app`) ← حمّل `google-services.json`.
2. ضع الملف هنا: `android/app/google-services.json`.
3. سجّل بصمة SHA-1 لمفتاح debug في Firebase (من `android/app/debug.keystore`).

بدون الملف: التطبيق يعمل على الوضع المحلي فقط، وإرسال OTP يرفض برسالة
توضح أن إعداد Firebase غير موجود — لا ينهار التطبيق.
