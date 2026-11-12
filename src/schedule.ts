// ---------------------------------------------------------------------------
//  جدول المراحل (v6) — منطق نقي، بدون Firebase
//  قائمة عربيات النهاردة بتتشتق من الجدول: عربية مرحلتها تشمل النهاردة،
//  وعندها اشتراك شهري نشط، ولسه متغسلتش النهاردة.
//  (مفيش عدّاد غسلات — الرصيد شهري: العربية بتتغسل في أيام مرحلتها
//  طول الشهر، والاشتراك بينتهي آخر الشهر.)
//  أيام الغسيل (v18): مش كل أيام المرحلة بالضرورة — حسب الباقة:
//  12 غسلة = كل الأيام، 8 = يومين يختارهم العميل، 4 = يوم واحد يختاره
//  العميل من أيام المرحلة. العميل بيختار أيامه في معالج الاشتراك.
// ---------------------------------------------------------------------------
import { isSubscriptionActive } from './types'
import type { Car, Compound, Customer, Phase, Subscription, WashRequest } from './types'

/** ترتيب الأسبوع عندنا: بيبدأ من السبت. */
const WEEK_ORDER = [6, 0, 1, 2, 3, 4, 5]

/**
 * أيام غسيل العربية من أيام مرحلتها، حسب باقة اشتراكها (v18):
 * - daysPerWeek = clamp(round(washesTotal / 4), 1, عدد أيام المرحلة)
 *   (4 غسلات → يوم واحد، 8 → يومين، 12 → 3 أيام)
 * - كل الأيام → كل أيام المرحلة بالترتيب.
 * - أقل من كل الأيام → الأيام اللي اختارها العميل (chosenDays)، لو عددها
 *   مظبوط وكلها من أيام المرحلة.
 * - غير كده (اشتراك قديم من غير اختيار، أو اختيار مش مظبوط): يوم واحد →
 *   أول يوم، يومين → أول وآخر يوم (حد وخميس / سبت وأربع)، غير كده أول
 *   N أيام بالترتيب.
 * مثال: مرحلة [0,2,4] + 8 مع اختيار [0,4] → [0,4] (حد وخميس)،
 * + 4 مع اختيار [2] → [2]، ومن غير اختيار → [0].
 * مرحلة [6,1,3] + 8 من غير اختيار → [6,3] (سبت وأربع).
 */
export function washDaysFor(
  phaseDays: number[],
  washesTotal: number,
  chosenDays?: number[] | null,
): number[] {
  const sorted = [...phaseDays].sort((a, b) => WEEK_ORDER.indexOf(a) - WEEK_ORDER.indexOf(b))
  if (sorted.length === 0) return []
  const daysPerWeek = Math.min(Math.max(Math.round(washesTotal / 4), 1), sorted.length)
  if (daysPerWeek >= sorted.length) return sorted
  const picked = (chosenDays ?? []).filter((d) => sorted.includes(d))
  const uniquePicked = [...new Set(picked)].sort(
    (a, b) => WEEK_ORDER.indexOf(a) - WEEK_ORDER.indexOf(b),
  )
  if (uniquePicked.length === daysPerWeek) return uniquePicked
  if (daysPerWeek === 1) return [sorted[0]]
  if (daysPerWeek === 2) return [sorted[0], sorted[sorted.length - 1]]
  return sorted.slice(0, daysPerWeek)
}

/** عربية مطلوب غسيلها النهاردة — مع كل بياناتها للعرض والتسجيل. */
export interface TodayCar {
  car: Car
  customer: Customer
  sub: Subscription
  phase: Phase
  compound: Compound
}

/** مرحلة عربية من مراحل كومباوندها — undefined لو ملهاش مرحلة. */
export function phaseOf(
  compounds: Compound[],
  compoundId: string,
  phaseId: string | null,
): Phase | undefined {
  if (!phaseId) return undefined
  return compounds
    .find((c) => c.id === compoundId)
    ?.phases?.find((p) => p.id === phaseId)
}

/**
 * عربيات النهاردة: يوم النهاردة من أيام غسيل العربية حسب باقتها
 * (washDaysFor — v18)، وعندها اشتراك شهري نشط، ولسه متغسلتش النهاردة.
 * compoundIds: كومباوندات عامل الغسيل — فاضية/غير موجودة = كل الكومباوندات.
 * الترتيب: اسم الكومباوند، ثم العمارة، ثم اللوحة.
 */
export function todayCars(
  cars: Car[],
  customers: Customer[],
  subs: Subscription[],
  compounds: Compound[],
  doneToday: WashRequest[],
  compoundIds?: string[],
): TodayCar[] {
  const today = new Date().getDay()
  const doneCarIds = new Set(doneToday.map((w) => w.carId))
  const out: TodayCar[] = []
  for (const car of cars) {
    if (doneCarIds.has(car.id)) continue
    const customer = customers.find((c) => c.phone === car.customerPhone)
    if (!customer) continue
    if (compoundIds && compoundIds.length > 0 && !compoundIds.includes(customer.compoundId)) {
      continue
    }
    const compound = compounds.find((c) => c.id === customer.compoundId)
    if (!compound) continue
    const phase = car.phaseId
      ? compound.phases?.find((p) => p.id === car.phaseId)
      : undefined
    if (!phase) continue
    const sub = subs.find((s) => s.carId === car.id && isSubscriptionActive(s))
    if (!sub) continue
    // أيام الغسيل حسب الباقة (v18) — مش كل أيام المرحلة بالضرورة.
    if (!washDaysFor(phase.days, sub.washesTotal, sub.chosenDays).includes(today)) continue
    out.push({ car, customer, sub, phase, compound })
  }
  out.sort((a, b) => {
    const byCompound = a.compound.name.localeCompare(b.compound.name, 'ar')
    if (byCompound) return byCompound
    const byBuilding = (a.customer.building || '').localeCompare(
      b.customer.building || '',
      'ar',
    )
    if (byBuilding) return byBuilding
    return a.car.plate.localeCompare(b.car.plate, 'ar')
  })
  return out
}
