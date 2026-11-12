// ---------------------------------------------------------------------------
//  تنبيهات الدفع على الموبايل (v14) — إشعارات محلية على الجهاز نفسه،
//  من غير سيرفر ومن غير Blaze: التطبيق بيحجز التذكير على الموبايل
//  لما العميل يفتحه، والموبايل بيظهره في ميعاده حتى لو التطبيق مقفول.
//  الشرط الوحيد: العميل يكون فتح التطبيق مرة في الشهر عشان التذكير يتحجز.
//  للعميل بس — لا أدمن ولا عامل غسيل.
// ---------------------------------------------------------------------------
import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import type { Payment } from './types'

const PERM_KEY = 'ts-notif-perm'
const TITLE = 'Top Service — تذكير بالدفع'
/** الساعة 6 مساءً كل يوم — ميعاد التذكير اليومي للي مدفعوش. */
const REMIND_HOUR = 18
/** أقصى عدد خانات تذكير لدفعة: (31-25+1) + 5 = 12 خانة. */
const MAX_SLOTS = 12

/** رقم إشعار ثابت ومستقر: هاش صغير من معرّف الدفعة + رقم الخانة،
 *  عشان إعادة الجدولة تستبدل بدل ما تكرّر. */
function notificationId(paymentId: string, slot: number): number {
  const s = `${paymentId}:${slot}`
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h & 0x7fffffff) % 2147483647
}

function slotIds(paymentId: string): number[] {
  // إلغاء خانات مش موجودة أصلاً عادي (no-op) — فبنلغي الحد الأقصى دايماً
  return Array.from({ length: MAX_SLOTS }, (_, slot) => notificationId(paymentId, slot))
}

/** مواعيد التذكير لدفعة ما — كل يوم الساعة 6 مساءً، من يوم 25
 *  لآخر الشهر + أول 5 أيام من الشهر اللي بعده (فترة السماح).
 *  شهر الدفعة من createdAt — نفس منطق paymentCollectionStatus. */
function reminderSlots(payment: Payment): { at: Date; body: string }[] {
  const created = new Date(payment.createdAt)
  const y = created.getFullYear()
  const m = created.getMonth()
  const lastDay = new Date(y, m + 1, 0).getDate()
  const amount = payment.amount
  const slots: { at: Date; body: string }[] = []
  for (let day = 25; day <= lastDay; day++) {
    slots.push({
      at: new Date(y, m, day, REMIND_HOUR, 0, 0),
      body: `لسه عليك ${amount} جنيه — ادفع الآن.`,
    })
  }
  for (let day = 1; day <= 5; day++) {
    slots.push({
      at: new Date(y, m + 1, day, REMIND_HOUR, 0, 0),
      body:
        day === 5
          ? `لسه عليك ${amount} جنيه — النهاردة آخر يوم في فترة السماح، ادفع الآن.`
          : `لسه عليك ${amount} جنيه — ادفع الآن.`,
    })
  }
  return slots
}

/** إذن الإشعارات: بيُطلب مرة واحدة بس لما يكون فيه دفعة مستحقة،
 *  والنتيجة بتتحفظ في localStorage عشان الرفض ميتسألش عنه تاني كل مرة. */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false
  try {
    const saved = localStorage.getItem(PERM_KEY)
    if (saved === 'granted') return true
    if (saved === 'denied') return false
    const res = await LocalNotifications.requestPermissions()
    const granted = res.display === 'granted'
    localStorage.setItem(PERM_KEY, granted ? 'granted' : 'denied')
    return granted
  } catch {
    return false
  }
}

/** جدولة تذكيرات دفعة مستحقة: إلغاء القديم أولاً، وبعدين حجز
 *  الخانات اللي ميعادها لسه في المستقبل بس. */
export async function schedulePaymentReminders(payment: Payment): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    const ids = slotIds(payment.id)
    await LocalNotifications.cancel({ notifications: ids.map((id) => ({ id })) })
    const now = Date.now()
    const upcoming = reminderSlots(payment)
      .map((slot, i) => ({ ...slot, id: ids[i] }))
      .filter((n) => n.at.getTime() > now)
    if (upcoming.length === 0) return
    await LocalNotifications.schedule({
      notifications: upcoming.map((n) => ({
        id: n.id,
        title: TITLE,
        body: n.body,
        schedule: { at: n.at },
      })),
    })
  } catch {
    // الإشعارات إضافة — فشلها ميكسرش التطبيق (بطاقات التذكير جوه التطبيق شغالة)
  }
}

/** إلغاء كل تذكيرات دفعة (لما تتدفع أو متبقاش مستحقة). */
export async function cancelPaymentReminders(paymentId: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    await LocalNotifications.cancel({
      notifications: slotIds(paymentId).map((id) => ({ id })),
    })
  } catch {
    // تجاهل — مفيش حاجة تتلغي
  }
}

/** مزامنة التذكيرات مع حالة المدفوعات: المستحق بيتجدول،
 *  واللي اتدفع (أو مبقاش مستحق) بتتلغي تذكيراته. */
export async function reconcilePaymentReminders(payments: Payment[]): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  const due = payments.filter((p) => p.status === 'due')
  const done = payments.filter((p) => p.status !== 'due')
  for (const p of done) void cancelPaymentReminders(p.id)
  if (due.length === 0) return
  if (!(await ensureNotificationPermission())) return
  for (const p of due) void schedulePaymentReminders(p)
}
