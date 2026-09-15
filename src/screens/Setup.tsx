import { useMemo, useState } from 'react'
import { availableKinds } from '../../shared/questions.ts'
import type { Difficulty, QuestionKind } from '../../shared/types.ts'
import type { RoomConfig } from '../../shared/protocol.ts'
import { DIFFICULTY_LABELS, ERAS, KIND_LABELS, SONGS } from '../data.ts'

interface Props {
  initial: RoomConfig
  /** false כשאין רשת — סוגי שאלות שדורשים אודיו לא מוצגים */
  allowAudio?: boolean
  title: string
  submitLabel: string
  /** מוצג מעל הכפתור — למשל הודעה שרק המארח קובע */
  note?: string
  onSubmit: (config: RoomConfig) => void
  onBack: () => void
}

const COUNTS = [5, 10, 15, 20]
const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard']

export function Setup({ initial, title, submitLabel, note, allowAudio = true, onSubmit, onBack }: Props) {
  const [questionCount, setQuestionCount] = useState(initial.questionCount)
  const [eras, setEras] = useState<string[]>(initial.eras ?? [])
  const [difficulties, setDifficulties] = useState<Difficulty[]>(initial.difficulties ?? [])
  const [kinds, setKinds] = useState<QuestionKind[]>(initial.kinds ?? [])

  const config: RoomConfig = useMemo(
    () => ({
      questionCount,
      eras: eras.length ? eras : undefined,
      difficulties: difficulties.length ? difficulties : undefined,
      // בלי בחירה נכנסים כל הסוגים, בדיוק כמו בתקופות ובקושי
      kinds: kinds.length ? kinds : undefined,
    }),
    [questionCount, eras, difficulties, kinds],
  )

  // אילו סוגים אפשר בכלל לייצר מהתקופה והקושי שנבחרו. מחושב בלי סינון
  // הסוגים עצמו, אחרת בחירה אחת הייתה מעלימה את כל השאר מהמסך.
  const offered = useMemo(
    () =>
      availableKinds(SONGS, {
        seed: 'preview',
        questionCount,
        eras: eras.length ? eras : undefined,
        difficulties: difficulties.length ? difficulties : undefined,
        allowAudio,
      }),
    [questionCount, eras, difficulties, allowAudio],
  )

  // סוג שנבחר וכבר לא אפשרי (כי צמצמו תקופה) לא נחשב
  const effective = kinds.filter((k) => offered.includes(k))
  const tooNarrow = offered.length === 0 || (kinds.length > 0 && effective.length === 0)

  return (
    <div className="flex min-h-dvh flex-col gap-6 py-8">
      <header>
        <button type="button" onClick={onBack} className="text-sm text-white/40 hover:text-white">
          ← חזרה
        </button>
        <h1 className="mt-3 text-3xl font-black">{title}</h1>
      </header>

      <Section label="כמה שאלות">
        <div className="grid grid-cols-4 gap-2">
          {COUNTS.map((n) => (
            <Chip key={n} active={questionCount === n} onClick={() => setQuestionCount(n)}>
              {n}
            </Chip>
          ))}
        </div>
      </Section>

      <Section label="מאיזו תקופה" hint="בלי בחירה, מערבבים הכל">
        <div className="grid grid-cols-2 gap-2">
          {ERAS.map((era) => (
            <Chip key={era} active={eras.includes(era)} onClick={() => setEras(toggle(eras, era))}>
              {era}
            </Chip>
          ))}
        </div>
      </Section>

      <Section label="רמת קושי" hint="נקבע לפי כמה השיר חזר באוספים לאורך השנים">
        <div className="grid grid-cols-3 gap-2">
          {DIFFICULTIES.map((d) => (
            <Chip
              key={d}
              active={difficulties.includes(d)}
              onClick={() => setDifficulties(toggle(difficulties, d))}
            >
              {DIFFICULTY_LABELS[d]}
            </Chip>
          ))}
        </div>
      </Section>

      <Section label="סוגי שאלות" hint="בלי בחירה, נכנסים כל הסוגים">
        {offered.length ? (
          <div className="grid grid-cols-2 gap-2">
            {offered.map((k) => (
              <Chip key={k} active={kinds.includes(k)} onClick={() => setKinds(toggle(kinds, k))}>
                {KIND_LABELS[k] ?? k}
              </Chip>
            ))}
          </div>
        ) : (
          <span className="text-sm text-wine-soft">
            הסינון צר מדי, לא נשארו מספיק שירים. תרחיבו קצת.
          </span>
        )}
      </Section>

      <div className="mt-auto grid gap-2 pt-4">
        {note && <p className="text-center text-sm text-white/40">{note}</p>}
        <button
          type="button"
          disabled={tooNarrow}
          onClick={() => onSubmit(config)}
          className="btn-gold py-4 text-lg"
        >
          {submitLabel}
        </button>
      </div>
    </div>
  )
}

function Section({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section className="grid gap-2">
      <div>
        <h2 className="font-bold">{label}</h2>
        {hint && <p className="text-xs text-white/35">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border px-3 py-3 text-sm font-bold transition active:scale-[0.97] ${
        active
          ? 'border-gold bg-gold/15 text-gold-bright'
          : 'border-night-line bg-night-soft text-white/60'
      }`}
    >
      {children}
    </button>
  )
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}
