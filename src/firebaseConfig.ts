// ============================================================================
//  إعدادات Firebase — Top Service
//  المشروع: top-service (projectId: top-service-d367b) — مشروع جديد منفصل
//  تماماً، لا علاقة له بمشروع ind-toktok ولا بمشروع "تاجر جمله".
//  القيم من الـ web config الذي أرسله صلاح 2026-11-12 (متحقق منها).
//  لا تنسخ هذه القيم في أي رد أو ذاكرة — مكانها الوحيد هذا الملف.
// ============================================================================

export interface FirebaseWebConfig {
  apiKey: string
  authDomain: string
  projectId: string
  storageBucket: string
  messagingSenderId: string
  appId: string
  measurementId?: string
}

export const firebaseConfig: FirebaseWebConfig = {
  apiKey: 'AIzaSyAL_2X6-xk_QaiaOcyjDJV6lf08vvxJ81Y',
  authDomain: 'top-service-d367b.firebaseapp.com',
  projectId: 'top-service-d367b',
  storageBucket: 'top-service-d367b.firebasestorage.app',
  messagingSenderId: '276599205345',
  appId: '1:276599205345:web:a72f8c1d40a9a1f64e36a0',
  measurementId: 'G-Z1F59EHK7L',
}

/** true فقط عندما تُلصق قيم config حقيقية لمشروع top-service. */
export const isFirebaseConfigured =
  firebaseConfig.apiKey !== 'PLACEHOLDER_API_KEY' &&
  firebaseConfig.projectId !== 'PLACEHOLDER_PROJECT_ID'
