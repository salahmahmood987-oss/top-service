// ---------------------------------------------------------------------------
//  جدول المراحل (v6) — منطق نقي، بدون Firebase
//  قائمة عربيات النهاردة بتتشتق من الجدول: عربية مرحلتها تشمل النهاردة،
//  وعندها اشتراك شهري نشط، ولسه متغسلتش النهاردة.
//  (مفيش عدّاد غسلات — الرصيد شهري: العربية بتتغسل في أيام مرحلتها
//  طول الشهر، والاشتراك بينتهي آخر الشهر.)
//  أيام الغسيل (v17): مش كل أيام النموذج — حسب الباقة: 12 غسلة = كل
//  الأيام، 8 = أول وآخر يوم (حد وخميس / سبت وأربع)، 4 = يوم واحد
//  يختاره العميل من أيام النموذج.
// ---------------------------------------------------------------------------
import { isSubscriptionActive } from './types'
import type { Car, Compound, Customer, Phase, Subscription, WashRequest } from './types'

/** ترتيب الأسبوع عندنا: بيبدأ من السبت. */
const WEEK_ORDER = [6, 0, 1, 2, 3, 4, 5]

/**
 * أيام غسيل العربية من أيام نموذجها، حسب باقة اشتراكها (v17):
 * - daysPerWeek = clamp(round(washesTotal / 4), 1, عدد أيام المرحلة)
 *   (4 غسلات → يوم واحد، 8 → يومين، 12 → 3 أيام)
 * - كل الأيام → كل أيام النموذج بالترتيب.
 * - يومين → أول وآخر يوم في النموذج (حد وخميس / سبت وأربع).
 * - يوم واحد → اليوم اللي اختاره العميل لو من أيام النموذج، وإلا أول يوم.
 * مثال: نموذج [0,2,4] + 8 → [0,4] (حد وخميس)، + 4 → اليوم المختار أو [0].
 * نموذج [6,1,3] + 8 → [6,3] (سبت وأربع)، + 4 → اليوم المختار أو [6].
 */
export function washDaysFor(
  phaseDays: number[],
  washesTotal: number,
  chosenDay?: number | null,
): number[] {
  const sorted = [...phaseDays].sort((a, b) => WEEK_ORDER.indexOf(a) - WEEK_ORDER.indexOf(b))
  if (sorted.length === 0) return []
  const daysPerWeek = Math.min(Math.max(Math.round(washesTotal / 4), 1), sorted.length)
  if (daysPerWeek >= sorted.length) return sorted
  if (daysPerWeek === 1) {
    return [chosenDay != null && sorted.includes(chosenDay) ? chosenDay : sorted[0]]
  }
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
 * (washDaysFor — v17)، وعندها اشتراك شهري نشط، ولسه متغسلتش النهاردة.
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
    // أيام الغسيل حسب الباقة (v17) — مش كل أيام النموذج.
    if (!washDaysFor(phase.days, sub.washesTotal, sub.chosenDay).includes(today)) continue
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
