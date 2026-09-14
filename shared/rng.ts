// אקראיות דטרמיניסטית: אותו seed מחזיר בדיוק אותה סדרה, תמיד.
//
// זה מה שמחזיק את המולטיפלייר. במקום לשלוח עשר שאלות לעשרה טלפונים,
// השרת שולח מחרוזת אחת קצרה והמכשירים מייצרים את אותו חידון בדיוק
// אצל כל אחד. אין תלות ברוחב פס, ואותו קוד רץ גם כשאין רשת בכלל.

export type Rng = () => number

// mulberry32 — מהיר, קטן, ומספיק אקראי לחידון
export function createRng(seed: string): Rng {
  let a = hashSeed(seed)
  return function next() {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashSeed(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function randInt(rng: Rng, maxExclusive: number): number {
  return Math.floor(rng() * maxExclusive)
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[randInt(rng, items.length)]
}

export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// בוחר עד n פריטים שונים, בלי לשכפל
export function sample<T>(rng: Rng, items: readonly T[], n: number): T[] {
  return shuffle(rng, items).slice(0, n)
}

// קוד חדר קריא בטלפון: בלי אותיות שמתבלבלות (O/0, I/1)
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export function makeRoomCode(rng: Rng, length = 4): string {
  return Array.from({ length }, () => pick(rng, [...ROOM_ALPHABET])).join('')
}
