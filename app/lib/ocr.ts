import { requireOptionalNativeModule } from 'expo-modules-core';

// On-device text recognition (Apple Vision on iOS — the engine behind Live Text —
// and Google ML Kit on Android) via expo-text-extractor.
//
// The native module only exists in builds made after it was added. It's loaded
// lazily so older builds keep working: readTextOnDevice() just returns null and
// callers fall back to AI-only scanning.

let mod: { isSupported: boolean; extractTextFromImage: (uri: string) => Promise<string[]> } | null | undefined;

function loadModule() {
  if (mod !== undefined) return mod;
  // Check quietly first: requiring the package in a build without the native module
  // throws (and logs a red error) even when the require is wrapped in try/catch.
  if (!requireOptionalNativeModule('ExpoTextExtractor')) {
    mod = null; // native module not in this build — callers fall back to AI-only scanning
    return mod;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('expo-text-extractor');
  } catch {
    mod = null;
  }
  return mod;
}

/** Lines of text found in the image, or null if on-device recognition isn't available. */
export async function readTextOnDevice(uri: string): Promise<string[] | null> {
  const m = loadModule();
  if (!m || !m.isSupported) return null;
  try {
    const lines = await m.extractTextFromImage(uri);
    return Array.isArray(lines) ? lines.map(l => String(l).trim()).filter(Boolean) : null;
  } catch {
    return null;
  }
}

const MONTHS: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, SEPT: 9, OCT: 10, NOV: 11, DEC: 12,
};

const pad = (n: number) => String(n).padStart(2, '0');
const lastDayOfMonth = (y: number, m: number) => new Date(y, m, 0).getDate();
const fullYear = (y: number) => (y < 100 ? 2000 + y : y);

function valid(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > lastDayOfMonth(y, m)) return null;
  const date = new Date(y, m - 1, d);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const years = (date.getTime() - today.getTime()) / (365 * 86400000);
  if (years < -1 || years > 5) return null; // not a plausible expiry date
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Every date-looking string in a piece of text, normalized to YYYY-MM-DD. */
function findDates(text: string): string[] {
  const t = text.toUpperCase().replace(/[,]/g, ' ');
  const out: string[] = [];
  let m: RegExpExecArray | null;

  // 2027-05-14
  const iso = /\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/g;
  while ((m = iso.exec(t))) { const v = valid(+m[1], +m[2], +m[3]); if (v) out.push(v); }

  // 05/14/27, 05-14-2027, 05.14.27 (US month-first)
  const mdy = /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})\b/g;
  while ((m = mdy.exec(t))) { const v = valid(fullYear(+m[3]), +m[1], +m[2]); if (v) out.push(v); }

  // MAY 14 2027, MAY 14 27, MAY14 27
  const mdyText = /\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEPT?|OCT|NOV|DEC)[A-Z]*\.?\s*(\d{1,2})\s+(\d{2}|\d{4})\b/g;
  while ((m = mdyText.exec(t))) { const v = valid(fullYear(+m[3]), MONTHS[m[1]], +m[2]); if (v) out.push(v); }

  // 14 MAY 2027, 14MAY27
  const dmyText = /\b(\d{1,2})\s*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEPT?|OCT|NOV|DEC)[A-Z]*\.?\s*(\d{2}|\d{4})\b/g;
  while ((m = dmyText.exec(t))) { const v = valid(fullYear(+m[3]), MONTHS[m[2]], +m[1]); if (v) out.push(v); }

  // MAY 2027 / 05/27 (month + year only → last day of that month)
  const myText = /\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEPT?|OCT|NOV|DEC)[A-Z]*\.?\s+(20\d{2})\b/g;
  while ((m = myText.exec(t))) { const y = +m[2], mo = MONTHS[m[1]]; const v = valid(y, mo, lastDayOfMonth(y, mo)); if (v) out.push(v); }

  return out;
}

const KEYWORDS = /(BEST\s*(IF\s*USED\s*)?(BY|BEFORE)|USE\s*BY|SELL\s*BY|EXP(IRES|IRY|\.)?|BB\b|BBE\b)/i;

/**
 * Pull the expiry date out of label text. Prefers a date that follows a
 * "best by / use by / exp" keyword; otherwise the latest plausible date found.
 */
export function parseExpiryFromText(lines: string[]): string | null {
  // A keyword and its date can be on the same line or the next one
  for (let i = 0; i < lines.length; i++) {
    if (!KEYWORDS.test(lines[i])) continue;
    const after = lines[i].slice(lines[i].search(KEYWORDS));
    const dates = findDates(after).concat(i + 1 < lines.length ? findDates(lines[i + 1]) : []);
    if (dates.length) return dates[0];
  }
  const all = lines.flatMap(findDates);
  if (!all.length) return null;
  return all.sort().at(-1) ?? null; // latest date — packing dates come before expiry dates
}
