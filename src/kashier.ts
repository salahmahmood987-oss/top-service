// ---------------------------------------------------------------------------
// عميل Cloudflare Worker للدفع الأونلاين عن طريق Kashier (Top Service).
// الـ Worker (~/workspace/top-service-kashier-worker/worker.js) هو اللي
// بينشئ جلسة الدفع عند Kashier وبيتحقق من نتيجتها — مفاتيح Kashier
// (MID + Payment API Key + Secret Key) عنده هو بس في الـ secrets،
// والتطبيق مبيعرفهاش أبداً:
//   POST {WORKER_URL}/create-session { paymentId, amount, phone, method? }
//        -> { ok, sessionUrl, sessionId }
//   method (v21): 'card' | 'wallet' — الطريقة اللي اختارها العميل من زراريه
//   في التطبيق؛ الـ Worker بيبعتها لـ Kashier كـ defaultMethod فصفحة الدفع
//   تفتح عليها على طول (والطريقتين بيفضلوا متاحين في الصفحة).
// وضع اختبار بس (v20+): مفيش فلوس حقيقية بتتحرك.
//   POST {WORKER_URL}/verify-session { sessionId }
//        -> { ok, status, paid }
//   POST {WORKER_URL}/get-token { phone }
//        -> { ok, token, agreementId, maskedCard, ... } | { ok: false, error: 'no_token' }
//        يجيب الكارت المحفوظ عند Kashier بعد أول دفعة فيزا (v23).
//   POST {WORKER_URL}/delete-token { phone }
//        -> { ok, deleted } — إلغاء السحب التلقائي: حذف التوكن عند Kashier
//        وعندنا (v23).
// رابط الـ Worker علني (مش سر) وبيتضبط وقت البناء بـ
// VITE_KASHIER_WORKER_URL. لو المتغير مش مضبوط، isKashierConfigured()
// ترجع false وزرار الدفع الأونلاين مبيظهرش.
// وضع اختبار بس (v20+): مفيش فلوس حقيقية بتتحرك.
// ---------------------------------------------------------------------------

const WORKER_URL = (
  import.meta.env.VITE_KASHIER_WORKER_URL as string | undefined
)
  ?.trim()
  .replace(/\/$/, '') || ''

/** هل رابط وسيط الدفع مضبوط في البناء؟ */
export function isKashierConfigured(): boolean {
  return WORKER_URL.length > 0
}

export interface KashierSessionResponse {
  ok: boolean
  sessionUrl?: string
  sessionId?: string
  order?: string
  error?: string
  message?: string
}

export interface KashierVerifyResponse {
  ok: boolean
  status?: string
  paid?: boolean
  amount?: string | null
  method?: string | null
  error?: string
  message?: string
}

const WORKER_UNREACHABLE =
  'مشكلة في الاتصال بسيرفر الدفع — تأكد إن النت شغال وحاول تاني.'

async function postJson(
  path: string,
  body: unknown,
): Promise<Record<string, unknown> | null> {
  let res: Response
  try {
    res = await fetch(`${WORKER_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    return null
  }
  try {
    return (await res.json()) as Record<string, unknown>
  } catch {
    return null
  }
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

function asBoolean(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined
}

/** طريقة الدفع اللي اختارها العميل من زراريه (v21): فيزا أو محفظة إلكترونية. */
export type KashierPayMethod = 'card' | 'wallet'

export async function createKashierSession(
  paymentId: string,
  amount: number,
  phone: string,
  method?: KashierPayMethod,
  saveCard?: boolean,
): Promise<KashierSessionResponse> {
  const data = await postJson('/create-session', { paymentId, amount, phone, method, saveCard: saveCard === true })
  if (!data) return { ok: false, error: 'network', message: WORKER_UNREACHABLE }
  return {
    ok: data.ok === true,
    sessionUrl: asString(data.sessionUrl),
    sessionId: asString(data.sessionId),
    order: asString(data.order),
    error: asString(data.error),
    message: asString(data.message),
  }
}

export async function verifyKashierSession(
  sessionId: string,
): Promise<KashierVerifyResponse> {
  const data = await postJson('/verify-session', { sessionId })
  if (!data) return { ok: false, error: 'network', message: WORKER_UNREACHABLE }
  return {
    ok: data.ok === true,
    status: asString(data.status),
    paid: asBoolean(data.paid),
    amount:
      typeof data.amount === 'string' || data.amount === null
        ? (data.amount as string | null)
        : undefined,
    method:
      typeof data.method === 'string' || data.method === null
        ? (data.method as string | null)
        : undefined,
    error: asString(data.error),
    message: asString(data.message),
  }
}

export interface SavedTokenResponse {
  ok: boolean
  token?: string
  agreementId?: string | null
  maskedCard?: string | null
  cardHolderName?: string | null
  agreementType?: string | null
  error?: string
  message?: string
}

/** يجيب الكارت المحفوظ عند Kashier لرقم العميل (بعد أول دفعة فيزا).
 *  بيرجع no_token لو لسه مفيش كارت محفوظ. (v23 — السحب التلقائي) */
export async function getSavedToken(phone: string): Promise<SavedTokenResponse> {
  const data = await postJson('/get-token', { phone })
  if (!data) return { ok: false, error: 'network', message: WORKER_UNREACHABLE }
  return {
    ok: data.ok === true,
    token: asString(data.token),
    agreementId:
      typeof data.agreementId === 'string' || data.agreementId === null
        ? (data.agreementId as string | null)
        : undefined,
    maskedCard:
      typeof data.maskedCard === 'string' || data.maskedCard === null
        ? (data.maskedCard as string | null)
        : undefined,
    cardHolderName:
      typeof data.cardHolderName === 'string' || data.cardHolderName === null
        ? (data.cardHolderName as string | null)
        : undefined,
    agreementType:
      typeof data.agreementType === 'string' || data.agreementType === null
        ? (data.agreementType as string | null)
        : undefined,
    error: asString(data.error),
    message: asString(data.message),
  }
}

/** إلغاء السحب التلقائي: حذف التوكن عند Kashier وعندنا. (v23) */
export async function deleteSavedToken(
  phone: string,
): Promise<{ ok: boolean; deleted?: boolean; error?: string; message?: string }> {
  const data = await postJson('/delete-token', { phone })
  if (!data) return { ok: false, error: 'network', message: WORKER_UNREACHABLE }
  return {
    ok: data.ok === true,
    deleted: asBoolean(data.deleted),
    error: asString(data.error),
    message: asString(data.message),
  }
}
