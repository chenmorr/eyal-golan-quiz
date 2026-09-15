// עדכון אוטומטי של האפליקציה.
//
// PWA ששמור במסך הבית ממשיך להגיש את הגרסה שנשמרה, גם אחרי שהעלינו
// חדשה. ברירת המחדל של workbox היא להוריד ברקע ולחכות לפעם הבאה
// שהאפליקציה תיסגר לגמרי — ובטלפון זה יכול לקחת ימים.
//
// כאן מחילים את העדכון מיד: ברגע שיש גרסה חדשה מרעננים את הדף.
// בטוח לעשות את זה כי אין מצב משחק ששמור מקומית וילך לאיבוד.

import { registerSW } from 'virtual:pwa-register'

export function setupAutoUpdate(): void {
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      // לא שואלים את המשתמש: עדכון שקוף עדיף על באנר שהוא יתעלם ממנו
      updateSW(true)
    },
    onRegisteredSW(_url, registration) {
      if (!registration) return
      // בודקים עדכון בכל חזרה לאפליקציה, לא רק בטעינה הראשונה
      const check = () => {
        if (document.visibilityState === 'visible') registration.update().catch(() => {})
      }
      document.addEventListener('visibilitychange', check)
      window.addEventListener('online', check)
      setInterval(check, 60 * 60 * 1000)
    },
  })
}
