// ---------------------------------------------------------------------------
//  جلسة الدخول المحلية — رقم الموبايل الموثّق يُحفظ مرة واحدة ويُعاد
//  استخدامه (لا يُطلب من العميل مرة أخرى عند كل دخول).
// ---------------------------------------------------------------------------
import type { Role } from './types'

export interface Session {
  role: Role
  /** صيغة E.164: ‎+20xxxxxxxxxx */
  phone: string
  /** الرقم كما كتبه المستخدم، مثال: 0155... */
  phoneDisplay: string
  name: string
  verified: boolean
}

const KEY = 'topservice_session_v1'

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as Partial<Session>
    if (!s.phone || !s.role || s.verified !== true) return null
    return {
      role: s.role,
      phone: s.phone,
      phoneDisplay: s.phoneDisplay ?? s.phone,
      name: s.name ?? '',
      verified: true,
    }
  } catch {
    return null
  }
}

export function saveSession(s: Session): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    // التخزين محظور — الجلسة تضيع عند إغلاق التطبيق فقط
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // تجاهل
  }
}
