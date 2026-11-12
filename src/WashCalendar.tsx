// ---------------------------------------------------------------------------
//  تقويم غسيل الشهر (v11) — للعميل: أيام الغسيل بس ✅ وأيام لسه جاية 📅
//  شبكة مدمجة فيها أيام الغسيل في الشهر الحالي بس (أيام غسيل العربية حسب
//  باقتها — washDaysFor v18 — بالترتيب) — مش شبكة شهر كامل.
//  بلا أي اسم عامل غسيل أو إشارة للأدمن.
// ---------------------------------------------------------------------------
import { useMemo, useState } from 'react'
import type { Car, Phase, WashRequest } from './types'
import { WEEKDAY_NAMES } from './types'
import { washDaysFor } from './schedule'

/** اسم اليوم المختصر: "الأحد" → "أحد" — للعرض في خلايا التقويم. */
function shortWeekday(d: number): string {
  return (WEEKDAY_NAMES[d] ?? '').replace(/^ال/, '')
}

function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function WashCalendar({
  car,
  phase,
  washes,
  washesTotal,
  chosenDays,
}: {
  car: Car
  phase: Phase
  washes: WashRequest[]
  /** عدد غسلات الباقة (12 أو 8 أو 4) — بيحدد كام يوم في الأسبوع */
  washesTotal: number
  /** أيام الغسيل اللي اختارها العميل (باقة أقل من كل أيام المرحلة — v18) */
  chosenDays?: number[] | null
}) {
  const [selectedDay, setSelectedDay] = useState<number | null>(null)

  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth()
  const todayDate = now.getDate()
  const monthName = now.toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' })
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const todayStart = startOfDay(now.getTime())

  // الغسلات المنجزة في الشهر الحالي للعربية دي — مفتاحها رقم اليوم
  const washedByDay = useMemo(() => {
    const map = new Map<number, WashRequest>()
    for (const w of washes) {
      if (w.status !== 'done' || !w.doneAt) continue
      const d = new Date(w.doneAt)
      if (d.getFullYear() === year && d.getMonth() === month) {
        map.set(d.getDate(), w)
      }
    }
    return map
  }, [washes, year, month])

  // أيام الغسيل في الشهر الحالي = أيام غسيل العربية حسب باقتها
  // (12 = كل أيام المرحلة، 8 = يومين يختارهم العميل، 4 = يوم يختاره العميل)
  const washDays = useMemo(() => {
    const weekDays = washDaysFor(phase.days, washesTotal, chosenDays)
    const days: number[] = []
    for (let day = 1; day <= daysInMonth; day++) {
      if (weekDays.includes(new Date(year, month, day).getDay())) days.push(day)
    }
    return days
  }, [phase, year, month, daysInMonth, washesTotal, chosenDays])

  // الغسلات المنجزة ضمن أيام الغسيل المعروضة بس
  const washedCount = washDays.filter((day) => washedByDay.has(day)).length

  // أيام الغسيل اللي لسه جاية لآخر الشهر (من النهاردة، من غير اللي اتغسلت)
  const upcomingCount = washDays.filter((day) => day >= todayDate && !washedByDay.has(day)).length

  const selectedWash = selectedDay !== null ? washedByDay.get(selectedDay) : undefined

  // تاريخ النهاردة منسق مع اسم اليوم — مثال: "الخميس، 12 نوفمبر 2026"
  const todayLabel = now.toLocaleDateString('ar-EG', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  return (
    <div className="cal">
      <h4>📅 تقويم غسيل الشهر — {monthName}</h4>
      <p className="muted">اليوم: {todayLabel}</p>
      <div className="cal-grid">
        {washDays.map((day) => {
          const date = new Date(year, month, day)
          const isToday = startOfDay(date.getTime()) === todayStart
          const washed = washedByDay.get(day)
          const isUpcoming = !washed && day >= todayDate
          const cls = [
            'cal-day',
            washed ? 'washed' : '',
            isUpcoming ? 'upcoming' : '',
            isToday ? 'today' : '',
            selectedDay === day ? 'selected' : '',
          ]
            .filter(Boolean)
            .join(' ')
          return (
            <button
              key={day}
              type="button"
              className={cls}
              disabled={!washed}
              onClick={() => setSelectedDay(day)}
            >
              <span className="cal-dow">{shortWeekday(date.getDay())}</span>
              <span className="cal-num">{day}</span>
              {washed && <span className="cal-mark">✅</span>}
            </button>
          )
        })}
      </div>
      <p className="muted">
        اتغسلت {washedCount} مرات الشهر ده — وفاضل {upcomingCount} يوم غسيل لآخر الشهر.
      </p>
      {selectedWash && (
        <div className="cal-photo">
          <p className="muted">
            غسلة {car.plate} — يوم {selectedDay} {monthName}
          </p>
          {selectedWash.photoUrl ? (
            <a href={selectedWash.photoUrl} target="_blank" rel="noreferrer">
              <img className="shot" src={selectedWash.photoUrl} alt="صورة الغسلة" />
            </a>
          ) : (
            <p className="muted">مفيش صورة لليوم ده.</p>
          )}
        </div>
      )}
    </div>
  )
}
