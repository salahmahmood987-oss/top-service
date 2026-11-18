/** إصدار التطبيق الحالي — زوّده مع كل نسخة جديدة (يظهر في الفوتر + فحص التحديثات). */
export const APP_VERSION = 31

/** ملف صغير في الريبو العام فيه آخر إصدار + لينك الـ APK —
 *  التطبيق بيفحصه عند الفتح (زي ind toktok بالظبط)، ولو فيه إصدار
 *  أحدث بيظهر للعميل تنبيه جوّه التطبيق بزر تحديث. الفشل (مفيش نت)
 *  صامت تماماً. */
export const VERSION_URL =
  'https://raw.githubusercontent.com/salahmahmood987-oss/top-service/main/version.json'
