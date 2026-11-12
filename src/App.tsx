// ---------------------------------------------------------------------------
//  Top Service — المرحلة 1 (v15)
//  دخول OTP خطوة بخطوة (تليفون ← كود) — الدور بيتحدد من الرقم نفسه:
//  رقم الأدمن → أدمن، رقم مسجّل كعامل غسيل → عامل غسيل، غير كده → عميل.
//  بيانات العميل والعربية + باقات شهرية + لوحة أدمن + تأكيد دفع يدوي.
//  الغسيل بجدول مراحل ثابت: الأدمن بيحدد مراحل كل كومباوند (مجموعة أيام
//  أسبوع) ويربط كل عربية بمرحلة — العميل مبيطلبش غسلة، وعامل الغسيل
//  بيشوف عربيات النهاردة بس ويعلّم "تم الغسيل" (مع صورة اختيارية كإثبات).
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
  confirmCollection,
  deleteDocById,
  getLastFirestoreError,
  loadAllCars,
  loadAllCustomers,
  loadAllPayments,
  loadAllSubscriptions,
  loadAllWashers,
  loadCarsOfCustomer,
  loadCollection,
  loadCompounds,
  loadCustomer,
  loadPaymentsOfCustomer,
  loadSubscriptionsOfCustomer,
  loadWashHistoryOfCustomer,
  loadWasher,
  loadWasherDoneWashes,
  newDocId,
  normalizeCar,
  normalizeCustomer,
  normalizePayment,
  normalizeSubscription,
  normalizeWash,
  recordWashDone,
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
  COMPANY_PHONE,
  COMPANY_PHONE_E164,
  COMPANY_WHATSAPP_URL,
  PACKAGES,
  WEEKDAY_NAMES,
  fmtDate,
  fmtDateTime,
  isCollectionOpen,
  isSubscriptionActive,
  monthEndTimestamp,
  packageById,
  paymentCollectionStatus,
  phaseDaysLabel,
  proratedFirstMonthAmount,
  todayWeekday,
} from './types'
import type {
  Car,
  CollectionStatus,
  Compound,
  Customer,
  Payment,
  PaymentMethod,
  Phase,
  Subscription,
  Washer,
  WashRequest,
} from './types'
import { phaseOf, todayCars } from './schedule'
import type { TodayCar } from './schedule'
import { WashCalendar } from './WashCalendar'
import { reconcilePaymentReminders } from './reminders'
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

/** أشكال رقم التليفون للبحث: الدولي (+2015...) والمحلي (0155...) —
 *  عشان البحث برقم 0155 يلاقي العميل حتى لو رقمه متخزن بصيغة +20. */
function phoneSearchForms(phone: string): string[] {
  const digits = norm(phone).replace(/^\+/, '')
  const forms = [norm(phone), digits]
  if (digits.startsWith('20') && digits.length > 2) forms.push('0' + digits.slice(2))
  return forms
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

type GateStep = 'phone' | 'otp' | 'profile' | 'main'

export default function App() {
  const [notice, setNotice] = useState<string | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [gate, setGate] = useState<GateStep>('phone')
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
    setGate('phone')
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

  /** بعد تأكيد OTP: الدور بيتحدد من الرقم نفسه — رقم الأدمن → أدمن،
   *  رقم مسجّل كعامل غسيل (الأدمن ضافه) → عامل غسيل، غير كده → عميل.
   *  بعدها نشوف هل الملف الشخصي موجود ولا لأ. */
  async function afterVerify(e164: string) {
    const phoneDisplay = phoneInput.trim()
    if (e164 === ADMIN_PHONE) {
      const s: Session = { role: 'admin', phone: e164, phoneDisplay, name: 'صلاح', verified: true }
      saveSession(s)
      setSession(s)
      setGate('main')
      return
    }
    const w = await loadWasher(e164)
    if (w) {
      if (w.name) {
        const s: Session = { role: 'washer', phone: e164, phoneDisplay, name: w.name, verified: true }
        saveSession(s)
        setSession(s)
        setGate('main')
      } else {
        const base: Session = { role: 'washer', phone: e164, phoneDisplay, name: '', verified: true }
        setPendingSession(base)
        setProfName('')
        setGate('profile')
      }
      return
    }
    const c = await loadCustomer(e164)
    if (c && c.name) {
      const s: Session = { role: 'customer', phone: e164, phoneDisplay, name: c.name, verified: true }
      saveSession(s)
      setSession(s)
      setGate('main')
    } else {
      const base: Session = { role: 'customer', phone: e164, phoneDisplay, name: '', verified: true }
      setPendingSession(base)
      setProfName('')
      setProfCompound('')
      setProfCompoundManual('')
      setProfBuilding('')
      setProfApartment('')
      setProfPhoto(null)
      setGate('profile')
    }
  }

  /** الأدمن (صلاح) يقدر يعرض التطبيق كعميل بنفس رقمه — ويرجع للأدمن من الملف الشخصي. */
  async function switchToCustomer() {
    if (!session || session.phone !== ADMIN_PHONE) return
    const c = await loadCustomer(session.phone)
    if (c && c.name) {
      const s: Session = { ...session, role: 'customer', name: c.name }
      saveSession(s)
      setSession(s)
      setGate('main')
    } else {
      const base: Session = { ...session, role: 'customer', name: '' }
      setPendingSession(base)
      setProfName('')
      setProfCompound('')
      setProfCompoundManual('')
      setProfBuilding('')
      setProfApartment('')
      setProfPhoto(null)
      setGate('profile')
    }
  }

  function switchToAdmin() {
    if (!session || session.phone !== ADMIN_PHONE) return
    const s: Session = { ...session, role: 'admin', name: 'صلاح' }
    saveSession(s)
    setSession(s)
    setGate('main')
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
        setNotice(getLastFirestoreError() ?? 'مقدرناش نحفظ البيانات — تأكد إن النت شغال وحاول تاني.')
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
      setNotice(getLastFirestoreError() ?? 'مقدرناش نحفظ البيانات — تأكد إن النت شغال وحاول تاني.')
      return
    }
    const done: Session = { ...s, name: profName.trim() }
    saveSession(done)
    setSession(done)
    setPendingSession(null)
    setGate('main')
  }

  // رقم الأدمن معفي من حد الـ 3 أكواد في الساعة — سطر "فاضل X من 3" مبيظهرلوش
  const isAdminPhone = toE164Phone(phoneInput) === ADMIN_PHONE

  return (
    <div className="app">
      <header className="header">
        <img className="logo-wide" src={logoTransparent} alt="Top Service" />
        <h1>
          <span className="brand">Top Service</span>
        </h1>
        <div className="contact-row" dir="ltr">
          <a className="contact-number" href={`tel:${COMPANY_PHONE_E164}`}>
            {COMPANY_PHONE}
          </a>
          <a
            className="btn small whatsapp"
            href={COMPANY_WHATSAPP_URL}
            target="_blank"
            rel="noreferrer"
          >
            💬 واتساب
          </a>
          <a className="btn small" href={`tel:${COMPANY_PHONE_E164}`}>
            📞 اتصال
          </a>
        </div>
        <p className="tagline">غسيل عربيات متنقلة في الكومباوندات</p>
        <span className="badge">الإصدار 15 — المرحلة 1</span>
      </header>

      {!isFirebaseConfigured && gate !== 'main' && (
        <div className="warn" style={{ marginTop: 14 }}>
          ⚠️ Firebase مش مربوط بعد — أنشئ مشروع <b>top-service</b> والصق الـ config في{' '}
          <b>src/firebaseConfig.ts</b> عشان التطبيق يشتغل بالبيانات الحقيقية.
        </div>
      )}

      {gate === 'phone' && (
        <div className="card">
          <h2>أهلاً بيك في Top Service</h2>
          <p className="muted">اكتب رقم موبايلك وهنبعتلك كود تحقق من 6 أرقام في رسالة SMS.</p>
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
          {otpSent && !isAdminPhone && (
            <p className="muted">فاضل {otpLeft} من 3 طلبات كود في الساعة للرقم ده.</p>
          )}
          <div id="recaptcha-container" />
        </div>
      )}

      {gate === 'otp' && (
        <div className="card">
          <h2>اكتب الكود اللي وصلك</h2>
          <p className="muted">
            بعتنا كود من 6 أرقام على {phoneInput.trim()} — اكتبه هنا.
            {!isAdminPhone && otpLeft > 0 ? ` (فاضل ${otpLeft} من 3 طلبات في الساعة)` : ''}
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
          <h2>{pendingSession.role === 'washer' ? 'استكمال بيانات عامل الغسيل' : 'استكمال بياناتك'}</h2>
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
        <CustomerView
          session={session}
          compounds={compounds}
          onNotice={setNotice}
          onLogout={logout}
          onSwitchToAdmin={switchToAdmin}
        />
      )}
      {gate === 'main' && session && session.role === 'washer' && (
        <WasherView session={session} onNotice={setNotice} onLogout={logout} />
      )}
      {gate === 'main' && session && session.role === 'admin' && (
        <AdminView
          session={session}
          compounds={compounds}
          onCompounds={setCompounds}
          onNotice={setNotice}
          onLogout={logout}
          onSwitchToCustomer={switchToCustomer}
        />
      )}

      <footer className="footer">
        <p>Top Service — غسيل عربيات متنقلة • الإصدار 15</p>
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
  onSwitchToAdmin,
}: {
  session: Session
  compounds: Compound[]
  onNotice: (m: string) => void
  onLogout: () => void
  onSwitchToAdmin: () => void
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
  // معالج الاشتراك الموجَّه (v15): كومباوند ← نموذج ← عدد الغسلات
  const [wizStep, setWizStep] = useState<1 | 2 | 3>(1)
  const [wizCompoundId, setWizCompoundId] = useState<string | null>(null)
  const [wizPhaseId, setWizPhaseId] = useState<string | null>(null)
  const [wizBuilding, setWizBuilding] = useState('')
  const [wizApartment, setWizApartment] = useState('')
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

  // تنبيهات الدفع على الموبايل (إشعارات محلية — للعميل بس): كل ما المدفوعات
  // تتغير، المستحق بيتجدول واللي اتدفع بتتلغي تذكيراته. صامت — من غير أي واجهة.
  useEffect(() => {
    void reconcilePaymentReminders(payments)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payments])

  function activeSubFor(carId: string): Subscription | undefined {
    return subs.find((s) => s.carId === carId && isSubscriptionActive(s))
  }
  /** دفعة مستحقة (تحصيل مؤخر) أو محصّلة لاشتراك معيّن. */
  function duePaymentFor(subId: string): Payment | undefined {
    return payments.find((p) => p.subscriptionId === subId && p.status === 'due')
  }
  function paidPaymentFor(subId: string): Payment | undefined {
    return payments.find((p) => p.subscriptionId === subId && p.status === 'approved')
  }
  /** سطر "المستحق" — حسب حالة التحصيل (نافذة / سماح / متأخر) + ملاحظة الشهر الأول. */
  function dueLine(pay: Payment, sub: Subscription) {
    const status: CollectionStatus = paymentCollectionStatus(pay.createdAt)
    const startDay = new Date(sub.startDate).getDate()
    const windowText =
      status === 'grace'
        ? 'فترة السماح — لحد يوم 5'
        : status === 'overdue'
          ? 'متأخر — عدى فترة السماح'
          : 'التحصيل من يوم 25 لآخر الشهر + 5 أيام سماح (لحد يوم 5 الشهر الجاي)'
    return (
      <div
        className="muted"
        style={{
          marginTop: 6,
          ...(status === 'overdue' ? { color: '#991b1b', fontWeight: 700 } : {}),
        }}
      >
        المستحق: {pay.amount} جنيه — {windowText}
        {startDay > 1 ? ` (حساب الشهر الأول من يوم ${startDay})` : ''}
      </div>
    )
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

  /** فتح معالج الاشتراك لعربية: الخطوة 1، والكومباوند والعمارة والشقة
   *  متعبّية من ملف العميل لو موجودة. */
  function openWizard(carId: string) {
    setSubCarId(carId)
    setSubPkg(4)
    setSubMethod('cash')
    setWizStep(1)
    setWizCompoundId(customer?.compoundId ?? null)
    setWizPhaseId(null)
    setWizBuilding(customer?.building ?? '')
    setWizApartment(customer?.apartment ?? '')
  }

  /** إغلاق المعالج وتصفير حالته. */
  function closeWizard() {
    setSubCarId(null)
    setWizStep(1)
    setWizCompoundId(null)
    setWizPhaseId(null)
    setWizBuilding('')
    setWizApartment('')
  }

  async function subscribeCar() {
    if (!subCarId) return
    const car = cars.find((c) => c.id === subCarId)
    if (!car) return
    const pkg = packageById(subPkg)
    const active = activeSubFor(car.id)
    if (active) {
      onNotice(`العربية دي عندها اشتراك نشط حتى ${fmtDate(active.endDate)} — جدّد بعد ما ينتهي.`)
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
    // خطوات المعالج قبل الاشتراك نفسه: حدّث الكومباوند والعمارة والشقة
    // في ملف العميل، واربط العربية بالنموذج اللي اختاره.
    const wizCompound = compounds.find((c) => c.id === wizCompoundId)
    if (!wizCompound || !wizPhaseId) {
      setBusy(false)
      onNotice('كمّل خطوات الاشتراك الأول — اختار الكومباوند والنموذج.')
      return
    }
    const newBuilding = wizBuilding.trim()
    const newApartment = wizApartment.trim()
    if (!newBuilding || !newApartment) {
      setBusy(false)
      onNotice('اكتب رقم العمارة والشقة.')
      return
    }
    if (
      !customer ||
      wizCompoundId !== customer.compoundId ||
      newBuilding !== customer.building ||
      newApartment !== customer.apartment
    ) {
      const okProfile = await saveDoc('customers', session.phone, {
        compoundId: wizCompound.id,
        compoundName: wizCompound.name,
        building: newBuilding,
        apartment: newApartment,
      })
      if (!okProfile) {
        setBusy(false)
        onNotice(getLastFirestoreError() ?? 'مقدرناش نحفظ بياناتك — حاول تاني.')
        return
      }
    }
    const okPhase = await saveDoc('cars', car.id, { phaseId: wizPhaseId })
    if (!okPhase) {
      setBusy(false)
      onNotice(getLastFirestoreError() ?? 'مقدرناش نحفظ النموذج — حاول تاني.')
      return
    }
    const now = Date.now()
    const startDay = new Date(now).getDate()
    // الشهر الأول بيتحسب من يوم الاشتراك (مثال: باقة 200 يوم 15 → 100)،
    // وسعر الباقة نفسه في الاشتراك مبيتغيرش — اللي بيتغيّر مبلغ الدفعة بس.
    const dueAmount = proratedFirstMonthAmount(pkg.price, now)
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
      status: 'active',
      startDate: now,
      endDate: monthEndTimestamp(now),
      createdAt: now,
      approvedAt: now,
    })
    const okPay = okSub
      ? await saveDoc('payments', payId, {
          id: payId,
          subscriptionId: subId,
          customerPhone: session.phone,
          customerName: session.name,
          carPlate: car.plate,
          amount: dueAmount,
          method: subMethod,
          status: 'due',
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
    closeWizard()
    await loadAll()
    onNotice(
      `تم تفعيل اشتراك باقة ${pkg.washes} غسلات (${pkg.price} جنيه) للعربية ${car.plate} ✅ — الغسيل هيتم في أيام مرحلة عربيتك. المستحق ${dueAmount} جنيه${startDay > 1 ? ` (حساب الشهر الأول من يوم ${startDay})` : ''}، والتحصيل من يوم 25 لآخر الشهر + 5 أيام سماح.`,
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
    onNotice('تم إلغاء طلب الغسلة.')
  }

  /** كومباوند العميل — لعرض مراحله وأيام غسيل كل عربية. */
  const myCompound = compounds.find((c) => c.id === customer?.compoundId)

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
          <CalendarIcon /> سجل الغسيل
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
          {/* تذكير بالدفع — بيظهر من يوم 25 بس، للدفعات اللي لسه متدفعتش */}
          {payments
            .filter((p) => p.status === 'due')
            .map((p) => ({ p, status: paymentCollectionStatus(p.createdAt) }))
            .filter((x) => x.status !== 'not-yet')
            .map(({ p, status }) => (
              <div key={p.id} className={`remind${status === 'overdue' ? ' overdue' : ''}`}>
                {status === 'open' && `⚠️ لسه عليك ${p.amount} جنيه — ادفع الآن.`}
                {status === 'grace' && `⚠️ لسه عليك ${p.amount} جنيه — ادفع الآن.`}
                {status === 'overdue' && `⚠️ المبلغ ${p.amount} جنيه متأخر — ادفع الآن.`}
              </div>
            ))}
          {cars.map((car) => {
            const active = activeSubFor(car.id)
            const duePay = active ? duePaymentFor(active.id) : undefined
            const paidPay = active ? paidPaymentFor(active.id) : undefined
            const phase = phaseOf(compounds, customer?.compoundId ?? '', car.phaseId)
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
                  {!active && <span className="order-badge gray">بدون اشتراك</span>}
                </div>
                {active && (
                  <div style={{ marginTop: 12 }}>
                    <div className="big-line">
                      باقة {active.washesTotal} غسلات — {active.price} جنيه / شهر
                    </div>
                    <div className="muted">نشط حتى آخر الشهر {fmtDate(active.endDate)}</div>
                    <div className="muted" style={{ marginTop: 6 }}>
                      📅 أيام الغسيل:{' '}
                      {phase ? (
                        <b>
                          {phaseDaysLabel(phase.days)}
                          {phase.name ? ` (${phase.name})` : ''}
                        </b>
                      ) : (
                        'لسه متحددتش أيام الغسيل للعربية دي.'
                      )}
                    </div>
                    {duePay && dueLine(duePay, active)}
                    {paidPay && (
                      <div className="muted" style={{ marginTop: 6 }}>
                        تم التحصيل ✅ — إيصال رقم {paidPay.receiptNo}
                      </div>
                    )}
                    {active && phase && (
                      <WashCalendar
                        car={car}
                        phase={phase}
                        washesTotal={active.washesTotal}
                        washes={history.filter(
                          (w) => w.carId === car.id && w.status === 'done',
                        )}
                      />
                    )}
                  </div>
                )}
                {!active && (
                  <p className="muted" style={{ marginTop: 10 }}>
                    {expired
                      ? 'الاشتراك السابق انتهى آخر الشهر — جدّد عشان تكمل.'
                      : 'العربية دي لسه ملهاش اشتراك — اختار باقة من تبويب "باقاتي".'}
                  </p>
                )}
                {!active && (
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
              الغسيل بيتم في أيام المراحل الثابتة اللي حددتها الشركة لكومباوندك — عربيتك
              بتتغسل في يوم المرحلة بتاعتها تلقائياً.
            </p>
            {myCompound && myCompound.phases.length > 0 ? (
              myCompound.phases.map((p) => (
                <div key={p.id} className="muted">
                  مرحلة {p.name}: {phaseDaysLabel(p.days)}
                </div>
              ))
            ) : (
              <p className="muted">
                {customer ? 'لسه متضافتش مراحل للكومباوند ده.' : ''}
              </p>
            )}
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
                  <span className="order-badge green">اشتراك نشط</span>
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
            كل عربية لها اشتراك شهري منفصل. الاشتراك بينتهي آخر الشهر، والتجديد من هنا —
            مفيش غسلة مفردة.
          </p>
          {cars.length === 0 && <p className="muted">ضيف عربية الأول من تبويب "عربياتي".</p>}
          {cars.map((car) => {
            const active = activeSubFor(car.id)
            const duePay = active ? duePaymentFor(active.id) : undefined
            const paidPay = active ? paidPaymentFor(active.id) : undefined
            const past = subs.filter((s) => s.carId === car.id).slice(0, 3)
            const wizCompound = compounds.find((c) => c.id === wizCompoundId)
            const wizPhases = wizCompound?.phases ?? []
            const wizPhase = wizPhases.find((p) => p.id === wizPhaseId)
            return (
              <div className="ride" key={car.id}>
                <b>
                  {car.type} — {car.plate}
                </b>
                {active && (
                  <p className="muted">
                    اشتراك نشط: باقة {active.washesTotal} غسلات — {active.price} جنيه / شهر —
                    نشط حتى {fmtDate(active.endDate)}
                  </p>
                )}
                {active && duePay && dueLine(duePay, active)}
                {active && paidPay && (
                  <p className="muted">تم التحصيل ✅ — إيصال رقم {paidPay.receiptNo}</p>
                )}
                {!active && past.length > 0 && (
                  <p className="muted">آخر اشتراك: باقة {past[0].washesTotal} — {past[0].status === 'active' ? 'انتهى' : past[0].status === 'rejected' ? 'اترفض الدفع' : past[0].status}.</p>
                )}
                <button
                  className="btn small"
                  onClick={() => {
                    if (subCarId === car.id) closeWizard()
                    else openWizard(car.id)
                  }}
                  disabled={!!active}
                >
                  {subCarId === car.id ? 'إلغاء الاختيار' : 'اشترك / جدّد'}
                </button>
                {subCarId === car.id && (
                  <div style={{ marginTop: 12 }}>
                    <p className="muted">خطوة {wizStep} من 3</p>
                    {wizStep === 1 && (
                      <>
                        <label>اختار الكومباوند</label>
                        {compounds.length === 0 && (
                          <p className="muted">
                            لسه مفيش كومباوندات — كلم الشركة على {COMPANY_PHONE}.
                          </p>
                        )}
                        {compounds.map((c) => (
                          <div
                            key={c.id}
                            className={`pkg${wizCompoundId === c.id ? ' selected' : ''}`}
                            onClick={() => {
                              setWizCompoundId(c.id)
                              setWizPhaseId(null)
                            }}
                          >
                            <div className="row" style={{ justifyContent: 'space-between' }}>
                              <span className="pkg-washes">{c.name}</span>
                              {wizCompoundId === c.id && <span>✅</span>}
                            </div>
                          </div>
                        ))}
                        <label>رقم العمارة</label>
                        <input
                          type="text"
                          value={wizBuilding}
                          onChange={(e) => setWizBuilding(e.target.value)}
                          placeholder="مثال: A10"
                        />
                        <label>رقم الشقة</label>
                        <input
                          type="text"
                          value={wizApartment}
                          onChange={(e) => setWizApartment(e.target.value)}
                          placeholder="مثال: 5"
                        />
                        <button
                          className="btn big"
                          onClick={() => {
                            if (!wizBuilding.trim() || !wizApartment.trim()) {
                              onNotice('اكتب رقم العمارة والشقة.')
                              return
                            }
                            setWizStep(2)
                          }}
                          disabled={!wizCompoundId}
                        >
                          التالي
                        </button>
                      </>
                    )}
                    {wizStep === 2 && (
                      <>
                        <label>اختار النموذج</label>
                        {wizPhases.length === 0 ? (
                          <p className="muted">
                            لسه مفيش نماذج للكومباوند ده — كلم الشركة على {COMPANY_PHONE}.
                          </p>
                        ) : (
                          wizPhases.map((p) => (
                            <div
                              key={p.id}
                              className={`pkg${wizPhaseId === p.id ? ' selected' : ''}`}
                              onClick={() => setWizPhaseId(p.id)}
                            >
                              <div className="row" style={{ justifyContent: 'space-between' }}>
                                <span className="pkg-washes">النموذج: {p.name}</span>
                                {wizPhaseId === p.id && <span>✅</span>}
                              </div>
                              <div className="muted">{phaseDaysLabel(p.days)}</div>
                            </div>
                          ))
                        )}
                        <div className="row">
                          <button className="btn small" onClick={() => setWizStep(1)}>
                            رجوع
                          </button>
                          <button
                            className="btn big"
                            onClick={() => setWizStep(3)}
                            disabled={!wizPhaseId || wizPhases.length === 0}
                          >
                            التالي
                          </button>
                        </div>
                      </>
                    )}
                    {wizStep === 3 && (
                      <>
                        <p className="muted">
                          الكومباوند: <b>{wizCompound?.name}</b> — النموذج:{' '}
                          <b>
                            {wizPhase?.name} ({phaseDaysLabel(wizPhase?.days ?? [])})
                          </b>
                        </p>
                        <label>اختار عدد الغسلات</label>
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
                        <label>طريقة الدفع (التحصيل من يوم 25)</label>
                        <select
                          value={subMethod}
                          onChange={(e) => setSubMethod(e.target.value as PaymentMethod)}
                        >
                          <option value="cash">نقدي (تحصيل عند الباب)</option>
                          <option value="visa">فيزا</option>
                          <option value="wallet">محفظة إلكترونية</option>
                        </select>
                        <div className="row">
                          <button className="btn small" onClick={() => setWizStep(2)}>
                            رجوع
                          </button>
                          <button
                            className="btn big"
                            onClick={() => void subscribeCar()}
                            disabled={busy}
                          >
                            {busy ? 'بيسجّل…' : 'تأكيد الاشتراك'}
                          </button>
                        </div>
                      </>
                    )}
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
                {p.status === 'due' && (
                  <span className="order-badge">مستحق — التحصيل من يوم 25</span>
                )}
                {p.status === 'approved' && <span className="order-badge green">تم التحصيل ✅</span>}
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
          <h2>سجل الغسيل</h2>
          {history.length === 0 && <p className="muted">لسه مفيش غسلات مسجلة.</p>}
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
                {w.status === 'done' && w.doneAt
                  ? `اتغسلت ${fmtDateTime(w.doneAt)}`
                  : `طلبت ${fmtDateTime(w.requestedAt)}`}
              </div>
              {w.photoUrl && (
                <a href={w.photoUrl} target="_blank" rel="noreferrer">
                  <img
                    className="avatar"
                    src={w.photoUrl}
                    alt="صورة الغسلة"
                    style={{ width: 72, height: 72 }}
                  />
                </a>
              )}
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
          {session.phone === ADMIN_PHONE && (
            <button className="btn big" onClick={onSwitchToAdmin}>
              <ShieldIcon /> رجوع للوحة الأدمن
            </button>
          )}
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
//  واجهة عامل الغسيل — عربيات اليوم + البحث الفوري + "تم الغسيل"
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
  const [customers, setCustomers] = useState<Customer[]>([])
  const [allCars, setAllCars] = useState<Car[]>([])
  const [subs, setSubs] = useState<Subscription[]>([])
  const [doneToday, setDoneToday] = useState<WashRequest[]>([])
  const [doneList, setDoneList] = useState<WashRequest[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [compounds, setCompounds] = useState<Compound[]>([])
  // صور الغسلات المختارة (لكل عربية) — بتتبعت مع "تم الغسيل"، واختيارية
  const [washPhotos, setWashPhotos] = useState<Record<string, string | null>>({})

  /** غسلات النهاردة المنجزة (من السجل العام — نقرأها ونصفّي محلياً). */
  async function loadDoneToday(): Promise<WashRequest[]> {
    const rows = await loadCollection('washRequests')
    const start = todayStart()
    return rows
      .map((r) => normalizeWash(r.id, r))
      .filter((w) => w.status === 'done' && (w.doneAt ?? 0) >= start)
      .sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0))
  }

  const loadAll = async () => {
    const [w, cs, cars, ss, done, hist, comps] = await Promise.all([
      loadWasher(session.phone),
      loadAllCustomers(),
      loadAllCars(),
      loadAllSubscriptions(),
      loadDoneToday(),
      loadWasherDoneWashes(session.phone),
      loadCompounds(),
    ])
    setWasher(w)
    setCustomers(cs)
    setAllCars(cars)
    setSubs(ss)
    setDoneToday(done)
    setDoneList(hist)
    setCompounds(comps)
    setLoading(false)
  }

  useEffect(() => {
    void loadAll()
    const un1 = subscribeCollection('washRequests', (rows) => {
      const all = rows.map((r) => normalizeWash(r.id, r))
      setDoneToday(
        all
          .filter((w) => w.status === 'done' && (w.doneAt ?? 0) >= todayStart())
          .sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0)),
      )
      setDoneList(
        all
          .filter((w) => w.status === 'done' && w.doneByPhone === session.phone)
          .sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0)),
      )
    })
    const un2 = subscribeCollection('cars', (rows) => {
      setAllCars(rows.map((r) => normalizeCar(r.id, r)))
    })
    const un3 = subscribeCollection('subscriptions', (rows) => {
      setSubs(rows.map((r) => normalizeSubscription(r.id, r)))
    })
    return () => {
      un1()
      un2()
      un3()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.phone])

  /** عربيات النهاردة من جدول المراحل: مرحلتها تشمل النهاردة، واشتراك
   *  شهري نشط، ولسه متغسلتش النهاردة — كومباونداته المربوطة بس
   *  (لو مفيش ربط — كل الكومباوندات). */
  const entries = useMemo(
    () => todayCars(allCars, customers, subs, compounds, doneToday, washer?.compoundIds),
    [allCars, customers, subs, compounds, doneToday, washer],
  )

  /** عربيات باشتراك نشط لسه متحددلهاش مرحلة — عشان الأدمن يحددها. */
  const unassignedCount = useMemo(() => {
    let n = 0
    for (const car of allCars) {
      const customer = customers.find((c) => c.phone === car.customerPhone)
      if (!customer) continue
      if (
        washer &&
        washer.compoundIds.length > 0 &&
        !washer.compoundIds.includes(customer.compoundId)
      ) {
        continue
      }
      if (!subs.some((s) => s.carId === car.id && isSubscriptionActive(s))) continue
      const compound = compounds.find((c) => c.id === customer.compoundId)
      const phase = car.phaseId ? compound?.phases?.find((p) => p.id === car.phaseId) : undefined
      if (!phase) n++
    }
    return n
  }, [allCars, customers, subs, compounds, washer])

  /** البحث الفوري: لوحة (حروف/أرقام) أو نوع العربية أو اسم العميل أو رقمه. */
  const filtered = useMemo(() => {
    const q = norm(search)
    if (!q) return entries
    return entries.filter((e) => {
      const hay = [
        norm(e.car.plate),
        norm(e.car.type),
        norm(e.customer.name),
        norm(e.customer.phone),
        norm(e.compound.name),
        norm(e.customer.building),
      ].join(' ')
      return hay.includes(q)
    })
  }, [entries, search])

  /** تجميع بالكومباوند ثم العمارة — عشان يغسل كل عربيات العمارة في جولة واحدة. */
  const grouped = useMemo(() => {
    const groups = new Map<string, Map<string, TodayCar[]>>()
    for (const e of filtered) {
      const compKey = e.compound.name || 'بدون كومباوند'
      let byBuilding = groups.get(compKey)
      if (!byBuilding) {
        byBuilding = new Map<string, TodayCar[]>()
        groups.set(compKey, byBuilding)
      }
      const bKey = `عمارة ${e.customer.building || '—'}`
      const list = byBuilding.get(bKey) ?? []
      list.push(e)
      byBuilding.set(bKey, list)
    }
    return [...groups.entries()].map(([comp, byBuilding]) => ({
      comp,
      buildings: [...byBuilding.entries()].map(([b, list]) => ({ b, list })),
    }))
  }, [filtered])

  async function markDone(e: TodayCar) {
    if (busyId) return
    setBusyId(e.car.id)
    const r = await recordWashDone(
      e,
      session.name || 'عامل الغسيل',
      session.phone,
      washPhotos[e.car.id] ?? null,
    )
    setBusyId(null)
    if (!r.ok) {
      onNotice(r.message)
      return
    }
    setWashPhotos((prev) => {
      const next = { ...prev }
      delete next[e.car.id]
      return next
    })
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
                  : 'لسه متربطتش بكومباوندات — شايف كل عربيات النهاردة لحد ما الأدمن يربطك.'}
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
              <CarIcon /> {filtered.length} عربية النهاردة — {WEEKDAY_NAMES[todayWeekday()]}
            </span>
          </div>
          {unassignedCount > 0 && (
            <p className="muted">
              في {unassignedCount} عربية باشتراك نشط لسه متحددلهاش مرحلة — الأدمن يحددها من
              لوحة التحكم.
            </p>
          )}
          {filtered.length === 0 && (
            <div className="card">
              <p className="muted">
                {search ? 'مفيش عربية مطابقة للبحث ده.' : 'مفيش عربيات في جدول النهاردة.'}
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
                  {bg.list.map((e) => (
                    <div className="ride" key={e.car.id}>
                      <div className="row" style={{ justifyContent: 'space-between' }}>
                        <b>
                          {e.car.type} — {e.car.plate}
                        </b>
                        <span className="order-badge">{e.car.color || 'بدون لون'}</span>
                      </div>
                      <div className="muted">
                        العميل: {e.customer.name} — {e.customer.phone}
                      </div>
                      <div className="muted">
                        شقة {e.customer.apartment} — مرحلة {e.phase.name}:{' '}
                        {phaseDaysLabel(e.phase.days)}
                      </div>
                      <div className="muted" style={{ marginTop: 8 }}>
                        📷 صورة الغسلة (اختياري) — إثبات للعميل
                      </div>
                      <PhotoField
                        photo={washPhotos[e.car.id] ?? null}
                        onPhoto={(p) =>
                          setWashPhotos((prev) => ({ ...prev, [e.car.id]: p }))
                        }
                        notice={onNotice}
                      />
                      <button
                        className="btn big active"
                        onClick={() => void markDone(e)}
                        disabled={busyId === e.car.id}
                      >
                        <CheckIcon /> {busyId === e.car.id ? 'بيحفظ…' : 'تم الغسيل'}
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
              {w.photoUrl && (
                <a href={w.photoUrl} target="_blank" rel="noreferrer">
                  <img
                    className="avatar"
                    src={w.photoUrl}
                    alt="صورة الغسلة"
                    style={{ width: 72, height: 72 }}
                  />
                </a>
              )}
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
//  محرر مراحل كومباوند — إضافة/حذف مرحلة (اسم + أيام أسبوع)
// ---------------------------------------------------------------------------

/** ترتيب اختيار الأيام: الأسبوع بيبدأ من السبت عندنا. */
const WEEK_PICK_ORDER = [6, 0, 1, 2, 3, 4, 5]

function PhaseEditor({
  phases,
  onChange,
}: {
  phases: Phase[]
  onChange: (p: Phase[]) => void
}) {
  const [name, setName] = useState('')
  const [days, setDays] = useState<number[]>([])

  function toggleDay(d: number) {
    setDays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b),
    )
  }

  function addPhase() {
    if (days.length === 0) return
    const label = phaseDaysLabel(days)
    const phase: Phase = {
      id: `ph_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name: name.trim() || label,
      days: [...days].sort((a, b) => a - b),
    }
    onChange([...phases, phase])
    setName('')
    setDays([])
  }

  return (
    <div style={{ marginTop: 8 }}>
      <label>المراحل (مجموعات أيام الغسيل)</label>
      {phases.length === 0 && <p className="muted">لسه مفيش مراحل — ضيف أول مرحلة تحت.</p>}
      {phases.map((p) => (
        <div key={p.id} className="row" style={{ justifyContent: 'space-between' }}>
          <span>
            <b>{p.name}</b> <span className="muted">— {phaseDaysLabel(p.days)}</span>
          </span>
          <button
            type="button"
            className="btn small danger"
            onClick={() => onChange(phases.filter((x) => x.id !== p.id))}
          >
            حذف
          </button>
        </div>
      ))}
      <label>اسم المرحلة الجديدة (اختياري — لو فاضي هيبقى اسمها الأيام)</label>
      <input
        type="text"
        placeholder="مثال: مرحلة أولى"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <label>أيام المرحلة</label>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        {WEEK_PICK_ORDER.map((d) => (
          <label
            key={d}
            style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 600 }}
          >
            <input type="checkbox" checked={days.includes(d)} onChange={() => toggleDay(d)} />
            {WEEKDAY_NAMES[d]}
          </label>
        ))}
      </div>
      <button type="button" className="btn small" onClick={addPhase} disabled={days.length === 0}>
        <PlusIcon /> إضافة المرحلة
      </button>
    </div>
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
  onSwitchToCustomer,
}: {
  session: Session
  compounds: Compound[]
  onCompounds: (c: Compound[]) => void
  onNotice: (m: string) => void
  onLogout: () => void
  onSwitchToCustomer: () => void
}) {
  const [tab, setTab] = useState<'dash' | 'customers' | 'payments' | 'today' | 'manage'>('dash')
  const [customers, setCustomers] = useState<Customer[]>([])
  const [allCars, setAllCars] = useState<Car[]>([])
  const [subs, setSubs] = useState<Subscription[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [washers, setWashers] = useState<Washer[]>([])
  const [doneToday, setDoneToday] = useState<WashRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [payBusy, setPayBusy] = useState<string | null>(null)
  // صور الغسلات المختارة (لكل عربية) — بتتبعت مع "تم الغسيل"، واختيارية
  const [adminPhotos, setAdminPhotos] = useState<Record<string, string | null>>({})
  // إدارة: إضافة كومباوند
  const [newCompoundName, setNewCompoundName] = useState('')
  const [newCompoundPhases, setNewCompoundPhases] = useState<Phase[]>([])
  // إدارة: إضافة عامل الغسيل
  const [newWasherName, setNewWasherName] = useState('')
  const [newWasherPhone, setNewWasherPhone] = useState('')
  const [newWasherCompounds, setNewWasherCompounds] = useState<string[]>([])
  // تعديل: كومباوند
  const [editingCompoundId, setEditingCompoundId] = useState<string | null>(null)
  const [editCompoundName, setEditCompoundName] = useState('')
  const [editCompoundPhases, setEditCompoundPhases] = useState<Phase[]>([])
  // تعديل: عامل غسيل
  const [editingWasherPhone, setEditingWasherPhone] = useState<string | null>(null)
  const [editWasherName, setEditWasherName] = useState('')
  const [editWasherPhone, setEditWasherPhone] = useState('')
  const [editWasherCompounds, setEditWasherCompounds] = useState<string[]>([])
  const [editWasherActive, setEditWasherActive] = useState(true)
  // تعديل: عميل (رقم الموبايل مبيتغيرش — مربوط بالعربيات والاشتراكات)
  const [editingCustomerPhone, setEditingCustomerPhone] = useState<string | null>(null)
  const [editCustomerName, setEditCustomerName] = useState('')
  const [editCustomerCompound, setEditCustomerCompound] = useState('')
  const [editCustomerBuilding, setEditCustomerBuilding] = useState('')
  const [editCustomerApartment, setEditCustomerApartment] = useState('')
  // تأكيد حذف — ضغطتين: الأولى تجهّز، التانية تنفّذ
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const loadAll = async () => {
    const [cs, cars, ss, ps, ws] = await Promise.all([
      loadAllCustomers(),
      loadAllCars(),
      loadAllSubscriptions(),
      loadAllPayments(),
      loadAllWashers(),
    ])
    setCustomers(cs)
    setAllCars(cars)
    setSubs(ss)
    setPayments(ps)
    setWashers(ws)
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
    return {
      subscribers: customers.length,
      activeSubs: activeSubs.length,
      revenue,
      todayWashes: doneToday.length,
    }
  }, [customers, subs, payments, doneToday])

  const filteredCustomers = useMemo(() => {
    const q = norm(search)
    if (!q) return customers
    return customers.filter((c) => {
      const carsOf = allCars.filter((car) => car.customerPhone === c.phone)
      const hay = [
        norm(c.name),
        ...phoneSearchForms(c.phone),
        norm(c.code),
        norm(c.compoundName),
        norm(c.building ?? ''),
        norm(c.apartment ?? ''),
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

  /** تأكيد تحصيل دفعة مستحقة — يلمس الدفعة بس، الاشتراك مبيتلمسش. */
  async function collectPayment(p: Payment) {
    if (payBusy) return
    setPayBusy(p.id)
    const r = await confirmCollection(p.id)
    setPayBusy(null)
    if (!r.ok) {
      onNotice(r.message)
      return
    }
    await loadAll()
    onNotice(r.message)
  }

  /** عربيات النهاردة من جدول المراحل — كل الكومباوندات. */
  const todayEntries = useMemo(
    () => todayCars(allCars, customers, subs, compounds, doneToday),
    [allCars, customers, subs, compounds, doneToday],
  )

  async function markDone(e: TodayCar) {
    if (busyId) return
    setBusyId(e.car.id)
    const r = await recordWashDone(
      e,
      'الأدمن (صلاح)',
      session.phone,
      adminPhotos[e.car.id] ?? null,
    )
    setBusyId(null)
    if (!r.ok) {
      onNotice(r.message)
      return
    }
    setAdminPhotos((prev) => {
      const next = { ...prev }
      delete next[e.car.id]
      return next
    })
    await loadAll()
    onNotice(r.message)
  }

  async function changeCarPhase(car: Car, phaseId: string) {
    if (busyId) return
    setBusyId(`phase:${car.id}`)
    const ok = await saveDoc('cars', car.id, { phaseId: phaseId || null })
    setBusyId(null)
    if (!ok) {
      onNotice(getLastFirestoreError() ?? 'مقدرناش نحفظ المرحلة — حاول تاني.')
      return
    }
    await loadAll()
    onNotice(
      phaseId ? `تم تحديد مرحلة العربية ${car.plate} ✅` : `تم إلغاء مرحلة العربية ${car.plate}.`,
    )
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
      phases: newCompoundPhases,
      createdAt: Date.now(),
    })
    setBusyId(null)
    if (!ok) {
      onNotice('مقدرناش نحفظ الكومباوند — حاول تاني.')
      return
    }
    setNewCompoundName('')
    setNewCompoundPhases([])
    const list = await loadCompounds()
    onCompounds(list)
    onNotice(`تمت إضافة كومباوند ${newCompoundName.trim()} ✅`)
  }

  async function addWasher(e: FormEvent) {
    e.preventDefault()
    if (newWasherName.trim().length < 2) {
      onNotice('اكتب اسم عامل الغسيل.')
      return
    }
    const e164 = toE164Phone(newWasherPhone)
    if (!e164) {
      onNotice('رقم موبايل عامل الغسيل غير صحيح — اكتب رقم مصري 11 رقم يبدأ بـ 01.')
      return
    }
    if (!isFirebaseConfigured) {
      onNotice('Firebase غير مربوط — مينفعش نحفظ عامل الغسيل.')
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
      onNotice(getLastFirestoreError() ?? 'مقدرناش نحفظ عامل الغسيل — حاول تاني.')
      return
    }
    setNewWasherName('')
    setNewWasherPhone('')
    setNewWasherCompounds([])
    await loadAll()
    onNotice(`تمت إضافة عامل الغسيل ${newWasherName.trim()} ✅ — هيدخل برقمه والـ OTP.`)
  }

  function toggleWasherCompound(id: string) {
    setNewWasherCompounds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  // ---- تعديل / حذف كومباوند ----
  function startEditCompound(c: Compound) {
    setEditingCompoundId(c.id)
    setEditCompoundName(c.name)
    setEditCompoundPhases([...(c.phases ?? [])])
    setConfirmDeleteId(null)
  }

  async function saveEditCompound(e: FormEvent) {
    e.preventDefault()
    if (!editingCompoundId) return
    if (!editCompoundName.trim()) {
      onNotice('اكتب اسم الكومباوند.')
      return
    }
    const oldCompound = compounds.find((c) => c.id === editingCompoundId)
    const removedPhaseIds = (oldCompound?.phases ?? [])
      .map((p) => p.id)
      .filter((id) => !editCompoundPhases.some((p) => p.id === id))
    setBusyId(`edit-compound:${editingCompoundId}`)
    const ok = await saveDoc('compounds', editingCompoundId, {
      name: editCompoundName.trim(),
      phases: editCompoundPhases,
    })
    setBusyId(null)
    if (!ok) {
      onNotice(getLastFirestoreError() ?? 'مقدرناش نحفظ التعديل — حاول تاني.')
      return
    }
    // المراحل اللي اتحذفت: نشيلها من أي عربية كانت مربوطة بيها
    if (removedPhaseIds.length > 0) {
      const cars = await loadAllCars()
      await Promise.all(
        cars
          .filter((car) => car.phaseId && removedPhaseIds.includes(car.phaseId))
          .map((car) => saveDoc('cars', car.id, { phaseId: null })),
      )
      await loadAll()
    }
    setEditingCompoundId(null)
    const list = await loadCompounds()
    onCompounds(list)
    onNotice(`تم تعديل كومباوند ${editCompoundName.trim()} ✅`)
  }

  async function deleteCompound(c: Compound) {
    const key = `compound:${c.id}`
    if (confirmDeleteId !== key) {
      setConfirmDeleteId(key)
      return
    }
    setConfirmDeleteId(null)
    setBusyId(key)
    // نشيل الكومباوند من قوائم عمال الغسيل المربوطين بيه
    const linked = washers.filter((w) => w.compoundIds.includes(c.id))
    await Promise.all(
      linked.map((w) =>
        saveDoc('washers', w.phone, {
          compoundIds: w.compoundIds.filter((id) => id !== c.id),
        }),
      ),
    )
    const ok = await deleteDocById('compounds', c.id)
    setBusyId(null)
    if (!ok) {
      onNotice(getLastFirestoreError() ?? 'مقدرناش نحذف الكومباوند — حاول تاني.')
      return
    }
    const list = await loadCompounds()
    onCompounds(list)
    await loadAll()
    onNotice(`تم حذف كومباوند ${c.name}.`)
  }

  // ---- تعديل / حذف / إيقاف عامل غسيل ----
  function startEditWasher(w: Washer) {
    setEditingWasherPhone(w.phone)
    setEditWasherName(w.name)
    setEditWasherPhone(w.phone)
    setEditWasherCompounds([...w.compoundIds])
    setEditWasherActive(w.active)
    setConfirmDeleteId(null)
  }

  function toggleEditWasherCompound(id: string) {
    setEditWasherCompounds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  async function saveEditWasher(e: FormEvent) {
    e.preventDefault()
    if (!editingWasherPhone) return
    if (editWasherName.trim().length < 2) {
      onNotice('اكتب اسم عامل الغسيل.')
      return
    }
    const e164 = toE164Phone(editWasherPhone)
    if (!e164) {
      onNotice('رقم موبايل عامل الغسيل غير صحيح — اكتب رقم مصري 11 رقم يبدأ بـ 01.')
      return
    }
    setBusyId(`edit-washer:${editingWasherPhone}`)
    const ok = await saveDoc('washers', e164, {
      phone: e164,
      name: editWasherName.trim(),
      compoundIds: editWasherCompounds,
      active: editWasherActive,
    })
    if (!ok) {
      setBusyId(null)
      onNotice(getLastFirestoreError() ?? 'مقدرناش نحفظ التعديل — حاول تاني.')
      return
    }
    if (e164 !== editingWasherPhone) {
      // الرقم اتغيّر: المستند القديم بيتمسح والجديد هو اللي بيفضل
      await deleteDocById('washers', editingWasherPhone)
    }
    setBusyId(null)
    setEditingWasherPhone(null)
    await loadAll()
    onNotice(`تم تعديل بيانات عامل الغسيل ${editWasherName.trim()} ✅`)
  }

  async function deleteWasher(w: Washer) {
    const key = `washer:${w.phone}`
    if (confirmDeleteId !== key) {
      setConfirmDeleteId(key)
      return
    }
    setConfirmDeleteId(null)
    setBusyId(key)
    const ok = await deleteDocById('washers', w.phone)
    setBusyId(null)
    if (!ok) {
      onNotice(getLastFirestoreError() ?? 'مقدرناش نحذف عامل الغسيل — حاول تاني.')
      return
    }
    await loadAll()
    onNotice(`تم حذف عامل الغسيل ${w.name}.`)
  }

  async function toggleWasherActive(w: Washer) {
    setBusyId(`toggle-washer:${w.phone}`)
    const ok = await saveDoc('washers', w.phone, { active: !w.active })
    setBusyId(null)
    if (!ok) {
      onNotice(getLastFirestoreError() ?? 'مقدرناش نغيّر حالة عامل الغسيل — حاول تاني.')
      return
    }
    await loadAll()
    onNotice(
      w.active
        ? `تم إيقاف ${w.name} مؤقتاً — مش هيشوف طلبات جديدة.`
        : `تم تفعيل ${w.name} تاني ✅`,
    )
  }

  // ---- تعديل عميل ----
  function startEditCustomer(c: Customer) {
    setEditingCustomerPhone(c.phone)
    setEditCustomerName(c.name)
    setEditCustomerCompound(c.compoundName)
    setEditCustomerBuilding(c.building)
    setEditCustomerApartment(c.apartment)
    setConfirmDeleteId(null)
  }

  async function saveEditCustomer(e: FormEvent) {
    e.preventDefault()
    if (!editingCustomerPhone) return
    if (editCustomerName.trim().length < 2) {
      onNotice('اكتب اسم العميل.')
      return
    }
    if (!editCustomerCompound.trim()) {
      onNotice('اختار الكومباوند.')
      return
    }
    setBusyId(`edit-customer:${editingCustomerPhone}`)
    const compoundId =
      compounds.find((x) => x.name === editCustomerCompound.trim())?.id ?? 'manual'
    const ok = await saveDoc('customers', editingCustomerPhone, {
      name: editCustomerName.trim(),
      compoundName: editCustomerCompound.trim(),
      compoundId,
      building: editCustomerBuilding.trim(),
      apartment: editCustomerApartment.trim(),
    })
    setBusyId(null)
    if (!ok) {
      onNotice(getLastFirestoreError() ?? 'مقدرناش نحفظ التعديل — حاول تاني.')
      return
    }
    setEditingCustomerPhone(null)
    onNotice(`تم تعديل بيانات ${editCustomerName.trim()} ✅`)
  }

  if (loading) {
    return (
      <div className="card">
        <p className="muted">بيحمّل لوحة التحكم…</p>
      </div>
    )
  }

  const duePayments = payments.filter((p) => p.status === 'due')
  const pendingPayments = payments.filter((p) => p.status === 'pending')
  const receipts = payments.filter((p) => p.status === 'approved' || p.status === 'rejected')
  const totalDue = duePayments.reduce((sum, p) => sum + p.amount, 0)
  // الدفعات المستحقة اللي نافذة التحصيل مفتوحة ليها (من يوم 25 / سماح / متأخر)
  const activeDue = duePayments
    .map((p) => ({ p, status: paymentCollectionStatus(p.createdAt) }))
    .filter((x) => x.status !== 'not-yet')
  const activeDueCount = activeDue.length
  const activeDueTotal = activeDue.reduce((sum, x) => sum + x.p.amount, 0)
  const graceDueCount = activeDue.filter((x) => x.status === 'grace').length

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
          <ReceiptIcon /> التحصيل
          {activeDueCount > 0 && <span className="tab-badge">{activeDueCount}</span>}
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
              <div className="v">{duePayments.length}</div>
              <div className="k">مستحقات للتحصيل</div>
            </div>
          </div>
          {duePayments.length > 0 && (
            <button className="btn big" onClick={() => setTab('payments')}>
              <ReceiptIcon /> في {duePayments.length} مستحق للتحصيل بإجمالي {totalDue} جنيه —
              راجعهم
            </button>
          )}
          <button className="btn big" onClick={onSwitchToCustomer}>
            <CarIcon /> عرض التطبيق كعميل
          </button>
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
              placeholder="ابحث بالاسم أو التليفون أو اللوحة أو رقم العمارة أو الكومباوند…"
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
                      📞 {c.phone} — {c.code}
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
                  const latestSub = subsOf.find((s) => s.carId === car.id)
                  const duePay = latestSub
                    ? payments.find(
                        (p) => p.subscriptionId === latestSub.id && p.status === 'due',
                      )
                    : undefined
                  const carCompound = compounds.find((x) => x.id === c.compoundId)
                  const carPhases = carCompound?.phases ?? []
                  return (
                    <div key={car.id} className="muted" style={{ marginTop: 6 }}>
                      🚗 {car.type} — {car.plate} —{' '}
                      {active ? (
                        <b style={{ color: '#15803d' }}>
                          نشط حتى {fmtDate(active.endDate)}
                        </b>
                      ) : duePay ? (
                        <b style={{ color: '#8a3d24' }}>
                          مستحق: {duePay.amount} جنيه — التحصيل من يوم 25 لآخر الشهر + 5 أيام سماح
                          {latestSub && new Date(latestSub.startDate).getDate() > 1
                            ? ` (حساب الشهر الأول من يوم ${new Date(latestSub.startDate).getDate()})`
                            : ''}
                        </b>
                      ) : (
                        <span>بدون اشتراك نشط</span>
                      )}
                      <div style={{ marginTop: 6 }}>
                        {carPhases.length === 0 ? (
                          <span>ضيف مراحل للكومباوند من تبويب الإدارة الأول.</span>
                        ) : (
                          <label style={{ display: 'block' }}>
                            المرحلة:{' '}
                            <select
                              value={car.phaseId ?? ''}
                              onChange={(e) => void changeCarPhase(car, e.target.value)}
                              disabled={busyId === `phase:${car.id}`}
                            >
                              <option value="">بدون مرحلة</option>
                              {carPhases.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name} — {phaseDaysLabel(p.days)}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                      </div>
                    </div>
                  )
                })}
                {editingCustomerPhone === c.phone ? (
                  <form onSubmit={(e) => void saveEditCustomer(e)} style={{ marginTop: 10 }}>
                    <label>اسم العميل</label>
                    <input
                      type="text"
                      value={editCustomerName}
                      onChange={(e) => setEditCustomerName(e.target.value)}
                    />
                    <label>الكومباوند</label>
                    <select
                      value={editCustomerCompound}
                      onChange={(e) => setEditCustomerCompound(e.target.value)}
                    >
                      {compounds.map((x) => (
                        <option key={x.id} value={x.name}>
                          {x.name}
                        </option>
                      ))}
                      {!compounds.some((x) => x.name === editCustomerCompound) && (
                        <option value={editCustomerCompound}>{editCustomerCompound}</option>
                      )}
                    </select>
                    <label>عمارة</label>
                    <input
                      type="text"
                      value={editCustomerBuilding}
                      onChange={(e) => setEditCustomerBuilding(e.target.value)}
                    />
                    <label>شقة</label>
                    <input
                      type="text"
                      value={editCustomerApartment}
                      onChange={(e) => setEditCustomerApartment(e.target.value)}
                    />
                    <div className="row">
                      <button
                        className="btn small active"
                        type="submit"
                        disabled={busyId === `edit-customer:${c.phone}`}
                      >
                        {busyId === `edit-customer:${c.phone}` ? 'بيحفظ…' : 'حفظ التعديل'}
                      </button>
                      <button
                        className="btn small"
                        type="button"
                        onClick={() => setEditingCustomerPhone(null)}
                      >
                        إلغاء
                      </button>
                    </div>
                    <p className="muted">رقم الموبايل مبيتغيرش من هنا (مربوط بالعربيات والاشتراكات).</p>
                  </form>
                ) : (
                  <button className="btn small" onClick={() => startEditCustomer(c)}>
                    ✏️ تعديل البيانات
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {tab === 'payments' && (
        <div className="card">
          <h2>التحصيل ({duePayments.length})</h2>
          <p className="muted">
            التحصيل يبدأ من يوم 25 من الشهر لآخر الشهر + 5 أيام سماح (لحد يوم 5 الشهر الجاي)
            {isCollectionOpen()
              ? ' — نافذة التحصيل مفتوحة دلوقتي ✅'
              : graceDueCount > 0
                ? ' — فترة السماح مفتوحة دلوقتي ✅'
                : ''}{' '}
            — إجمالي المستحق: {totalDue} جنيه.
          </p>
          {activeDueCount > 0 && (
            <p className="muted">
              لسه ما دفعوش: {activeDueCount} عميل — إجمالي {activeDueTotal} جنيه
            </p>
          )}
          {duePayments.length === 0 && <p className="muted">مفيش مستحقات للتحصيل دلوقتي.</p>}
          {duePayments.map((p) => {
            const st = paymentCollectionStatus(p.createdAt)
            return (
              <div className="ride" key={p.id}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <b>
                    {p.customerName} — {p.amount} جنيه
                  </b>
                  <span className={`order-badge${st === 'overdue' ? ' red' : ''}`}>
                    {st === 'grace' ? 'في فترة السماح' : st === 'overdue' ? 'متأخر' : 'مستحق — التحصيل من يوم 25'}
                  </span>
                </div>
                <div className="muted">
                  {p.carPlate} — {p.method === 'cash' ? 'نقدي' : p.method === 'visa' ? 'فيزا' : 'محفظة'} —{' '}
                  {fmtDateTime(p.createdAt)}
                </div>
                <div className="row">
                  <button
                    className="btn small active"
                    onClick={() => void collectPayment(p)}
                    disabled={payBusy === p.id}
                  >
                    <CheckIcon /> {payBusy === p.id ? 'بيحفظ…' : 'تأكيد التحصيل'}
                  </button>
                </div>
              </div>
            )
          })}
          {pendingPayments.length > 0 && (
            <>
              <h3>مدفوعات قديمة بانتظار التأكيد ({pendingPayments.length})</h3>
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
            </>
          )}
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
          <h2>غسلات اليوم — {WEEKDAY_NAMES[todayWeekday()]}</h2>
          <p className="muted">
            عربيات النهاردة: {todayEntries.length} — تمت النهاردة: {doneToday.length}
          </p>
          {todayEntries.length === 0 && (
            <p className="muted">مفيش عربيات في جدول النهاردة.</p>
          )}
          {todayEntries.map((e) => (
            <div className="ride" key={e.car.id}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <b>
                  {e.car.type} — {e.car.plate}
                </b>
                <span className="order-badge">{e.compound.name}</span>
              </div>
              <div className="muted">
                {e.customer.name} — {e.customer.phone} — عمارة {e.customer.building} — شقة{' '}
                {e.customer.apartment}
              </div>
              <div className="muted">
                مرحلة {e.phase.name}: {phaseDaysLabel(e.phase.days)}
              </div>
              <div className="muted" style={{ marginTop: 8 }}>
                📷 صورة الغسلة (اختياري) — إثبات للعميل
              </div>
              <PhotoField
                photo={adminPhotos[e.car.id] ?? null}
                onPhoto={(p) => setAdminPhotos((prev) => ({ ...prev, [e.car.id]: p }))}
                notice={onNotice}
              />
              <button
                className="btn big active"
                onClick={() => void markDone(e)}
                disabled={busyId === e.car.id}
              >
                <CheckIcon /> {busyId === e.car.id ? 'بيحفظ…' : 'تم الغسيل'}
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
                  {w.photoUrl && (
                    <a href={w.photoUrl} target="_blank" rel="noreferrer">
                      <img
                        className="avatar"
                        src={w.photoUrl}
                        alt="صورة الغسلة"
                        style={{ width: 72, height: 72 }}
                      />
                    </a>
                  )}
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
                {(c.phases ?? []).length === 0 ? (
                  <div className="muted">لسه مفيش مراحل — ضيف من التعديل.</div>
                ) : (
                  (c.phases ?? []).map((p) => (
                    <div key={p.id} className="muted">
                      مرحلة {p.name}: {phaseDaysLabel(p.days)}
                    </div>
                  ))
                )}
                {editingCompoundId === c.id ? (
                  <form onSubmit={(e) => void saveEditCompound(e)} style={{ marginTop: 10 }}>
                    <label>اسم الكومباوند</label>
                    <input
                      type="text"
                      value={editCompoundName}
                      onChange={(e) => setEditCompoundName(e.target.value)}
                    />
                    <PhaseEditor phases={editCompoundPhases} onChange={setEditCompoundPhases} />
                    <div className="row">
                      <button
                        className="btn small active"
                        type="submit"
                        disabled={busyId === `edit-compound:${c.id}`}
                      >
                        {busyId === `edit-compound:${c.id}` ? 'بيحفظ…' : 'حفظ التعديل'}
                      </button>
                      <button
                        className="btn small"
                        type="button"
                        onClick={() => setEditingCompoundId(null)}
                      >
                        إلغاء
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="row">
                    <button className="btn small" onClick={() => startEditCompound(c)}>
                      ✏️ تعديل
                    </button>
                    <button
                      className="btn small danger"
                      onClick={() => void deleteCompound(c)}
                      disabled={busyId === `compound:${c.id}`}
                    >
                      {confirmDeleteId === `compound:${c.id}` ? 'تأكيد الحذف؟' : '🗑️ حذف'}
                    </button>
                  </div>
                )}
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
              <PhaseEditor phases={newCompoundPhases} onChange={setNewCompoundPhases} />
              <button className="btn big" type="submit" disabled={busyId === 'compound'}>
                <PlusIcon /> إضافة الكومباوند
              </button>
            </form>
          </div>
          <div className="card">
            <h2>عمال الغسيل ({washers.length})</h2>
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
                {!w.active && (
                  <div className="muted" style={{ color: '#b91c1c' }}>
                    ⏸️ موقوف مؤقتاً
                  </div>
                )}
                {editingWasherPhone === w.phone ? (
                  <form onSubmit={(e) => void saveEditWasher(e)} style={{ marginTop: 10 }}>
                    <label>اسم عامل الغسيل</label>
                    <input
                      type="text"
                      value={editWasherName}
                      onChange={(e) => setEditWasherName(e.target.value)}
                    />
                    <label>رقم موبايل عامل الغسيل</label>
                    <input
                      type="tel"
                      value={editWasherPhone}
                      onChange={(e) => setEditWasherPhone(e.target.value)}
                      dir="ltr"
                      style={{ textAlign: 'center' }}
                    />
                    <label>الكومباوندات اللي هيشتغل فيها</label>
                    {compounds.map((c) => (
                      <label
                        key={c.id}
                        style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 600 }}
                      >
                        <input
                          type="checkbox"
                          checked={editWasherCompounds.includes(c.id)}
                          onChange={() => toggleEditWasherCompound(c.id)}
                        />
                        {c.name}
                      </label>
                    ))}
                    <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 600 }}>
                      <input
                        type="checkbox"
                        checked={editWasherActive}
                        onChange={(e) => setEditWasherActive(e.target.checked)}
                      />
                      فعّال (يشوف طلبات جديدة)
                    </label>
                    <div className="row">
                      <button
                        className="btn small active"
                        type="submit"
                        disabled={busyId === `edit-washer:${w.phone}`}
                      >
                        {busyId === `edit-washer:${w.phone}` ? 'بيحفظ…' : 'حفظ التعديل'}
                      </button>
                      <button
                        className="btn small"
                        type="button"
                        onClick={() => setEditingWasherPhone(null)}
                      >
                        إلغاء
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="row">
                    <button className="btn small" onClick={() => startEditWasher(w)}>
                      ✏️ تعديل
                    </button>
                    <button
                      className="btn small"
                      onClick={() => void toggleWasherActive(w)}
                      disabled={busyId === `toggle-washer:${w.phone}`}
                    >
                      {w.active ? '⏸️ إيقاف' : '▶️ تفعيل'}
                    </button>
                    <button
                      className="btn small danger"
                      onClick={() => void deleteWasher(w)}
                      disabled={busyId === `washer:${w.phone}`}
                    >
                      {confirmDeleteId === `washer:${w.phone}` ? 'تأكيد الحذف؟' : '🗑️ حذف'}
                    </button>
                  </div>
                )}
              </div>
            ))}
            <form onSubmit={(e) => void addWasher(e)}>
              <h3>إضافة عامل الغسيل</h3>
              <label>اسم عامل الغسيل</label>
              <input
                type="text"
                placeholder="مثال: محمد أحمد"
                value={newWasherName}
                onChange={(e) => setNewWasherName(e.target.value)}
              />
              <label>رقم موبايل عامل الغسيل</label>
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
                <PlusIcon /> إضافة عامل الغسيل
              </button>
            </form>
          </div>
        </>
      )}
    </>
  )
}
