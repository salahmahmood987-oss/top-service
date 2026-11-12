// ---------------------------------------------------------------------------
//  أنواع Top Service — المرحلة 1
//  مجموعات Firestore: customers, cars, subscriptions, payments,
//  washRequests, washers, compounds (+ settings/counters لإيصالات الدفع)
// ---------------------------------------------------------------------------

export type Role = 'customer' | 'washer' | 'admin'

/** رقم موبايل الأدمن (صلاح) — دور الأدمن مقفول على الرقم ده بس. */
export const ADMIN_PHONE = '+201550364683'

export interface Customer {
  phone: string
  /** كود عميل ثابت لنفس رقم الموبايل، مثل C-1002 */
  code: string
  name: string
  compoundId: string
  compoundName: string
  building: string
  apartment: string
  /** صورة شخصية (Data URL مضغوطة) — اختيارية */
  photoUrl: string | null
  createdAt: number
}

export interface Car {
  id: string
  customerPhone: string
  customerName: string
  /** نوع العربية / الموديل، مثال: هيونداي النترا */
  type: string
  color: string
  /** رقم اللوحة — يُستخدم في البحث والتعريف */
  plate: string
  /** صورة العربية (Data URL مضغوطة) — اختيارية */
  photoUrl: string | null
  createdAt: number
}

export interface PackageDef {
  id: 4 | 8 | 12
  washes: number
  price: number
}

/** الباقات الشهرية — الأساس التجاري (من السكريبت، البند 6). */
export const PACKAGES: PackageDef[] = [
  { id: 4, washes: 4, price: 100 },
  { id: 8, washes: 8, price: 150 },
  { id: 12, washes: 12, price: 200 },
]

export function packageById(id: number): PackageDef {
  return PACKAGES.find((p) => p.id === id) ?? PACKAGES[0]
}

export type SubscriptionStatus =
  | 'pending_payment' // بانتظار تأكيد الدفع من الأدمن
  | 'active' // نشط — الرصيد شغال
  | 'expired' // انتهى (خلص الشهر أو خلص الرصيد واستُبدل)
  | 'rejected' // الأدمن رفض الدفع

export interface Subscription {
  id: string
  carId: string
  customerPhone: string
  customerName: string
  carPlate: string
  carType: string
  packageId: 4 | 8 | 12
  price: number
  washesTotal: number
  /** الغسلات المتبقية — تنقص 1 مع كل غسلة مكتملة */
  washesRemaining: number
  status: SubscriptionStatus
  /** بداية الاشتراك (وقت موافقة الأدمن) */
  startDate: number
  /** نهاية الشهر — الغسلات غير المستخدمة تنتهي هنا ولا تُرحَّل */
  endDate: number
  createdAt: number
  approvedAt: number | null
}

export type PaymentStatus = 'pending' | 'due' | 'approved' | 'rejected'
export type PaymentMethod = 'cash' | 'visa' | 'wallet'

export interface Payment {
  id: string
  subscriptionId: string
  customerPhone: string
  customerName: string
  carPlate: string
  amount: number
  method: PaymentMethod
  status: PaymentStatus
  /** رقم الإيصال، مثال TS-1001 — يُسند عند الموافقة */
  receiptNo: string | null
  createdAt: number
  decidedAt: number | null
}

export type WashStatus = 'requested' | 'done' | 'cancelled'

export interface WashRequest {
  id: string
  carId: string
  customerPhone: string
  customerName: string
  carPlate: string
  carType: string
  carColor: string
  compoundId: string
  compoundName: string
  building: string
  apartment: string
  subscriptionId: string
  status: WashStatus
  requestedAt: number
  doneAt: number | null
  /** مين اللي علّم "تم الغسيل": اسم عامل الغسيل أو الأدمن */
  doneBy: string | null
  doneByPhone: string | null
}

export interface Washer {
  phone: string
  name: string
  /** الكومباوندات المربوطة بعامل الغسيل — فاضية = يرى كل الطلبات */
  compoundIds: string[]
  active: boolean
  createdAt: number
}

export interface Compound {
  id: string
  name: string
  /** ملاحظة جدول الشركة الثابت للكومباوند، مثال: "السبت والثلاثاء" */
  scheduleNote: string
  createdAt: number
}

/** هل نافذة التحصيل مفتوحة؟ التحصيل المؤخر يبدأ من يوم 25 من الشهر. */
export function isCollectionOpen(now = Date.now()): boolean {
  return new Date(now).getDate() >= 25
}

/** آخر يوم في الشهر الحالي (23:59:59) — نهاية الاشتراك الشهري. */
export function monthEndTimestamp(from: number = Date.now()): number {
  const d = new Date(from)
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999)
  return end.getTime()
}

/** هل الاشتراك منتهي بالوقت؟ (تجاوز تاريخ النهاية) */
export function isSubscriptionTimeExpired(sub: Subscription, now = Date.now()): boolean {
  return now > sub.endDate
}

/** هل الاشتراك نشط فعلاً؟ (موافق عليه + رصيد > 0 + لسه في الشهر) */
export function isSubscriptionActive(sub: Subscription, now = Date.now()): boolean {
  return sub.status === 'active' && sub.washesRemaining > 0 && now <= sub.endDate
}

export const OTP_MAX_PER_HOUR = 3 // حد طلبات الكود: 3 في الساعة لكل رقم
export const OTP_CODE_LENGTH = 6 // كود Firebase Phone Auth: 6 أرقام يوصلوا برسالة SMS

/** يحوّل timestamp لتاريخ مصري قصير، مثال: 12/11/2026 */
export function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString('ar-EG', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  })
}

/** يحوّل timestamp لوقت وتاريخ، مثال: 12/11/2026 05:30 م */
export function fmtDateTime(ts: number): string {
  return new Date(ts).toLocaleString('ar-EG', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}
