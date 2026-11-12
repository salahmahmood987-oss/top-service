// ---------------------------------------------------------------------------
//  Top Service — المرحلة 1 (v1)
//  دخول OTP خطوة بخطوة (دور ← تليفون ← كود) + بيانات العميل والعربية +
//  باقات + طلب غسلة + عدّاد رصيد + لوحة أدمن + تأكيد دفع يدوي.
//  لا توجد بيانات وهمية — كل رقم من Firestore (أو حالة "غير مربوط" صادقة).
//  الأخطاء والرسائل في مودال وسط الشاشة، وليست شريطاً علوياً.
// ---------------------------------------------------------------------------
import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera'
import { Capacitor } from '@capacitor/core'
import { where } from 'firebase/firestore'
import logoTransparent from './assets/logo-top-services-transparent.png'
import { isFirebaseConfigured } from './firebaseConfig'
import {
  approvePayment,
  completeWash,
  loadAllCars,
  loadAllCustomers,
  loadAllPayments,
  loadAllSubscriptions,
  loadAllWashers,
  loadCarsOfCustomer,
  loadCollection,
  loadCompounds,
  loadCustomer,
  loadOpenWashRequests,
  loadPaymentsOfCustomer,
  loadSubscriptionsOfCustomer,
  loadWashHistoryOfCustomer,
  loadWasher,
  loadWasherDoneWashes,
  newDocId,
  normalizeCustomer,
  normalizePayment,
  normalizeSubscription,
  normalizeWash,
  rejectPayment,
  saveDoc,
  setFirestoreErrorHandler,
  subscribeCollection,
} from './firebaseDb'
import { sendOtpCode, toE164Phone, verifyOtpCode } from './otp'
import { clearSession, loadSession, saveSession } from './store'
import type { Session } from './store'
import { preparePhotoForFirestore } from './imageUpload'
import {
  ADMIN_PHONE,
  PACKAGES,
  fmtDate,
  fmtDateTime,
  isSubscriptionActive,
  monthEndTimestamp,
  packageById,
} from './types'
import type {
  Car,
  Compound,
  Customer,
  Payment,
  PaymentMethod,
  Role,
  Subscription,
  Washer,
  WashRequest,
} from './types'
import {
  BuildingIcon,
  CalendarIcon,
  CarIcon,
  CheckIcon,
  DropIcon,
  HomeIcon,
  LogoutIcon,
  PlusIcon,
  ReceiptIcon,
  RefreshIcon,
  SearchIcon,
  ShieldIcon,
  UserIcon,
  UsersIcon,
  WalletIcon,
  XIcon,
} from './icons'

// ---------------------------------------------------------------------------
//  أدوات مساعدة
// ---------------------------------------------------------------------------

/** تطبيع نص للبحث: أرقام عربية ← لاتينية، بدون مسافات/شرطات، أحرف صغيرة. */
function norm(s: string): string {
  return s
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[\s\-_]/g, '')
    .toLowerCase()
}

function todayStart(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function sameMonth(a: number, b: number): boolean {
  const x = new Date(a)
  const y = new Date(b)
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth()
}

/** كود عميل ثابت من رقم الموبايل، مثال: C-036468 */
function customerCode(e164: string): string {
  return `C-${e164.slice(-6)}`
}

// ---------------------------------------------------------------------------
//  مودال وسط الشاشة (لكل الرسائل والأخطاء)
// ---------------------------------------------------------------------------

function NoticeModal({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="notice-overlay" onClick={onClose}>
      <div className="notice-modal" onClick={(e) => e.stopPropagation()}>
        <div className="notice-icon">!</div>
        <p>{message}</p>
        <button className="btn" onClick={onClose}>
          تمام
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
//  صورة شخصية (صورة أو حرف أول)
// ---------------------------------------------------------------------------

function Avatar({
  photoUrl,
  name,
  lg,
}: {
  photoUrl: string | null
  name: string
  lg?: boolean
}) {
  const initial = name.trim()[0] ?? '؟'
  if (photoUrl) {
    return <img className={`avatar${lg ? ' avatar-lg' : ''}`} src={photoUrl} alt={name} />
  }
  return (
    <span className={`avatar avatar-placeholder${lg ? ' avatar-lg' : ''}`}>{initial}</span>
  )
}

// ---------------------------------------------------------------------------
//  اختيار صورة (كاميرا/معرض على أندرويد، أو ملف على الويب) + ضغط Base64
// ---------------------------------------------------------------------------

function PhotoField({
  photo,
  onPhoto,
  notice,
}: {
  photo: string | null
  onPhoto: (p: string | null) => void
  notice: (m: string) => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)

  async function handleFile(file: File | undefined) {
    if (!file) return
    try {
      onPhoto(await preparePhotoForFirestore(file))
    } catch (e) {
      notice(e instanceof Error ? e.message : 'مقدرناش نجهّز الصورة — جرّب صورة تانية.')
    }
  }

  async function handleCamera() {
    if (!Capacitor.isNativePlatform()) {
      inputRef.current?.click()
      return
    }
    try {
      const p = await Camera.getPhoto({
        quality: 85,
        allowEditing: false,
        resultType: CameraResultType.Uri,
        source: CameraSource.Prompt,
      })
      if (!p.webPath) {
        inputRef.current?.click()
        return
      }
      const res = await fetch(p.webPath)
      const blob = await res.blob()
      await handleFile(new File([blob], 'photo.jpg', { type: blob.type || 'image/jpeg' }))
    } catch {
      inputRef.current?.click()
    }
  }

  return (
    <div className="row">
      <Avatar photoUrl={photo} name="صورة" />
      <button type="button" className="btn small" onClick={() => void handleCamera()}>
        📷 اختار صورة
      </button>
      {photo && (
        <button type="button" className="btn small danger" onClick={() => onPhoto(null)}>
          إزالة
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
//  التطبيق
// ---------------------------------------------------------------------------

type GateStep = 'role' | 'phone' | 'otp' | 'profile' | 'main'

export default function App() {
  const [notice, setNotice] = useState<string | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [gate, setGate] = useState<GateStep>('role')
  const [roleSel, setRoleSel] = useState<Role>('customer')
  const [phoneInput, setPhoneInput] = useState('')
  const [otpCode, setOtpCode] = useState('')
  const [otpBusy, setOtpBusy] = useState(false)
  const [otpSent, setOtpSent] = useState(false)
  const [otpLeft, setOtpLeft] = useState(3)
  const [compounds, setCompounds] = useState<Compound[]>([])
  const [pendingSession, setPendingSession] = useState<Session | null>(null)
  // نموذج استكمال البيانات (عميل)
  const [profName, setProfName] = useState('')
  const [profCompound, setProfCompound] = useState('')
  const [profCompoundManual, setProfCompoundManual] = useState('')
  const [profBuilding, setProfBuilding] = useState('')
  const [profApartment, setProfApartment] = useState('')
  const [profPhoto, setProfPhoto] = useState<string | null>(null)
  const [profBusy, setProfBusy] = useState(false)
  const warnedRef = useRef(false)

  useEffect(() => {
    setFirestoreErrorHandler((m) => setNotice(m))
    const s = loadSession()
    if (s) {
      setSession(s)
      setGate('main')
    }
    if (!isFirebaseConfigured && !warnedRef.current) {
      warnedRef.current = true
      setNotice(
        'Firebase مش مربوط بعد — أنشئ مشروع top-service في Firebase console، فعّل Firestore + Authentication (Phone)، والصق الـ config في src/firebaseConfig.ts. لحد ما يتربط، التطبيق هيعرض القوائم فاضية.',
      )
    }
    void loadCompounds().then(setCompounds)
    return () => setFirestoreErrorHandler(null)
  }, [])

  function logout() {
    clearSession()
    setSession(null)
    setPendingSession(null)
    setGate('role')
    setPhoneInput('')
    setOtpCode('')
    setOtpSent(false)
  }

  async function sendCode() {
    const e164 = toE164Phone(phoneInput)
    if (!e164) {
      setNotice('رقم التليفون غير صحيح — اكتب رقم مصري 11 رقم يبدأ بـ 01.')
      return
    }
    if (roleSel === 'admin' && e164 !== ADMIN_PHONE) {
      setNotice('دور الأدمن متاح لرقم صلاح بس — اختار دور تاني أو اكتب رقم الأدمن.')
      return
    }
    setOtpBusy(true)
    const r = await sendOtpCode(phoneInput)
    setOtpBusy(false)
    setOtpLeft(r.remaining)
    if (!r.ok) {
      setNotice(r.message)
      return
    }
    setOtpSent(true)
    if (r.autoVerified) {
      await afterVerify(e164)
      return
    }
    setNotice(r.message)
    setGate('otp')
  }

  async function confirmCode() {
    setOtpBusy(true)
    const r = await verifyOtpCode(otpCode)
    setOtpBusy(false)
    if (!r.ok) {
      setNotice(r.message)
      return
    }
    const e164 = toE164Phone(phoneInput)
    if (!e164) {
      setNotice('رقم التليفون غير صحيح — اكتب رقم مصري 11 رقم يبدأ بـ 01.')
      return
    }
    await afterVerify(e164)
  }

  /** بعد تأكيد OTP: نحفظ الجلسة، ونشوف هل الملف الشخصي موجود ولا لأ. */
  async function afterVerify(e164: string) {
    const base: Session = {
      role: roleSel,
      phone: e164,
      phoneDisplay: phoneInput.trim(),
      name: '',
      verified: true,
    }
    if (roleSel === 'admin') {
      const s: Session = { ...base, name: 'صلاح' }
      saveSession(s)
      setSession(s)
      setGate('main')
      return
    }
    if (roleSel === 'customer') {
      const c = await loadCustomer(e164)
      if (c && c.name) {
        const s: Session = { ...base, name: c.name }
        saveSession(s)
        setSession(s)
        setGate('main')
      } else {
        setPendingSession(base)
        setProfName('')
        setProfCompound('')
        setProfCompoundManual('')
        setProfBuilding('')
        setProfApartment('')
        setProfPhoto(null)
        setGate('profile')
      }
      return
    }
    // غسّال
    const w = await loadWasher(e164)
    if (w && w.name) {
      const s: Session = { ...base, name: w.name }
      saveSession(s)
      setSession(s)
      setGate('main')
    } else {
      setPendingSession(base)
      setProfName('')
      setGate('profile')
    }
  }

  async function saveProfile(e: FormEvent) {
    e.preventDefault()
    const s = pendingSession
    if (!s) return
    if (!isFirebaseConfigured) {
      setNotice('Firebase غير مربوط — مينفعش نحفظ البيانات. اربط مشروع top-service الأول (انظر README).')
      return
    }
    if (s.role === 'washer') {
      if (profName.trim().length < 2) {
        setNotice('اكتب اسمك الكامل الأول.')
        return
      }
      setProfBusy(true)
      const ok = await saveDoc('washers', s.phone, {
        phone: s.phone,
        name: profName.trim(),
        compoundIds: [],
        active: true,
        createdAt: Date.now(),
      })
      setProfBusy(false)
      if (!ok) {
        setNotice('مقدرناش نحفظ البيانات — تأكد إن النت شغال وحاول تاني.')
        return
      }
      const done: Session = { ...s, name: profName.trim() }
      saveSession(done)
      setSession(done)
      setPendingSession(null)
      setGate('main')
      return
    }
    // عميل
    if (profName.trim().length < 2) {
      setNotice('اكتب اسمك الكامل الأول.')
      return
    }
    const compoundName =
      profCompound === '__manual__' ? profCompoundManual.trim() : profCompound.trim()
    if (!compoundName) {
      setNotice('اختار الكومباوند بتاعك الأول.')
      return
    }
    if (!profBuilding.trim() || !profApartment.trim()) {
      setNotice('اكتب رقم العمارة ورقم الشقة.')
      return
    }
    const compoundId =
      profCompound === '__manual__'
        ? 'manual'
        : compounds.find((c) => c.name === compoundName)?.id ?? 'manual'
    setProfBusy(true)
    const ok = await saveDoc('customers', s.phone, {
      phone: s.phone,
      code: customerCode(s.phone),
      name: profName.trim(),
      compoundId,
      compoundName,
      building: profBuilding.trim(),
      apartment: profApartment.trim(),
      photoUrl: profPhoto,
      createdAt: Date.now(),
    })
    setProfBusy(false)
    if (!ok) {
      setNotice('مقدرناش نحفظ البيانات — تأكد إن النت شغال وحاول تاني.')
      return
    }
    const done: Session = { ...s, name: profName.trim() }
    saveSession(done)
    setSession(done)
    setPendingSession(null)
    setGate('main')
  }

  return (
    <div className="app">
      <header className="header">
        <img className="logo-wide" src={logoTransparent} alt="Top Service" />
        <h1>
          <span className="brand">Top Service</span>
        </h1>
        <p className="tagline">غسيل عربيات متنقلة في الكومباوندات</p>
        <span className="badge">الإصدار 1 — المرحلة 1</span>
      </header>

      {!isFirebaseConfigured && gate !== 'main' && (
        <div className="warn" style={{ marginTop: 14 }}>
          ⚠️ Firebase مش مربوط بعد — أنشئ مشروع <b>top-service</b> والصق الـ config في{' '}
          <b>src/firebaseConfig.ts</b> عشان التطبيق يشتغل بالبيانات الحقيقية.
        </div>
      )}

      {gate === 'role' && (
        <div className="card role-picker">
          <h2>أهلاً بيك في Top Service</h2>
          <p className="muted">اختار دورك عشان نكمّل تسجيل الدخول</p>
          <button
            className="btn big role-btn"
            onClick={() => {
              setRoleSel('customer')
              setGate('phone')
            }}
          >
            <CarIcon /> أنا عميل — صاحب عربية
          </button>
          <button
            className="btn big role-btn plum"
            onClick={() => {
              setRoleSel('washer')
              setGate('phone')
            }}
          >
            <DropIcon /> أنا غسّال
          </button>
          <button
            className="btn big role-btn plum"
            onClick={() => {
              setRoleSel('admin')
              setGate('phone')
            }}
          >
            <ShieldIcon /> أنا الأدمن (صلاح)
          </button>
        </div>
      )}

      {gate === 'phone' && (
        <div className="card">
          <h2>
            {roleSel === 'customer' ? 'دخول العميل' : roleSel === 'washer' ? 'دخول الغسّال' : 'دخول الأدمن'}
          </h2>
          <p className="muted">هنبعتلك كود تحقق من 6 أرقام في رسالة SMS على رقمك.</p>
          <label>رقم الموبايل</label>
          <input
            type="tel"
            inputMode="tel"
            placeholder="01xxxxxxxxx"
            value={phoneInput}
            onChange={(e) => setPhoneInput(e.target.value)}
            dir="ltr"
            style={{ textAlign: 'center' }}
          />
          <button className="btn big" onClick={() => void sendCode()} disabled={otpBusy}>
            {otpBusy ? 'بيبعت الكود…' : 'ابعت كود التحقق'}
          </button>
          {otpSent && <p className="muted">فاضل {otpLeft} من 3 طلبات كود في الساعة للرقم ده.</p>}
          <button
            className="link-btn"
            onClick={() => {
              setGate('role')
              setOtpSent(false)
            }}
          >
            ← تغيير الدور
          </button>
          <div id="recaptcha-container" />
        </div>
      )}

      {gate === 'otp' && (
        <div className="card">
          <h2>اكتب الكود اللي وصلك</h2>
          <p className="muted">
            بعتنا كود من 6 أرقام على {phoneInput.trim()} — اكتبه هنا.
            {otpLeft > 0 ? ` (فاضل ${otpLeft} من 3 طلبات في الساعة)` : ''}
          </p>
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            placeholder="••••••"
            value={otpCode}
            onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
            dir="ltr"
            style={{ textAlign: 'center', fontSize: 26, fontWeight: 800, letterSpacing: 8 }}
          />
          <button className="btn big" onClick={() => void confirmCode()} disabled={otpBusy || otpCode.length !== 6}>
            {otpBusy ? 'بيتأكد…' : 'تأكيد الكود'}
          </button>
          <div className="row">
            <button
              className="link-btn"
              onClick={() => void sendCode()}
              disabled={otpBusy || otpLeft <= 0}
            >
              ابعت كود جديد
            </button>
            <button
              className="link-btn"
              onClick={() => {
                setGate('phone')
                setOtpCode('')
              }}
            >
              تغيير الرقم
            </button>
          </div>
          <div id="recaptcha-container" />
        </div>
      )}

      {gate === 'profile' && pendingSession && (
        <div className="card">
          <h2>{pendingSession.role === 'washer' ? 'استكمال بيانات الغسّال' : 'استكمال بياناتك'}</h2>
          <p className="muted">
            رقمك {pendingSession.phoneDisplay} اتأكد بنجاح ✅ — كمّل بياناتك عشان نبدأ.
          </p>
          <form onSubmit={(e) => void saveProfile(e)}>
            <label>الاسم الكامل</label>
            <input
              type="text"
              placeholder="مثال: أحمد محمد"
              value={profName}
              onChange={(e) => setProfName(e.target.value)}
            />
            {pendingSession.role === 'customer' && (
              <>
                <label>الكومباوند</label>
                {compounds.length > 0 ? (
                  <select value={profCompound} onChange={(e) => setProfCompound(e.target.value)}>
                    <option value="">— اختار الكومباوند —</option>
                    {compounds.map((c) => (
                      <option key={c.id} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                    <option value="__manual__">كومباوند تاني (اكتبه بنفسك)</option>
                  </select>
                ) : (
                  <input
                    type="text"
                    placeholder="اسم الكومباوند"
                    value={profCompoundManual}
                    onChange={(e) => {
                      setProfCompoundManual(e.target.value)
                      setProfCompound('__manual__')
                    }}
                  />
                )}
                {profCompound === '__manual__' && compounds.length > 0 && (
                  <input
                    type="text"
                    placeholder="اسم الكومباوند"
                    value={profCompoundManual}
                    onChange={(e) => setProfCompoundManual(e.target.value)}
                  />
                )}
                <div className="grid">
                  <div>
                    <label>رقم العمارة</label>
                    <input
                      type="text"
                      placeholder="مثال: 12"
                      value={profBuilding}
                      onChange={(e) => setProfBuilding(e.target.value)}
                    />
                  </div>
                  <div>
                    <label>رقم الشقة</label>
                    <input
                      type="text"
                      placeholder="مثال: 5"
                      value={profApartment}
                      onChange={(e) => setProfApartment(e.target.value)}
                    />
                  </div>
                </div>
                <label>صورة شخصية (اختياري)</label>
                <PhotoField photo={profPhoto} onPhoto={setProfPhoto} notice={setNotice} />
              </>
            )}
            {pendingSession.role === 'washer' && (
              <p className="muted">
                الكومباوندات اللي هتشتغل فيها بيحددها الأدمن من لوحة التحكم بعد تسجيلك.
              </p>
            )}
            <button className="btn big" type="submit" disabled={profBusy}>
              {profBusy ? 'بيحفظ…' : 'حفظ وابدأ'}
            </button>
          </form>
        </div>
      )}

      {gate === 'main' && session && session.role === 'customer' && (
        <CustomerView session={session} compounds={compounds} onNotice={setNotice} onLogout={logout} />
      )}
      {gate === 'main' && session && session.role === 'washer' && (
        <WasherView session={session} onNotice={setNotice} onLogout={logout} />
      )}
      {gate === 'main' && session && session.role === 'admin' && (
        <AdminView session={session} compounds={compounds} onCompounds={setCompounds} onNotice={setNotice} onLogout={logout} />
      )}

      <footer className="footer">
        <p>Top Service — غسيل عربيات متنقلة • الإصدار 1</p>
      </footer>

      {notice && <NoticeModal message={notice} onClose={() => setNotice(null)} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
//  واجهة العميل
// ---------------------------------------------------------------------------

function CustomerView({
  session,
  compounds,
  onNotice,
  onLogout,
}: {
  session: Session
  compounds: Compound[]
  onNotice: (m: string) => void
  onLogout: () => void
}) {
  const [tab, setTab] = useState<'home' | 'cars' | 'packages' | 'history' | 'profile'>('home')
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [cars, setCars] = useState<Car[]>([])
  const [subs, setSubs] = useState<Subscription[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [history, setHistory] = useState<WashRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  // نموذج إضافة عربية
  const [showAddCar, setShowAddCar] = useState(false)
  const [carType, setCarType] = useState('')
  const [carColor, setCarColor] = useState('')
  const [carPlate, setCarPlate] = useState('')
  const [carPhoto, setCarPhoto] = useState<string | null>(null)
  // نموذج الاشتراك
  const [subCarId, setSubCarId] = useState<string | null>(null)
  const [subPkg, setSubPkg] = useState<4 | 8 | 12>(4)
  const [subMethod, setSubMethod] = useState<PaymentMethod>('cash')
  const [washBusy, setWashBusy] = useState<string | null>(null)

  const loadAll = async () => {
    const [c, cs, ss, ps, hs] = await Promise.all([
      loadCustomer(session.phone),
      loadCarsOfCustomer(session.phone),
      loadSubscriptionsOfCustomer(session.phone),
      loadPaymentsOfCustomer(session.phone),
      loadWashHistoryOfCustomer(session.phone),
    ])
    setCustomer(c)
    setCars(cs)
    setSubs(ss)
    setPayments(ps)
    setHistory(hs)
    setLoading(false)
  }

  useEffect(() => {
    void loadAll()
    // مزامنة لحظية: الاشتراكات وطلبات الغسيل بتتحدث فور موافقة الأدمن أو إتمام غسلة
    const un1 = subscribeCollection(
      'subscriptions',
      (rows) => {
        setSubs(
          rows
            .map((r) => normalizeSubscription(r.id, r))
            .sort((a, b) => b.createdAt - a.createdAt),
        )
      },
      [where('customerPhone', '==', session.phone)],
    )
    const un2 = subscribeCollection(
      'washRequests',
      (rows) => {
        setHistory(
          rows
            .map((r) => normalizeWash(r.id, r))
            .sort((a, b) => b.requestedAt - a.requestedAt),
        )
      },
      [where('customerPhone', '==', session.phone)],
    )
    const un3 = subscribeCollection(
      'payments',
      (rows) => {
        setPayments(
          rows
            .map((r) => normalizePayment(r.id, r))
            .sort((a, b) => b.createdAt - a.createdAt),
        )
      },
      [where('customerPhone', '==', session.phone)],
    )
    return () => {
      un1()
      un2()
      un3()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.phone])

  function activeSubFor(carId: string): Subscription | undefined {
    return subs.find((s) => s.carId === carId && isSubscriptionActive(s))
  }
  function pendingSubFor(carId: string): Subscription | undefined {
    return subs.find((s) => s.carId === carId && s.status === 'pending_payment')
  }
  function openRequestFor(carId: string): WashRequest | undefined {
    return history.find((w) => w.carId === carId && w.status === 'requested')
  }

  async function addCar(e: FormEvent) {
    e.preventDefault()
    if (!carType.trim() || !carPlate.trim()) {
      onNotice('اكتب نوع العربية ورقم اللوحة.')
      return
    }
    if (!isFirebaseConfigured) {
      onNotice('Firebase غير مربوط — مينفعش نحفظ العربية. اربط مشروع top-service الأول.')
      return
    }
    const id = newDocId('cars')
    if (!id) {
      onNotice('Firebase غير مربوط.')
      return
    }
    setBusy(true)
    const ok = await saveDoc('cars', id, {
      id,
      customerPhone: session.phone,
      customerName: session.name,
      type: carType.trim(),
      color: carColor.trim(),
      plate: carPlate.trim(),
      photoUrl: carPhoto,
      createdAt: Date.now(),
    })
    setBusy(false)
    if (!ok) {
      onNotice('مقدرناش نحفظ العربية — تأكد إن النت شغال وحاول تاني.')
      return
    }
    setCarType('')
    setCarColor('')
    setCarPlate('')
    setCarPhoto(null)
    setShowAddCar(false)
    await loadAll()
    onNotice('تمت إضافة العربية ✅ — اختار لها باقة من تبويب "باقاتي" عشان تبدأ الغسيل.')
  }

  async function subscribeCar() {
    if (!subCarId) return
    const car = cars.find((c) => c.id === subCarId)
    if (!car) return
    const pkg = packageById(subPkg)
    const active = activeSubFor(car.id)
    if (active && active.washesRemaining > 0) {
      onNotice(`العربية دي عندها اشتراك نشط — متبقي ${active.washesRemaining} غسلات حتى ${fmtDate(active.endDate)}. استخدمهم الأول، وبعدها جدّد.`)
      return
    }
    if (pendingSubFor(car.id)) {
      onNotice('في اشتراك بانتظار تأكيد الدفع للعربية دي — استنى موافقة الأدمن.')
      return
    }
    if (!isFirebaseConfigured) {
      onNotice('Firebase غير مربوط — مينفعش نسجّل الاشتراك. اربط مشروع top-service الأول.')
      return
    }
    const subId = newDocId('subscriptions')
    const payId = newDocId('payments')
    if (!subId || !payId) {
      onNotice('Firebase غير مربوط.')
      return
    }
    setBusy(true)
    const now = Date.now()
    const okSub = await saveDoc('subscriptions', subId, {
      id: subId,
      carId: car.id,
      customerPhone: session.phone,
      customerName: session.name,
      carPlate: car.plate,
      carType: car.type,
      packageId: pkg.id,
      price: pkg.price,
      washesTotal: pkg.washes,
      washesRemaining: pkg.washes,
      status: 'pending_payment',
      startDate: 0,
      endDate: monthEndTimestamp(now),
      createdAt: now,
      approvedAt: null,
    })
    const okPay = okSub
      ? await saveDoc('payments', payId, {
          id: payId,
          subscriptionId: subId,
          customerPhone: session.phone,
          customerName: session.name,
          carPlate: car.plate,
          amount: pkg.price,
          method: subMethod,
          status: 'pending',
          receiptNo: null,
          createdAt: now,
          decidedAt: null,
        })
      : false
    setBusy(false)
    if (!okSub || !okPay) {
      onNotice('مقدرناش نسجّل الاشتراك — تأكد إن النت شغال وحاول تاني.')
      return
    }
    setSubCarId(null)
    await loadAll()
    onNotice(
      `تم تسجيل اشتراك باقة ${pkg.washes} غسلات (${pkg.price} جنيه) للعربية ${car.plate} — بانتظار تأكيد الدفع من الإدارة، وبعد الموافقة الاشتراك يبقى نشط لآخر الشهر.`,
    )
  }

  async function requestWash(car: Car, sub: Subscription) {
    if (washBusy) return
    if (sub.washesRemaining <= 0) {
      onNotice('رصيد الغسلات خلص — جدّد اشتراكك الأول (مفيش غسلة مفردة).')
      return
    }
    if (openRequestFor(car.id)) {
      onNotice('في طلب غسلة جاري للعربية دي — استنى لحد ما يتم، وبعدها اطلب تاني.')
      return
    }
    if (!isFirebaseConfigured) {
      onNotice('Firebase غير مربوط — مينفعش نبعت طلب الغسلة. اربط مشروع top-service الأول.')
      return
    }
    const id = newDocId('washRequests')
    if (!id || !customer) {
      onNotice('Firebase غير مربوط.')
      return
    }
    setWashBusy(car.id)
    const ok = await saveDoc('washRequests', id, {
      id,
      carId: car.id,
      customerPhone: session.phone,
      customerName: session.name,
      carPlate: car.plate,
      carType: car.type,
      carColor: car.color,
      compoundId: customer.compoundId,
      compoundName: customer.compoundName,
      building: customer.building,
      apartment: customer.apartment,
      subscriptionId: sub.id,
      status: 'requested',
      requestedAt: Date.now(),
      doneAt: null,
      doneBy: null,
      doneByPhone: null,
    })
    setWashBusy(null)
    if (!ok) {
      onNotice('مقدرناش نبعت طلب الغسلة — تأكد إن النت شغال وحاول تاني.')
      return
    }
    await loadAll()
    onNotice(
      `تم إرسال طلب الغسلة للعربية ${car.plate} ✅ — الغسّال هيغسلها في يوم جدول الكومباوند (${customer.compoundName})، وهتوصلك تأكيد لما تتم.`,
    )
  }

  async function cancelWash(w: WashRequest) {
    if (!isFirebaseConfigured) return
    setWashBusy(w.id)
    const ok = await saveDoc('washRequests', w.id, { status: 'cancelled' })
    setWashBusy(null)
    if (!ok) {
      onNotice('مقدرناش نلغي الطلب — حاول تاني.')
      return
    }
    await loadAll()
    onNotice('تم إلغاء طلب الغسلة — الرصيد متنقصش.')
  }

  if (loading) {
    return (
      <div className="card">
        <p className="muted">بيحمّل بياناتك…</p>
      </div>
    )
  }

  return (
    <>
      <div className="tabs">
        <button className={`tab${tab === 'home' ? ' active' : ''}`} onClick={() => setTab('home')}>
          <HomeIcon /> الرئيسية
        </button>
        <button className={`tab${tab === 'cars' ? ' active' : ''}`} onClick={() => setTab('cars')}>
          <CarIcon /> عربياتي
        </button>
        <button
          className={`tab${tab === 'packages' ? ' active' : ''}`}
          onClick={() => setTab('packages')}
        >
          <WalletIcon /> باقاتي
        </button>
        <button
          className={`tab${tab === 'history' ? ' active' : ''}`}
          onClick={() => setTab('history')}
        >
          <CalendarIcon /> طلباتي
        </button>
        <button
          className={`tab${tab === 'profile' ? ' active' : ''}`}
          onClick={() => setTab('profile')}
        >
          <UserIcon /> الملف الشخصي
        </button>
      </div>

      {tab === 'home' && (
        <>
          {customer && (
            <div className="profile-box">
              <Avatar photoUrl={customer.photoUrl} name={customer.name} />
              <div>
                <b>{customer.name}</b>
                <p className="muted">
                  {customer.compoundName} — عمارة {customer.building} — شقة {customer.apartment}
                </p>
                <p className="muted">كود العميل: {customer.code}</p>
              </div>
            </div>
          )}
          {cars.length === 0 && (
            <div className="card">
              <h2>لسه مضفتش عربيات</h2>
              <p className="muted">ضيف أول عربية ليك عشان تختار لها باقة وتبدأ الغسيل.</p>
              <button className="btn big" onClick={() => setTab('cars')}>
                <PlusIcon /> إضافة عربية
              </button>
            </div>
          )}
          {cars.map((car) => {
            const active = activeSubFor(car.id)
            const pending = pendingSubFor(car.id)
            const open = openRequestFor(car.id)
            const expired = subs.find(
              (s) => s.carId === car.id && s.status === 'active' && !isSubscriptionActive(s),
            )
            return (
              <div className="card" key={car.id}>
                <div className="row">
                  <Avatar photoUrl={car.photoUrl} name={car.type} />
                  <div style={{ flex: 1 }}>
                    <b>
                      {car.type} {car.color ? `— ${car.color}` : ''}
                    </b>
                    <div className="muted">لوحة: {car.plate}</div>
                  </div>
                  {active && <span className="order-badge green">نشط</span>}
                  {pending && <span className="order-badge">بانتظار الدفع</span>}
                  {!active && !pending && <span className="order-badge gray">بدون اشتراك</span>}
                </div>
                {active && (
                  <div className="balance-wrap" style={{ marginTop: 12 }}>
                    <div className={`balance-ring${active.washesRemaining <= 0 ? ' empty' : ''}`}>
                      <span className="num">{active.washesRemaining}</span>
                      <span className="lbl">غسلة متبقية</span>
                    </div>
                    <div className="balance-info">
                      <div className="big-line">
                        متبقي {active.washesRemaining} غسلات حتى {fmtDate(active.endDate)}
                      </div>
                      <div className="muted">
                        باقة {active.washesTotal} غسلات — {active.price} جنيه / شهر
                      </div>
                      {active.washesRemaining <= 2 && (
                        <div className="warn" style={{ marginTop: 8 }}>
                          ⚠️ الرصيد قرب يخلص — جدّد اشتراكك قبل ما ينتهي.
                        </div>
                      )}
                      <div className="progress" style={{ marginTop: 8 }}>
                        <div
                          className="progress-fill"
                          style={{
                            width: `${Math.round((active.washesRemaining / active.washesTotal) * 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                )}
                {pending && (
                  <p className="muted" style={{ marginTop: 10 }}>
                    اشتراك باقة {pending.washesTotal} غسلات ({pending.price} جنيه) بانتظار تأكيد
                    الدفع من الإدارة.
                  </p>
                )}
                {!active && !pending && (
                  <p className="muted" style={{ marginTop: 10 }}>
                    {expired
                      ? 'الاشتراك السابق انتهى (خلص الشهر أو خلص الرصيد) — جدّد عشان تكمل.'
                      : 'العربية دي لسه ملهاش اشتراك — اختار باقة من تبويب "باقاتي".'}
                  </p>
                )}
                {active && active.washesRemaining > 0 && (
                  <>
                    {open ? (
                      <div className="notice" style={{ marginTop: 10 }}>
                        ✅ طلب غسلة جاري للعربية دي (من {fmtDateTime(open.requestedAt)}) — الغسّال
                        هيغسلها في يوم جدول الكومباوند.
                        <div className="row">
                          <button
                            className="link-btn"
                            onClick={() => void cancelWash(open)}
                            disabled={washBusy === open.id}
                          >
                            إلغاء الطلب (الرصيد مش هينقص)
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        className="btn big"
                        onClick={() => void requestWash(car, active)}
                        disabled={washBusy === car.id}
                      >
                        <DropIcon /> اطلب غسلة
                      </button>
                    )}
                  </>
                )}
                {(!active || active.washesRemaining <= 0) && !pending && (
                  <button className="btn big plum" onClick={() => setTab('packages')}>
                    <RefreshIcon /> تجديد الاشتراك
                  </button>
                )}
              </div>
            )
          })}
          <div className="card">
            <h3>📅 جدول الغسيل</h3>
            <p className="muted">
              الغسيل بيتم في أيام جدول الشركة الثابت لكل كومباوند — انت بتختار العربية بس،
              والغسّال بييجي في يوم الجدول.
              {customer?.compoundName
                ? ` كومباوند ${customer.compoundName}: ${
                    compounds.find((c) => c.name === customer.compoundName)?.scheduleNote ||
                    'الجدول عند الإدارة'
                  }.`
                : ''}
            </p>
          </div>
        </>
      )}

      {tab === 'cars' && (
        <div className="card">
          <h2>عربياتي</h2>
          {cars.length === 0 && <p className="muted">لسه مضفتش عربيات.</p>}
          {cars.map((car) => (
            <div className="ride" key={car.id}>
              <div className="row">
                <Avatar photoUrl={car.photoUrl} name={car.type} />
                <div style={{ flex: 1 }}>
                  <b>{car.type}</b>
                  <div className="muted">
                    {car.color} — لوحة: {car.plate}
                  </div>
                </div>
                {activeSubFor(car.id) ? (
                  <span className="order-badge green">
                    متبقي {activeSubFor(car.id)?.washesRemaining} غسلات
                  </span>
                ) : (
                  <span className="order-badge gray">بدون اشتراك نشط</span>
                )}
              </div>
            </div>
          ))}
          {!showAddCar ? (
            <button className="btn big" onClick={() => setShowAddCar(true)}>
              <PlusIcon /> إضافة عربية جديدة
            </button>
          ) : (
            <form onSubmit={(e) => void addCar(e)}>
              <h3>عربية جديدة</h3>
              <label>نوع العربية / الموديل</label>
              <input
                type="text"
                placeholder="مثال: هيونداي النترا"
                value={carType}
                onChange={(e) => setCarType(e.target.value)}
              />
              <label>اللون</label>
              <input
                type="text"
                placeholder="مثال: أبيض"
                value={carColor}
                onChange={(e) => setCarColor(e.target.value)}
              />
              <label>رقم اللوحة</label>
              <input
                type="text"
                placeholder="مثال: س ع د 1234"
                value={carPlate}
                onChange={(e) => setCarPlate(e.target.value)}
              />
              <label>صورة العربية (اختياري)</label>
              <PhotoField photo={carPhoto} onPhoto={setCarPhoto} notice={onNotice} />
              <button className="btn big" type="submit" disabled={busy}>
                {busy ? 'بيحفظ…' : 'حفظ العربية'}
              </button>
              <button type="button" className="link-btn" onClick={() => setShowAddCar(false)}>
                إلغاء
              </button>
            </form>
          )}
        </div>
      )}

      {tab === 'packages' && (
        <div className="card">
          <h2>باقاتي</h2>
          <p className="muted">
            كل عربية لها اشتراك منفصل. الغسلات غير المستخدمة تنتهي آخر الشهر ولا تُرحَّل،
            ولو خلص الرصيد جدّد اشتراكك مبكراً — مفيش غسلة مفردة.
          </p>
          {cars.length === 0 && <p className="muted">ضيف عربية الأول من تبويب "عربياتي".</p>}
          {cars.map((car) => {
            const active = activeSubFor(car.id)
            const pending = pendingSubFor(car.id)
            const past = subs
              .filter((s) => s.carId === car.id && s.status !== 'pending_payment')
              .slice(0, 3)
            return (
              <div className="ride" key={car.id}>
                <b>
                  {car.type} — {car.plate}
                </b>
                {active && (
                  <p className="muted">
                    اشتراك نشط: باقة {active.washesTotal} غسلات — متبقي{' '}
                    {active.washesRemaining} حتى {fmtDate(active.endDate)}
                  </p>
                )}
                {pending && (
                  <p className="muted">
                    ⏳ باقة {pending.washesTotal} غسلات ({pending.price} جنيه) بانتظار تأكيد
                    الدفع من الإدارة.
                  </p>
                )}
                {!active && !pending && past.length > 0 && (
                  <p className="muted">آخر اشتراك: باقة {past[0].washesTotal} — {past[0].status === 'active' ? 'انتهى' : past[0].status === 'rejected' ? 'اترفض الدفع' : past[0].status}.</p>
                )}
                <button
                  className="btn small"
                  onClick={() => {
                    setSubCarId(subCarId === car.id ? null : car.id)
                    setSubPkg(4)
                    setSubMethod('cash')
                  }}
                  disabled={!!pending || (!!active && active.washesRemaining > 0)}
                >
                  {subCarId === car.id ? 'إلغاء الاختيار' : 'اشترك / جدّد'}
                </button>
                {subCarId === car.id && (
                  <div style={{ marginTop: 12 }}>
                    <label>اختار الباقة</label>
                    {PACKAGES.map((p) => (
                      <div
                        key={p.id}
                        className={`pkg${subPkg === p.id ? ' selected' : ''}`}
                        onClick={() => setSubPkg(p.id)}
                      >
                        <div className="row" style={{ justifyContent: 'space-between' }}>
                          <span className="pkg-washes">باقة {p.washes} غسلات / شهر</span>
                          <span className="pkg-price">{p.price} جنيه</span>
                        </div>
                        <div className="muted">
                          {Math.round(p.price / p.washes)} جنيه للغسلة الواحدة
                        </div>
                      </div>
                    ))}
                    <label>طريقة الدفع (تأكيد يدوي من الإدارة في المرحلة 1)</label>
                    <select
                      value={subMethod}
                      onChange={(e) => setSubMethod(e.target.value as PaymentMethod)}
                    >
                      <option value="cash">نقدي (يؤكده الأدمن)</option>
                      <option value="visa">فيزا</option>
                      <option value="wallet">محفظة إلكترونية</option>
                    </select>
                    <button className="btn big" onClick={() => void subscribeCar()} disabled={busy}>
                      {busy ? 'بيسجّل…' : `تأكيد الاشتراك — ${packageById(subPkg).price} جنيه`}
                    </button>
                  </div>
                )}
              </div>
            )
          })}
          <h3>مدفوعاتي</h3>
          {payments.length === 0 && <p className="muted">لسه مفيش مدفوعات.</p>}
          {payments.map((p) => (
            <div className="ride" key={p.id}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <b>{p.amount} جنيه — {p.carPlate}</b>
                {p.status === 'pending' && <span className="order-badge">بانتظار التأكيد</span>}
                {p.status === 'approved' && <span className="order-badge green">تم التأكيد</span>}
                {p.status === 'rejected' && <span className="order-badge red">مرفوضة</span>}
              </div>
              <div className="muted">
                {p.method === 'cash' ? 'نقدي' : p.method === 'visa' ? 'فيزا' : 'محفظة'} —{' '}
                {fmtDateTime(p.createdAt)}
                {p.receiptNo ? ` — إيصال رقم ${p.receiptNo}` : ''}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'history' && (
        <div className="card">
          <h2>طلباتي وسجل الغسيل</h2>
          {history.length === 0 && <p className="muted">لسه مفيش طلبات غسيل.</p>}
          {history.map((w) => (
            <div className="ride" key={w.id}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <b>
                  {w.carType} — {w.carPlate}
                </b>
                {w.status === 'requested' && <span className="order-badge">جارية</span>}
                {w.status === 'done' && <span className="order-badge green">تم الغسيل ✅</span>}
                {w.status === 'cancelled' && <span className="order-badge gray">ملغاة</span>}
              </div>
              <div className="muted">
                طلبت {fmtDateTime(w.requestedAt)}
                {w.status === 'done' && w.doneAt
                  ? ` — اتغسلت ${fmtDateTime(w.doneAt)}${w.doneBy ? ` (بواسطة ${w.doneBy})` : ''}`
                  : ''}
              </div>
              {w.status === 'requested' && (
                <button
                  className="link-btn"
                  onClick={() => void cancelWash(w)}
                  disabled={washBusy === w.id}
                >
                  إلغاء الطلب
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === 'profile' && (
        <div className="card">
          <h2>الملف الشخصي</h2>
          {customer ? (
            <>
              <div className="profile-box">
                <Avatar photoUrl={customer.photoUrl} name={customer.name} lg />
                <div>
                  <b>{customer.name}</b>
                  <p className="muted">كود العميل: {customer.code}</p>
                  <p className="muted">الموبايل: {session.phoneDisplay}</p>
                </div>
              </div>
              <div className="ride">
                <div className="muted">الكومباوند: <b>{customer.compoundName}</b></div>
                <div className="muted">العمارة: <b>{customer.building}</b> — الشقة: <b>{customer.apartment}</b></div>
                <div className="muted">عربيات مسجلة: <b>{cars.length}</b></div>
              </div>
            </>
          ) : (
            <p className="muted">بياناتك لسه متحفظتش — ارجع لخطوة استكمال البيانات.</p>
          )}
          <button className="btn danger big" onClick={onLogout}>
            <LogoutIcon /> تسجيل خروج
          </button>
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
//  واجهة الغسّال — عربيات اليوم + البحث الفوري + "تم الغسيل"
// ---------------------------------------------------------------------------

function WasherView({
  session,
  onNotice,
  onLogout,
}: {
  session: Session
  onNotice: (m: string) => void
  onLogout: () => void
}) {
  const [tab, setTab] = useState<'today' | 'history'>('today')
  const [washer, setWasher] = useState<Washer | null>(null)
  const [requests, setRequests] = useState<WashRequest[]>([])
  const [doneList, setDoneList] = useState<WashRequest[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [compounds, setCompounds] = useState<Compound[]>([])

  const loadAll = async () => {
    const [w, reqs, done, comps] = await Promise.all([
      loadWasher(session.phone),
      loadOpenWashRequests(),
      loadWasherDoneWashes(session.phone),
      loadCompounds(),
    ])
    setWasher(w)
    setRequests(reqs)
    setDoneList(done)
    setCompounds(comps)
    setLoading(false)
  }

  useEffect(() => {
    void loadAll()
    const un = subscribeCollection('washRequests', (rows) => {
      const all = rows.map((r) => normalizeWash(r.id, r))
      setRequests(
        all.filter((w) => w.status === 'requested').sort((a, b) => a.requestedAt - b.requestedAt),
      )
      setDoneList(
        all
          .filter((w) => w.status === 'done' && w.doneByPhone === session.phone)
          .sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0)),
      )
    })
    return () => un()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.phone])

  /** طلبات اليوم الخاصة بالغسّال: كومباونداته المربوطة (لو مفيش ربط — كل الطلبات). */
  const myRequests = useMemo(() => {
    if (washer && washer.compoundIds.length > 0) {
      return requests.filter((w) => washer.compoundIds.includes(w.compoundId))
    }
    return requests
  }, [requests, washer])

  /** البحث الفوري: لوحة (حروف/أرقام) أو نوع العربية أو اسم العميل أو رقمه. */
  const filtered = useMemo(() => {
    const q = norm(search)
    if (!q) return myRequests
    return myRequests.filter((w) => {
      const hay = [
        norm(w.carPlate),
        norm(w.carType),
        norm(w.customerName),
        norm(w.customerPhone),
        norm(w.compoundName),
        norm(w.building),
      ].join(' ')
      return hay.includes(q)
    })
  }, [myRequests, search])

  /** تجميع بالكومباوند ثم العمارة — عشان يغسل كل عربيات العمارة في جولة واحدة. */
  const grouped = useMemo(() => {
    const groups = new Map<string, Map<string, WashRequest[]>>()
    for (const w of filtered) {
      const compKey = w.compoundName || 'بدون كومباوند'
      let byBuilding = groups.get(compKey)
      if (!byBuilding) {
        byBuilding = new Map<string, WashRequest[]>()
        groups.set(compKey, byBuilding)
      }
      const bKey = `عمارة ${w.building || '—'}`
      const list = byBuilding.get(bKey) ?? []
      list.push(w)
      byBuilding.set(bKey, list)
    }
    return [...groups.entries()].map(([comp, byBuilding]) => ({
      comp,
      buildings: [...byBuilding.entries()].map(([b, list]) => ({ b, list })),
    }))
  }, [filtered])

  async function markDone(w: WashRequest) {
    if (busyId) return
    setBusyId(w.id)
    const r = await completeWash(w.id, session.name || 'غسّال', session.phone)
    setBusyId(null)
    if (!r.ok) {
      onNotice(r.message)
      return
    }
    await loadAll()
    onNotice(r.message)
  }

  if (loading) {
    return (
      <div className="card">
        <p className="muted">بيحمّل عربيات اليوم…</p>
      </div>
    )
  }

  return (
    <>
      <div className="tabs">
        <button className={`tab${tab === 'today' ? ' active' : ''}`} onClick={() => setTab('today')}>
          <CarIcon /> عربيات اليوم
        </button>
        <button
          className={`tab${tab === 'history' ? ' active' : ''}`}
          onClick={() => setTab('history')}
        >
          <CalendarIcon /> سجلي
        </button>
      </div>

      {tab === 'today' && (
        <>
          <div className="profile-box">
            <Avatar photoUrl={null} name={session.name} />
            <div>
              <b>{session.name}</b>
              <p className="muted">
                {washer && washer.compoundIds.length > 0
                  ? `كومباونداتك: ${washer.compoundIds
                      .map((id) => compounds.find((c) => c.id === id)?.name ?? id)
                      .join('، ')}`
                  : 'لسه متربطتش بكومباوندات — شايف كل الطلبات لحد ما الأدمن يربطك.'}
              </p>
            </div>
          </div>
          <div className="search-box">
            <SearchIcon />
            <input
              type="text"
              placeholder="ابحث برقم اللوحة أو نوع العربية أو اسم العميل أو رقمه…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="row">
            <span className="badge">
              <CarIcon /> {filtered.length} عربية في القائمة
            </span>
          </div>
          {filtered.length === 0 && (
            <div className="card">
              <p className="muted">
                {search ? 'مفيش عربية مطابقة للبحث ده.' : 'مفيش طلبات غسيل جارية دلوقتي.'}
              </p>
            </div>
          )}
          {grouped.map((g) => (
            <div key={g.comp}>
              <div className="group-head">
                <BuildingIcon /> {g.comp}
              </div>
              {g.buildings.map((bg) => (
                <div key={bg.b}>
                  <h3 style={{ margin: '10px 4px 4px' }}>{bg.b}</h3>
                  {bg.list.map((w) => (
                    <div className="ride" key={w.id}>
                      <div className="row" style={{ justifyContent: 'space-between' }}>
                        <b>
                          {w.carType} — {w.carPlate}
                        </b>
                        <span className="order-badge">{w.carColor || 'بدون لون'}</span>
                      </div>
                      <div className="muted">
                        العميل: {w.customerName} — {w.customerPhone}
                      </div>
                      <div className="muted">
                        شقة {w.apartment} — طلب {fmtDateTime(w.requestedAt)}
                      </div>
                      <button
                        className="btn big active"
                        onClick={() => void markDone(w)}
                        disabled={busyId === w.id}
                      >
                        <CheckIcon /> {busyId === w.id ? 'بيحفظ…' : 'تم الغسيل'}
                      </button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </>
      )}

      {tab === 'history' && (
        <div className="card">
          <h2>سجل الغسيل بتاعي</h2>
          <p className="muted">غسلات أنجزتها: {doneList.length}</p>
          {doneList.length === 0 && <p className="muted">لسه مخلصتش أي غسلة.</p>}
          {doneList.map((w) => (
            <div className="ride" key={w.id}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <b>
                  {w.carType} — {w.carPlate}
                </b>
                <span className="order-badge green">تم ✅</span>
              </div>
              <div className="muted">
                {w.customerName} — {w.compoundName} — عمارة {w.building} — شقة {w.apartment}
              </div>
              <div className="muted">{w.doneAt ? fmtDateTime(w.doneAt) : ''}</div>
            </div>
          ))}
          <button className="btn danger big" onClick={onLogout}>
            <LogoutIcon /> تسجيل خروج
          </button>
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
//  لوحة الأدمن (صلاح) — إحصائيات + عملاء + مدفوعات + غسلات اليوم + إدارة
// ---------------------------------------------------------------------------

function AdminView({
  session,
  compounds,
  onCompounds,
  onNotice,
  onLogout,
}: {
  session: Session
  compounds: Compound[]
  onCompounds: (c: Compound[]) => void
  onNotice: (m: string) => void
  onLogout: () => void
}) {
  const [tab, setTab] = useState<'dash' | 'customers' | 'payments' | 'today' | 'manage'>('dash')
  const [customers, setCustomers] = useState<Customer[]>([])
  const [allCars, setAllCars] = useState<Car[]>([])
  const [subs, setSubs] = useState<Subscription[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [washers, setWashers] = useState<Washer[]>([])
  const [requests, setRequests] = useState<WashRequest[]>([])
  const [doneToday, setDoneToday] = useState<WashRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [payBusy, setPayBusy] = useState<string | null>(null)
  // إدارة: إضافة كومباوند
  const [newCompoundName, setNewCompoundName] = useState('')
  const [newCompoundSchedule, setNewCompoundSchedule] = useState('')
  // إدارة: إضافة غسّال
  const [newWasherName, setNewWasherName] = useState('')
  const [newWasherPhone, setNewWasherPhone] = useState('')
  const [newWasherCompounds, setNewWasherCompounds] = useState<string[]>([])

  const loadAll = async () => {
    const [cs, cars, ss, ps, ws, reqs] = await Promise.all([
      loadAllCustomers(),
      loadAllCars(),
      loadAllSubscriptions(),
      loadAllPayments(),
      loadAllWashers(),
      loadOpenWashRequests(),
    ])
    setCustomers(cs)
    setAllCars(cars)
    setSubs(ss)
    setPayments(ps)
    setWashers(ws)
    setRequests(reqs)
    // غسلات اليوم المنجزة (من كل الطلبات المكتملة النهاردة — نقرأها من السجل العام)
    const all = await loadCollectionForDoneToday()
    setDoneToday(all)
    setLoading(false)
  }

  async function loadCollectionForDoneToday(): Promise<WashRequest[]> {
    // نقرأ كل الطلبات ونصفّي محلياً (where واحد + ترتيب محلي — بدون فهرس مركّب)
    const rows = await loadCollection('washRequests')
    const start = todayStart()
    return rows
      .map((r) => normalizeWash(r.id, r))
      .filter((w) => w.status === 'done' && (w.doneAt ?? 0) >= start)
      .sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0))
  }

  useEffect(() => {
    void loadAll()
    const un1 = subscribeCollection('payments', (rows) => {
      setPayments(
        rows.map((r) => normalizePayment(r.id, r)).sort((a, b) => b.createdAt - a.createdAt),
      )
    })
    const un2 = subscribeCollection('subscriptions', (rows) => {
      setSubs(
        rows
          .map((r) => normalizeSubscription(r.id, r))
          .sort((a, b) => b.createdAt - a.createdAt),
      )
    })
    const un3 = subscribeCollection('washRequests', (rows) => {
      const all = rows.map((r) => normalizeWash(r.id, r))
      setRequests(
        all.filter((w) => w.status === 'requested').sort((a, b) => a.requestedAt - b.requestedAt),
      )
      setDoneToday(
        all
          .filter((w) => w.status === 'done' && (w.doneAt ?? 0) >= todayStart())
          .sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0)),
      )
    })
    const un4 = subscribeCollection('customers', (rows) => {
      setCustomers(
        rows
          .map((r) => normalizeCustomer(r.id, r))
          .sort((a, b) => b.createdAt - a.createdAt),
      )
    })
    return () => {
      un1()
      un2()
      un3()
      un4()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const stats = useMemo(() => {
    const activeSubs = subs.filter((s) => isSubscriptionActive(s))
    const revenue = payments
      .filter((p) => p.status === 'approved' && sameMonth(p.createdAt, Date.now()))
      .reduce((sum, p) => sum + p.amount, 0)
    const totalRemaining = activeSubs.reduce((sum, s) => sum + s.washesRemaining, 0)
    return {
      subscribers: customers.length,
      activeSubs: activeSubs.length,
      revenue,
      todayWashes: doneToday.length,
      totalRemaining,
    }
  }, [customers, subs, payments, doneToday])

  const filteredCustomers = useMemo(() => {
    const q = norm(search)
    if (!q) return customers
    return customers.filter((c) => {
      const carsOf = allCars.filter((car) => car.customerPhone === c.phone)
      const hay = [
        norm(c.name),
        norm(c.phone),
        norm(c.code),
        norm(c.compoundName),
        ...carsOf.flatMap((car) => [norm(car.plate), norm(car.type)]),
      ].join(' ')
      return hay.includes(q)
    })
  }, [customers, allCars, search])

  async function decidePayment(p: Payment, approve: boolean) {
    if (payBusy) return
    setPayBusy(p.id)
    const r = approve
      ? await approvePayment(p.id, p.subscriptionId)
      : await rejectPayment(p.id, p.subscriptionId)
    setPayBusy(null)
    if (!r.ok) {
      onNotice(r.message)
      return
    }
    await loadAll()
    onNotice(r.message)
  }

  async function markDone(w: WashRequest) {
    if (busyId) return
    setBusyId(w.id)
    const r = await completeWash(w.id, 'الأدمن (صلاح)', session.phone)
    setBusyId(null)
    if (!r.ok) {
      onNotice(r.message)
      return
    }
    await loadAll()
    onNotice(r.message)
  }

  async function addCompound(e: FormEvent) {
    e.preventDefault()
    if (!newCompoundName.trim()) {
      onNotice('اكتب اسم الكومباوند.')
      return
    }
    if (!isFirebaseConfigured) {
      onNotice('Firebase غير مربوط — مينفعش نحفظ الكومباوند.')
      return
    }
    const id = newDocId('compounds')
    if (!id) return
    setBusyId('compound')
    const ok = await saveDoc('compounds', id, {
      id,
      name: newCompoundName.trim(),
      scheduleNote: newCompoundSchedule.trim(),
      createdAt: Date.now(),
    })
    setBusyId(null)
    if (!ok) {
      onNotice('مقدرناش نحفظ الكومباوند — حاول تاني.')
      return
    }
    setNewCompoundName('')
    setNewCompoundSchedule('')
    const list = await loadCompounds()
    onCompounds(list)
    onNotice(`تمت إضافة كومباوند ${newCompoundName.trim()} ✅`)
  }

  async function addWasher(e: FormEvent) {
    e.preventDefault()
    if (newWasherName.trim().length < 2) {
      onNotice('اكتب اسم الغسّال.')
      return
    }
    const e164 = toE164Phone(newWasherPhone)
    if (!e164) {
      onNotice('رقم موبايل الغسّال غير صحيح — اكتب رقم مصري 11 رقم يبدأ بـ 01.')
      return
    }
    if (!isFirebaseConfigured) {
      onNotice('Firebase غير مربوط — مينفعش نحفظ الغسّال.')
      return
    }
    setBusyId('washer')
    const ok = await saveDoc('washers', e164, {
      phone: e164,
      name: newWasherName.trim(),
      compoundIds: newWasherCompounds,
      active: true,
      createdAt: Date.now(),
    })
    setBusyId(null)
    if (!ok) {
      onNotice('مقدرناش نحفظ الغسّال — حاول تاني.')
      return
    }
    setNewWasherName('')
    setNewWasherPhone('')
    setNewWasherCompounds([])
    await loadAll()
    onNotice(`تمت إضافة الغسّال ${newWasherName.trim()} ✅ — هيدخل برقمه والـ OTP.`)
  }

  function toggleWasherCompound(id: string) {
    setNewWasherCompounds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  if (loading) {
    return (
      <div className="card">
        <p className="muted">بيحمّل لوحة التحكم…</p>
      </div>
    )
  }

  const pendingPayments = payments.filter((p) => p.status === 'pending')
  const receipts = payments.filter((p) => p.status !== 'pending')

  return (
    <>
      <div className="tabs">
        <button className={`tab${tab === 'dash' ? ' active' : ''}`} onClick={() => setTab('dash')}>
          <HomeIcon /> لوحة التحكم
        </button>
        <button
          className={`tab${tab === 'customers' ? ' active' : ''}`}
          onClick={() => setTab('customers')}
        >
          <UsersIcon /> العملاء
        </button>
        <button
          className={`tab${tab === 'payments' ? ' active' : ''}`}
          onClick={() => setTab('payments')}
        >
          <ReceiptIcon /> المدفوعات
        </button>
        <button className={`tab${tab === 'today' ? ' active' : ''}`} onClick={() => setTab('today')}>
          <DropIcon /> غسلات اليوم
        </button>
        <button
          className={`tab${tab === 'manage' ? ' active' : ''}`}
          onClick={() => setTab('manage')}
        >
          <ShieldIcon /> الإدارة
        </button>
      </div>

      {tab === 'dash' && (
        <div className="card">
          <h2>أهلاً يا صلاح 👋</h2>
          <div className="stat-grid">
            <div className="stat">
              <div className="v">{stats.subscribers}</div>
              <div className="k">مشترك (عميل)</div>
            </div>
            <div className="stat">
              <div className="v">{stats.activeSubs}</div>
              <div className="k">اشتراك نشط</div>
            </div>
            <div className="stat">
              <div className="v">{stats.revenue} ج</div>
              <div className="k">إيراد الشهر</div>
            </div>
            <div className="stat">
              <div className="v">{stats.todayWashes}</div>
              <div className="k">غسلات اليوم (تمت)</div>
            </div>
            <div className="stat">
              <div className="v">{stats.totalRemaining}</div>
              <div className="k">غسلات متبقية إجمالي</div>
            </div>
            <div className="stat">
              <div className="v">{pendingPayments.length}</div>
              <div className="k">مدفوعات بانتظار التأكيد</div>
            </div>
          </div>
          {pendingPayments.length > 0 && (
            <button className="btn big" onClick={() => setTab('payments')}>
              <ReceiptIcon /> في {pendingPayments.length} دفعة بانتظار تأكيدك — راجعهم
            </button>
          )}
          <button className="btn danger big" onClick={onLogout}>
            <LogoutIcon /> تسجيل خروج
          </button>
        </div>
      )}

      {tab === 'customers' && (
        <div className="card">
          <h2>العملاء ({filteredCustomers.length})</h2>
          <div className="search-box">
            <SearchIcon />
            <input
              type="text"
              placeholder="ابحث بالاسم أو التليفون أو اللوحة أو الكومباوند…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {filteredCustomers.length === 0 && <p className="muted">مفيش عملاء مطابقين.</p>}
          {filteredCustomers.map((c) => {
            const carsOf = allCars.filter((car) => car.customerPhone === c.phone)
            const subsOf = subs.filter((s) => s.customerPhone === c.phone)
            return (
              <div className="ride" key={c.phone}>
                <div className="row">
                  <Avatar photoUrl={c.photoUrl} name={c.name} />
                  <div style={{ flex: 1 }}>
                    <b>{c.name}</b>
                    <div className="muted">
                      {c.phone} — {c.code}
                    </div>
                    <div className="muted">
                      {c.compoundName} — عمارة {c.building} — شقة {c.apartment}
                    </div>
                  </div>
                </div>
                {carsOf.length === 0 && <p className="muted">لسه مضافش عربيات.</p>}
                {carsOf.map((car) => {
                  const active = subsOf.find(
                    (s) => s.carId === car.id && isSubscriptionActive(s),
                  )
                  const pending = subsOf.find(
                    (s) => s.carId === car.id && s.status === 'pending_payment',
                  )
                  return (
                    <div key={car.id} className="muted" style={{ marginTop: 6 }}>
                      🚗 {car.type} — {car.plate} —{' '}
                      {active ? (
                        <b style={{ color: '#15803d' }}>
                          نشط: متبقي {active.washesRemaining} حتى {fmtDate(active.endDate)}
                        </b>
                      ) : pending ? (
                        <b style={{ color: '#8a3d24' }}>بانتظار تأكيد الدفع</b>
                      ) : (
                        <span>بدون اشتراك نشط</span>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}

      {tab === 'payments' && (
        <div className="card">
          <h2>المدفوعات المعلّقة ({pendingPayments.length})</h2>
          {pendingPayments.length === 0 && <p className="muted">مفيش مدفوعات بانتظار التأكيد.</p>}
          {pendingPayments.map((p) => (
            <div className="ride" key={p.id}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <b>
                  {p.customerName} — {p.amount} جنيه
                </b>
                <span className="order-badge">معلّقة</span>
              </div>
              <div className="muted">
                {p.carPlate} — {p.method === 'cash' ? 'نقدي' : p.method === 'visa' ? 'فيزا' : 'محفظة'} —{' '}
                {fmtDateTime(p.createdAt)}
              </div>
              <div className="row">
                <button
                  className="btn small active"
                  onClick={() => void decidePayment(p, true)}
                  disabled={payBusy === p.id}
                >
                  <CheckIcon /> تأكيد الدفع
                </button>
                <button
                  className="btn small danger"
                  onClick={() => void decidePayment(p, false)}
                  disabled={payBusy === p.id}
                >
                  <XIcon /> رفض
                </button>
              </div>
            </div>
          ))}
          <h3>سجل الإيصالات</h3>
          {receipts.length === 0 && <p className="muted">لسه مفيش إيصالات.</p>}
          {receipts.map((p) => (
            <div className="ride" key={p.id}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <b>
                  {p.receiptNo ?? '—'} — {p.amount} جنيه
                </b>
                {p.status === 'approved' ? (
                  <span className="order-badge green">تم التأكيد</span>
                ) : (
                  <span className="order-badge red">مرفوضة</span>
                )}
              </div>
              <div className="muted">
                {p.customerName} — {p.carPlate} — {fmtDateTime(p.createdAt)}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'today' && (
        <div className="card">
          <h2>غسلات اليوم</h2>
          <p className="muted">
            طلبات جارية: {requests.length} — تمت النهاردة: {doneToday.length}
          </p>
          {requests.length === 0 && <p className="muted">مفيش طلبات غسيل جارية دلوقتي.</p>}
          {requests.map((w) => (
            <div className="ride" key={w.id}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <b>
                  {w.carType} — {w.carPlate}
                </b>
                <span className="order-badge">{w.compoundName}</span>
              </div>
              <div className="muted">
                {w.customerName} — {w.customerPhone} — عمارة {w.building} — شقة {w.apartment}
              </div>
              <div className="muted">طلب {fmtDateTime(w.requestedAt)}</div>
              <button
                className="btn big active"
                onClick={() => void markDone(w)}
                disabled={busyId === w.id}
              >
                <CheckIcon /> {busyId === w.id ? 'بيحفظ…' : 'تم الغسيل'}
              </button>
            </div>
          ))}
          {doneToday.length > 0 && (
            <>
              <h3>تمت النهاردة ✅</h3>
              {doneToday.map((w) => (
                <div className="ride" key={w.id}>
                  <b>
                    {w.carType} — {w.carPlate}
                  </b>
                  <div className="muted">
                    {w.customerName} — {w.doneBy ?? ''} — {w.doneAt ? fmtDateTime(w.doneAt) : ''}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {tab === 'manage' && (
        <>
          <div className="card">
            <h2>الكومباوندات ({compounds.length})</h2>
            {compounds.map((c) => (
              <div className="ride" key={c.id}>
                <b>
                  <BuildingIcon /> {c.name}
                </b>
                {c.scheduleNote && <div className="muted">الجدول: {c.scheduleNote}</div>}
              </div>
            ))}
            <form onSubmit={(e) => void addCompound(e)}>
              <h3>إضافة كومباوند</h3>
              <label>اسم الكومباوند</label>
              <input
                type="text"
                placeholder="مثال: مدينتي"
                value={newCompoundName}
                onChange={(e) => setNewCompoundName(e.target.value)}
              />
              <label>جدول الغسيل الثابت (اختياري)</label>
              <input
                type="text"
                placeholder="مثال: السبت والثلاثاء"
                value={newCompoundSchedule}
                onChange={(e) => setNewCompoundSchedule(e.target.value)}
              />
              <button className="btn big" type="submit" disabled={busyId === 'compound'}>
                <PlusIcon /> إضافة الكومباوند
              </button>
            </form>
          </div>
          <div className="card">
            <h2>الغسّالين ({washers.length})</h2>
            {washers.map((w) => (
              <div className="ride" key={w.phone}>
                <b>
                  <UserIcon /> {w.name}
                </b>
                <div className="muted">{w.phone}</div>
                <div className="muted">
                  {w.compoundIds.length > 0
                    ? `كومباوندات: ${w.compoundIds
                        .map((id) => compounds.find((c) => c.id === id)?.name ?? id)
                        .join('، ')}`
                    : 'مش مربوط بكومباوندات بعد'}
                </div>
              </div>
            ))}
            <form onSubmit={(e) => void addWasher(e)}>
              <h3>إضافة غسّال</h3>
              <label>اسم الغسّال</label>
              <input
                type="text"
                placeholder="مثال: محمد أحمد"
                value={newWasherName}
                onChange={(e) => setNewWasherName(e.target.value)}
              />
              <label>رقم موبايل الغسّال</label>
              <input
                type="tel"
                placeholder="01xxxxxxxxx"
                value={newWasherPhone}
                onChange={(e) => setNewWasherPhone(e.target.value)}
                dir="ltr"
                style={{ textAlign: 'center' }}
              />
              <label>الكومباوندات اللي هيشتغل فيها</label>
              {compounds.length === 0 && (
                <p className="muted">ضيف كومباوند الأول من فوق.</p>
              )}
              {compounds.map((c) => (
                <label key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 600 }}>
                  <input
                    type="checkbox"
                    checked={newWasherCompounds.includes(c.id)}
                    onChange={() => toggleWasherCompound(c.id)}
                  />
                  {c.name}
                </label>
              ))}
              <button className="btn big" type="submit" disabled={busyId === 'washer'}>
                <PlusIcon /> إضافة الغسّال
              </button>
            </form>
          </div>
        </>
      )}
    </>
  )
}
