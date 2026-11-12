// ---------------------------------------------------------------------------
//  جدول المراحل (v6) — منطق نقي، بدون Firebase
//  قائمة عربيات النهاردة بتتشتق من الجدول: عربية مرحلتها تشمل النهاردة،
//  وعندها اشتراك شهري نشط، ولسه متغسلتش النهاردة.
//  (مفيش عدّاد غسلات — الرصيد شهري: العربية بتتغسل في أيام مرحلتها
//  طول الشهر، والاشتراك بينتهي آخر الشهر.)
// ---------------------------------------------------------------------------
import { isSubscriptionActive } from './types'
import type { Car, Compound, Customer, Phase, Subscription, WashRequest } from './types'

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
 * عربيات النهاردة: عربية مرحلتها تشمل يوم النهاردة، وعندها اشتراك شهري
 * نشط، ولسه متغسلتش النهاردة.
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
    if (!phase.days.includes(today)) continue
    const sub = subs.find((s) => s.carId === car.id && isSubscriptionActive(s))
    if (!sub) continue
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
