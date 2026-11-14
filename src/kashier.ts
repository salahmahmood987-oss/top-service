// ---------------------------------------------------------------------------
// عميل Cloudflare Worker للدفع الأونلاين عن طريق Kashier (Top Service).
// الـ Worker (~/workspace/top-service-kashier-worker/worker.js) هو اللي
// بينشئ جلسة الدفع عند Kashier وبيتحقق من نتيجتها — مفاتيح Kashier
// (MID + Payment API Key + Secret Key) عنده هو بس في الـ secrets،
// والتطبيق مبيعرفهاش أبداً:
//   POST {WORKER_URL}/create-session { paymentId, amount, phone }
//        -> { ok, sessionUrl, sessionId }
//   POST {WORKER_URL}/verify-session { sessionId }
//        -> { ok, status, paid }
// رابط الـ Worker علني (مش سر) وبيتضبط وقت البناء بـ
// VITE_KASHIER_WORKER_URL. لو المتغير مش مضبوط، isKashierConfigured()
// ترجع false وزرار الدفع الأونلاين مبيظهرش.
// وضع اختبار بس (v20): مفيش فلوس حقيقية بتتحرك.
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

export async function createKashierSession(
  paymentId: string,
  amount: number,
  phone: string,
): Promise<KashierSessionResponse> {
  const data = await postJson('/create-session', { paymentId, amount, phone })
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
