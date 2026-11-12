import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.topservice.app',
  appName: 'Top Service',
  webDir: 'dist',
  backgroundColor: '#fdf6f0',
  android: {
    allowMixedContent: true,
  },
  server: {
    // لا يوجد خادم خارجي — التطبيق يعمل محلياً + Firebase عند ربطه
    cleartext: true,
  },
  plugins: {
    // لازم نسجّل مزود الهاتف هنا، وإلا إضافة Firebase الأصلية ترفض
    // signInWithPhoneNumber بخطأ "Phone sign-in provider is not enabled"
    FirebaseAuthentication: {
      providers: ['phone'],
    },
  },
}

export default config
