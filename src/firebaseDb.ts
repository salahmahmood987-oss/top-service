// ---------------------------------------------------------------------------
//  طبقة Firebase — Firestore فقط (بدون Storage)
//  تعمل فقط عندما تُلصق قيم config حقيقية لمشروع top-service في
//  src/firebaseConfig.ts. بدون إعداد، كل الدوال ترجع null/[] وتتجاهل
//  بصمت، والتطبيق يعرض مودال يوضح أن Firebase غير مربوط.
//
//  ⚠️ لا يوجد أي استخدام لـ Firebase Storage هنا: التخزين في المشاريع
//  الجديدة يتطلب خطة Blaze (بطاقة فوترة). الصور (شخصية/عربية) تتخزن
//  كـ Data URL مضغوطة داخل مستند Firestore نفسه — انظر src/imageUpload.ts.
//
//  ملحوظة مهمة (درس ind-toktok v17): الاستيراد هنا ثابت (static) عمداً —
//  الاستيراد الديناميكي import('firebase/firestore') كان بيطلع ملف منفصل
//  (chunk) لازم يتحمّل وقت التشغيل، وفي WebView بتاع Capacitor كان
//  بيفشل بصمت فكل عمليات Firestore مكانتش بتوصل للسيرفر أصلاً.
//  الاستيراد الثابت بيضم الكود في الحزمة الرئيسية فمفيش تحميل وقت التشغيل.
//
//  مجموعات Firestore:
//    customers/{phone}     — name, code, compoundId, building, apartment, photoUrl
//    cars/{id}             — customerPhone, type, color, plate, photoUrl
//    subscriptions/{id}    — carId, packageId, price, status, endDate
//    payments/{id}          — subscriptionId, amount, method, status, receiptNo
//    washRequests/{id}      — carId, compoundId, building, status, requestedAt, doneAt
//    washers/{phone}        — name, compoundIds, active
//    compounds/{id}         — name, scheduleNote, phases
//    settings/counters      — paymentSeq (لأرقام الإيصالات)
// ---------------------------------------------------------------------------
import {
  collection,
  deleteDoc as deleteFirestoreDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  increment,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import type { Firestore, QueryConstraint } from 'firebase/firestore'
import { isFirebaseConfigured } from './firebaseConfig'
import { getFirebaseApp } from './firebaseApp'
import type {
  Car,
  Compound,
  Customer,
  PackageDef,
  Payment,
  Phase,
  Subscription,
  Washer,
  WashRequest,
} from './types'
import { monthEndTimestamp } from './types'
import type { TodayCar } from './schedule'

export const firebaseEnabled = isFirebaseConfigured

/** يتنادى عند فشل أي عملية Firestore — التطبيق بيسجّلها وبيعرضها للمستخدم. */
let errorHandler: ((message: string) => void) | null = null
export function setFirestoreErrorHandler(fn: ((message: string) => void) | null) {
  errorHandler = fn
}
/** آخر خطأ Firestore — عشان شاشة الحفظ تعرض السبب الحقيقي بدل رسالة عامة. */
let lastError: string | null = null
export function getLastFirestoreError(): string | null {
  return lastError
}
function reportError(where: string, e: unknown) {
  const msg = e instanceof Error ? e.message : String(e)
  lastError = `${where}: ${msg}`
  console.warn(`Firestore ${where} failed:`, e)
  errorHandler?.(`${where}: ${msg}`)
}

let db: Firestore | null | undefined
function getDb(): Firestore | null {
  if (!isFirebaseConfigured) return null
  if (db === undefined) {
    const app = getFirebaseApp()
    db = app ? getFirestore(app) : null
  }
  return db
}

/** يقرأ مستنداً واحداً — null لو مش موجود أو مفيش إعداد. */
export async function loadDoc(
  collectionName: string,
  id: string,
): Promise<Record<string, unknown> | null> {
  try {
    const db = getDb()
    if (!db) return null
    const snap = await getDoc(doc(db, collectionName, id))
    return snap.exists() ? (snap.data() as Record<string, unknown>) : null
  } catch (e) {
    reportError('قراءة', e)
    return null
  }
}

/** يحفظ مستنداً (دمج) — يتجاهل بدون إعداد. */
export async function saveDoc(
  collectionName: string,
  id: string,
  data: Record<string, unknown>,
): Promise<boolean> {
  try {
    const db = getDb()
    if (!db) return false
    await setDoc(doc(db, collectionName, id), data, { merge: true })
    return true
  } catch (e) {
    reportError('حفظ', e)
    return false
  }
}

/** يحذف مستنداً — false لو مفيش إعداد أو فشل الحذف. */
export async function deleteDocById(collectionName: string, id: string): Promise<boolean> {
  try {
    const db = getDb()
    if (!db) return false
    await deleteFirestoreDoc(doc(db, collectionName, id))
    return true
  } catch (e) {
    reportError('حذف', e)
    return false
  }
}

/** يقرأ كل مستندات مجموعة (مع قيود اختيارية) — [] بدون إعداد. */
export async function loadCollection(
  collectionName: string,
  constraints: QueryConstraint[] = [],
): Promise<Array<Record<string, unknown> & { id: string }>> {
  try {
    const db = getDb()
    if (!db) return []
    const q = query(collection(db, collectionName), ...constraints)
    const snap = await getDocs(q)
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }))
  } catch (e) {
    reportError('قراءة', e)
    return []
  }
}

/**
 * مزامنة لحظية لمجموعة — يعيد دالة إلغاء الاشتراك.
 * بدون إعداد: لا يفعل شيئاً ويعيد دالة فارغة.
 */
export function subscribeCollection(
  collectionName: string,
  onData: (rows: Array<Record<string, unknown> & { id: string }>) => void,
  constraints: QueryConstraint[] = [],
): () => void {
  const db = getDb()
  if (!db) return () => {}
  const q = query(collection(db, collectionName), ...constraints)
  return onSnapshot(
    q,
    (snap) => {
      onData(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) })))
    },
    (e) => reportError('مزامنة', e),
  )
}

/** يعيد تصدير أدوات الاستعلام للاستخدام في App.tsx. */
export const qWhere = where
export const qOrderBy = orderBy

// ---------------------------------------------------------------------------
//  تطبيع المستندات — قيم افتراضية للحقول الجديدة (مستندات قديمة)
// ---------------------------------------------------------------------------

export function normalizeCustomer(id: string, d: Record<string, unknown>): Customer {
  const p = d as unknown as Partial<Customer>
  return {
    phone: p.phone ?? id,
    code: p.code ?? '',
    name: p.name ?? '',
    compoundId: p.compoundId ?? '',
    compoundName: p.compoundName ?? '',
    building: p.building ?? '',
    apartment: p.apartment ?? '',
    photoUrl: p.photoUrl ?? null,
    createdAt: p.createdAt ?? Date.now(),
  }
}

export function normalizeCar(id: string, d: Record<string, unknown>): Car {
  const p = d as unknown as Partial<Car>
  return {
    id,
    customerPhone: p.customerPhone ?? '',
    customerName: p.customerName ?? '',
    type: p.type ?? '',
    color: p.color ?? '',
    plate: p.plate ?? '',
    photoUrl: p.photoUrl ?? null,
    phaseId: (p.phaseId as string | null) ?? null,
    createdAt: p.createdAt ?? Date.now(),
  }
}

export function normalizeSubscription(id: string, d: Record<string, unknown>): Subscription {
  const p = d as unknown as Partial<Subscription>
  return {
    id,
    carId: p.carId ?? '',
    customerPhone: p.customerPhone ?? '',
    customerName: p.customerName ?? '',
    carPlate: p.carPlate ?? '',
    carType: p.carType ?? '',
    packageId: typeof p.packageId === 'number' ? p.packageId : 4,
    price: p.price ?? 0,
    washesTotal: p.washesTotal ?? 0,
    washesRemaining: p.washesRemaining ?? 0,
    status: p.status ?? 'pending_payment',
    startDate: p.startDate ?? 0,
    endDate: p.endDate ?? monthEndTimestamp(),
    createdAt: p.createdAt ?? Date.now(),
    approvedAt: p.approvedAt ?? null,
  }
}

export function normalizePayment(id: string, d: Record<string, unknown>): Payment {
  const p = d as unknown as Partial<Payment>
  return {
    id,
    subscriptionId: p.subscriptionId ?? '',
    customerPhone: p.customerPhone ?? '',
    customerName: p.customerName ?? '',
    carPlate: p.carPlate ?? '',
    amount: p.amount ?? 0,
    method: p.method ?? 'cash',
    status: p.status ?? 'pending',
    receiptNo: p.receiptNo ?? null,
    createdAt: p.createdAt ?? Date.now(),
    decidedAt: p.decidedAt ?? null,
  }
}

export function normalizeWash(id: string, d: Record<string, unknown>): WashRequest {
  const p = d as unknown as Partial<WashRequest>
  return {
    id,
    carId: p.carId ?? '',
    customerPhone: p.customerPhone ?? '',
    customerName: p.customerName ?? '',
    carPlate: p.carPlate ?? '',
    carType: p.carType ?? '',
    carColor: p.carColor ?? '',
    compoundId: p.compoundId ?? '',
    compoundName: p.compoundName ?? '',
    building: p.building ?? '',
    apartment: p.apartment ?? '',
    subscriptionId: p.subscriptionId ?? '',
    status: p.status ?? 'requested',
    requestedAt: p.requestedAt ?? Date.now(),
    doneAt: p.doneAt ?? null,
    doneBy: p.doneBy ?? null,
    doneByPhone: p.doneByPhone ?? null,
    photoUrl: p.photoUrl ?? null,
  }
}

export function normalizeWasher(id: string, d: Record<string, unknown>): Washer {
  const p = d as unknown as Partial<Washer>
  return {
    phone: p.phone ?? id,
    name: p.name ?? '',
    compoundIds: Array.isArray(p.compoundIds) ? (p.compoundIds as string[]) : [],
    active: p.active ?? true,
    createdAt: p.createdAt ?? Date.now(),
  }
}

export function normalizeCompound(id: string, d: Record<string, unknown>): Compound {
  const p = d as unknown as Partial<Compound>
  return {
    id,
    name: p.name ?? '',
    scheduleNote: p.scheduleNote ?? '',
    phases: Array.isArray(p.phases) ? (p.phases as Phase[]) : [],
    createdAt: p.createdAt ?? Date.now(),
  }
}

// ---------------------------------------------------------------------------
//  قراءات نوعية
// ---------------------------------------------------------------------------

export async function loadCustomer(phone: string): Promise<Customer | null> {
  const d = await loadDoc('customers', phone)
  return d ? normalizeCustomer(phone, d) : null
}

export async function loadWasher(phone: string): Promise<Washer | null> {
  const d = await loadDoc('washers', phone)
  return d ? normalizeWasher(phone, d) : null
}

export async function loadCarsOfCustomer(phone: string): Promise<Car[]> {
  const rows = await loadCollection('cars', [where('customerPhone', '==', phone)])
  return rows.map((r) => normalizeCar(r.id, r)).sort((a, b) => a.createdAt - b.createdAt)
}

export async function loadSubscriptionsOfCustomer(phone: string): Promise<Subscription[]> {
  // where واحد فقط + ترتيب محلي — عشان ما نحتاجش فهرس مركّب في Firestore
  const rows = await loadCollection('subscriptions', [where('customerPhone', '==', phone)])
  return rows
    .map((r) => normalizeSubscription(r.id, r))
    .sort((a, b) => b.createdAt - a.createdAt)
}

export async function loadPaymentsOfCustomer(phone: string): Promise<Payment[]> {
  const rows = await loadCollection('payments', [where('customerPhone', '==', phone)])
  return rows.map((r) => normalizePayment(r.id, r)).sort((a, b) => b.createdAt - a.createdAt)
}

export async function loadWashHistoryOfCustomer(phone: string): Promise<WashRequest[]> {
  const rows = await loadCollection('washRequests', [where('customerPhone', '==', phone)])
  return rows
    .map((r) => normalizeWash(r.id, r))
    .sort((a, b) => b.requestedAt - a.requestedAt)
}

export async function loadCompounds(): Promise<Compound[]> {
  const rows = await loadCollection('compounds', [orderBy('name')])
  return rows.map((r) => normalizeCompound(r.id, r))
}

/** تطبيع قائمة الباقات من مستند settings/packages — إدخالات غير صالحة
 *  (عدد غسلات أو سعر مش رقم موجب) بتتخطى، ولو مفيش ولا باقة صالحة
 *  بيرجع null عشان التطبيق يقع على الباقات الافتراضية. */
function normalizePackages(d: Record<string, unknown>): PackageDef[] | null {
  const raw = d.packages
  if (!Array.isArray(raw)) return null
  const seen = new Set<number>()
  const list: PackageDef[] = []
  for (const item of raw) {
    const p = item as Partial<PackageDef> | null
    if (!p || typeof p !== 'object') continue
    const washes = typeof p.washes === 'number' ? Math.floor(p.washes) : NaN
    const price = typeof p.price === 'number' ? p.price : NaN
    if (!Number.isFinite(washes) || washes <= 0) continue
    if (!Number.isFinite(price) || price <= 0) continue
    const id = typeof p.id === 'number' && Number.isFinite(p.id) ? p.id : washes
    if (seen.has(id)) continue
    seen.add(id)
    list.push({ id, washes, price })
  }
  if (list.length === 0) return null
  return list.sort((a, b) => a.washes - b.washes)
}

/** باقات الأدمن من مستند settings/packages — null لو المستند مش موجود
 *  أو فاضي أو غير صالح (وقتها التطبيق بيستخدم الباقات الافتراضية). */
export async function loadPackages(): Promise<PackageDef[] | null> {
  const d = await loadDoc('settings', 'packages')
  if (!d) return null
  return normalizePackages(d)
}

/** حفظ باقات الأدمن في مستند settings/packages. */
export async function savePackages(pkgs: PackageDef[]): Promise<boolean> {
  return saveDoc('settings', 'packages', { packages: pkgs })
}

/** كل الاشتراكات (للأدمن) — الأحدث أولاً. */
export async function loadAllSubscriptions(): Promise<Subscription[]> {
  const rows = await loadCollection('subscriptions')
  return rows
    .map((r) => normalizeSubscription(r.id, r))
    .sort((a, b) => b.createdAt - a.createdAt)
}

/** كل المدفوعات (للأدمن) — الأحدث أولاً. */
export async function loadAllPayments(): Promise<Payment[]> {
  const rows = await loadCollection('payments')
  return rows.map((r) => normalizePayment(r.id, r)).sort((a, b) => b.createdAt - a.createdAt)
}

/** كل العملاء (للأدمن) — الأحدث أولاً. */
export async function loadAllCustomers(): Promise<Customer[]> {
  const rows = await loadCollection('customers')
  return rows.map((r) => normalizeCustomer(r.id, r)).sort((a, b) => b.createdAt - a.createdAt)
}

/** كل العربيات (للأدمن — للبحث باللوحة). */
export async function loadAllCars(): Promise<Car[]> {
  const rows = await loadCollection('cars')
  return rows.map((r) => normalizeCar(r.id, r)).sort((a, b) => b.createdAt - a.createdAt)
}

/** كل عمال الغسيل (للأدمن). */
export async function loadAllWashers(): Promise<Washer[]> {
  const rows = await loadCollection('washers')
  return rows.map((r) => normalizeWasher(r.id, r)).sort((a, b) => b.createdAt - a.createdAt)
}

/** طلبات الغسيل الجارية (للعامل الغسيل والأدمن) — الأقدم أولاً (أولوية التنفيذ). */
export async function loadOpenWashRequests(): Promise<WashRequest[]> {
  const rows = await loadCollection('washRequests', [where('status', '==', 'requested')])
  return rows.map((r) => normalizeWash(r.id, r)).sort((a, b) => a.requestedAt - b.requestedAt)
}

/** غسلات عامل الغسيل المنجزة (سجله). */
export async function loadWasherDoneWashes(phone: string): Promise<WashRequest[]> {
  const rows = await loadCollection('washRequests', [where('doneByPhone', '==', phone)])
  return rows
    .map((r) => normalizeWash(r.id, r))
    .filter((w) => w.status === 'done')
    .sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0))
}

// ---------------------------------------------------------------------------
//  عمليات الكتابة — مع حماية من الخصم المزدوج
// ---------------------------------------------------------------------------

/** يولّد معرّف مستند جديد فريد (بدون كتابة). */
export function newDocId(collectionName: string): string | null {
  const db = getDb()
  if (!db) return null
  return doc(collection(db, collectionName)).id
}

/** بداية النهاردة (00:00) — لفحص "اتغسلت النهاردة قبل كده؟" محلياً. */
function startOfToday(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * تسجيل غسلة منجزة من جدول المراحل (v6) — العملية الحرجة في التطبيق:
 * العامل/الأدمن بيعلّم عربية "تم الغسيل" من قائمة النهاردة، من غير طلب
 * مسبق من العميل. الحماية داخل الدالة نفسها (مش في الواجهة بس):
 * 1) يقرأ الاشتراك من السيرفر — لازم يكون 'active' ولسه في الشهر.
 * 2) يتأكد إن العربية متغسلتش النهاردة قبل كده — يقرأ سجل الغسلات
 *    ويصفّي محلياً (بدون فهرس مركّب).
 * 3) ينشئ مستند washRequests بحالة 'done' (requestedAt = doneAt = وقت
 *    التنفيذ، مع صورة الغسلة لو اتبعتت).
 * مفيش عدّاد غسلات: الرصيد شهري — العربية بتتغسل في أيام مرحلتها
 * طول الشهر، والاشتراك بينتهي آخر الشهر. الدالة دي مبتلمسش الاشتراك
 * خالص ولا بتنقّص أي رصيد.
 * زرار "تم الغسيل" بيتقفل أثناء التنفيذ (حماية إضافية من الضغطة المزدوجة).
 */
export async function recordWashDone(
  entry: TodayCar,
  doneBy: string,
  doneByPhone: string,
  photoUrl?: string | null,
): Promise<{ ok: boolean; message: string }> {
  const db = getDb()
  if (!db) return { ok: false, message: 'Firebase غير مربوط — اربط مشروع top-service الأول.' }
  try {
    const now = Date.now()
    const subSnap = await getDoc(doc(db, 'subscriptions', entry.sub.id))
    if (!subSnap.exists()) return { ok: false, message: 'اشتراك العربية ده مش موجود.' }
    const sub = normalizeSubscription(
      entry.sub.id,
      subSnap.data() as Record<string, unknown>,
    )
    if (sub.status !== 'active') {
      return { ok: false, message: 'اشتراك العربية مش نشط — مينفعش نسجّل الغسلة.' }
    }
    if (now > sub.endDate) {
      return { ok: false, message: 'الاشتراك انتهى بنهاية الشهر.' }
    }
    // اتغسلت النهاردة قبل كده؟ نقرأ كل الطلبات ونصفّي محلياً — بدون فهرس مركّب
    const rows = await loadCollection('washRequests')
    const start = startOfToday()
    const alreadyDone = rows.some(
      (r) =>
        r.carId === entry.car.id && r.status === 'done' && Number(r.doneAt ?? 0) >= start,
    )
    if (alreadyDone) {
      return { ok: false, message: 'العربية دي اتغسلت النهاردة خلاص.' }
    }
    const id = newDocId('washRequests')
    if (!id) return { ok: false, message: 'Firebase غير مربوط.' }
    const { car, customer, compound } = entry
    const ok = await saveDoc('washRequests', id, {
      id,
      carId: car.id,
      customerPhone: customer.phone,
      customerName: customer.name,
      carPlate: car.plate,
      carType: car.type,
      carColor: car.color,
      compoundId: compound.id,
      compoundName: compound.name,
      building: customer.building,
      apartment: customer.apartment,
      subscriptionId: sub.id,
      status: 'done',
      requestedAt: now,
      doneAt: now,
      doneBy,
      doneByPhone,
      photoUrl: photoUrl ?? null,
    })
    if (!ok) {
      return { ok: false, message: 'مقدرناش نسجّل الغسلة — تأكد إن النت شغال وحاول تاني.' }
    }
    return { ok: true, message: `تم الغسيل ✅ — العربية ${car.plate}.` }
  } catch (e) {
    reportError('تسجيل الغسلة', e)
    return { ok: false, message: 'حصلت مشكلة أثناء حفظ الغسلة — حاول تاني.' }
  }
}

/**
 * موافقة الأدمن على دفعة: الاشتراك يبقى 'active' (برصيد كامل + تاريخ
 * نهاية الشهر)، والدفعة 'approved' مع رقم إيصال متسلسل (TS-1001...).
 * رقم الإيصال من عدّاد settings/counters (increment ذري).
 */
export async function approvePayment(
  paymentId: string,
  subscriptionId: string,
): Promise<{ ok: boolean; message: string }> {
  const db = getDb()
  if (!db) return { ok: false, message: 'Firebase غير مربوط.' }
  try {
    const paySnap = await getDoc(doc(db, 'payments', paymentId))
    if (!paySnap.exists()) return { ok: false, message: 'الدفعة دي مش موجودة.' }
    const pay = normalizePayment(paymentId, paySnap.data() as Record<string, unknown>)
    if (pay.status !== 'pending') {
      return { ok: false, message: 'الدفعة دي اتقرر فيها قبل كده.' }
    }
    const subSnap = await getDoc(doc(db, 'subscriptions', subscriptionId))
    if (!subSnap.exists()) return { ok: false, message: 'الاشتراك ده مش موجود.' }
    const sub = normalizeSubscription(subscriptionId, subSnap.data() as Record<string, unknown>)
    // رقم إيصال متسلسل
    const counterRef = doc(db, 'settings', 'counters')
    await setDoc(counterRef, { paymentSeq: increment(1) }, { merge: true })
    const counterSnap = await getDoc(counterRef)
    const seq = Number(
      (counterSnap.data() as Record<string, unknown> | undefined)?.paymentSeq ?? 1000,
    )
    const receiptNo = `TS-${seq}`
    const now = Date.now()
    await updateDoc(doc(db, 'subscriptions', subscriptionId), {
      status: 'active',
      startDate: now,
      endDate: monthEndTimestamp(now),
      washesRemaining: sub.washesTotal,
      approvedAt: now,
    })
    await updateDoc(doc(db, 'payments', paymentId), {
      status: 'approved',
      receiptNo,
      decidedAt: now,
    })
    return { ok: true, message: `تم تأكيد الدفع — إيصال رقم ${receiptNo}. الاشتراك نشط دلوقتي.` }
  } catch (e) {
    reportError('تأكيد الدفع', e)
    return { ok: false, message: 'حصلت مشكلة أثناء تأكيد الدفع — حاول تاني.' }
  }
}

/** رفض الأدمن لدفعة: الاشتراك يبقى 'rejected' والدفعة 'rejected'. */
export async function rejectPayment(
  paymentId: string,
  subscriptionId: string,
): Promise<{ ok: boolean; message: string }> {
  const db = getDb()
  if (!db) return { ok: false, message: 'Firebase غير مربوط.' }
  try {
    const paySnap = await getDoc(doc(db, 'payments', paymentId))
    if (!paySnap.exists()) return { ok: false, message: 'الدفعة دي مش موجودة.' }
    const pay = normalizePayment(paymentId, paySnap.data() as Record<string, unknown>)
    if (pay.status !== 'pending') {
      return { ok: false, message: 'الدفعة دي اتقرر فيها قبل كده.' }
    }
    const now = Date.now()
    await updateDoc(doc(db, 'subscriptions', subscriptionId), { status: 'rejected' })
    await updateDoc(doc(db, 'payments', paymentId), { status: 'rejected', decidedAt: now })
    return { ok: true, message: 'تم رفض الدفعة — العميل يقدر يراجع الإدارة.' }
  } catch (e) {
    reportError('رفض الدفع', e)
    return { ok: false, message: 'حصلت مشكلة أثناء رفض الدفع — حاول تاني.' }
  }
}

/**
 * تأكيد تحصيل دفعة مستحقة (التحصيل المؤخر):
 * يلمس مستند الدفعة + عدّاد الإيصالات فقط — الاشتراك مبيتلمسش أبداً
 * (الاشتراك نشط أصلاً والعميل ممكن يكون استخدم غسلات منه، فأي كتابة
 * على الاشتراك هنا كانت هترجّع رصيده كامل بالغلط).
 * الدفعة لازم تكون 'due' — غير كده يرجع خطأ (اتقرر فيها قبل كده).
 */
export async function confirmCollection(
  paymentId: string,
): Promise<{ ok: boolean; message: string }> {
  const db = getDb()
  if (!db) return { ok: false, message: 'Firebase غير مربوط.' }
  try {
    const paySnap = await getDoc(doc(db, 'payments', paymentId))
    if (!paySnap.exists()) return { ok: false, message: 'الدفعة دي مش موجودة.' }
    const pay = normalizePayment(paymentId, paySnap.data() as Record<string, unknown>)
    if (pay.status !== 'due') {
      return { ok: false, message: 'الدفعة دي اتقرر فيها قبل كده.' }
    }
    // رقم إيصال متسلسل
    const counterRef = doc(db, 'settings', 'counters')
    await setDoc(counterRef, { paymentSeq: increment(1) }, { merge: true })
    const counterSnap = await getDoc(counterRef)
    const seq = Number(
      (counterSnap.data() as Record<string, unknown> | undefined)?.paymentSeq ?? 1000,
    )
    const receiptNo = `TS-${seq}`
    const now = Date.now()
    await updateDoc(doc(db, 'payments', paymentId), {
      status: 'approved',
      receiptNo,
      decidedAt: now,
    })
    return { ok: true, message: `تم تأكيد التحصيل — إيصال رقم ${receiptNo}.` }
  } catch (e) {
    reportError('تأكيد التحصيل', e)
    return { ok: false, message: 'حصلت مشكلة أثناء تأكيد التحصيل — حاول تاني.' }
  }
}
