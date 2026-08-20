/**
 * A port of `src-tauri/src/util.rs`.
 *
 * Everything here is a rule the interface can see the result of: how a date
 * typed into a spreadsheet is read, how a premium is grouped, which category a
 * stray product name lands in. Two implementations that disagree here disagree
 * visibly, so this file follows the Rust one case for case rather than reaching
 * for whatever a JavaScript date library would do instead. `tests/util.test.ts`
 * holds it to that.
 */

/** Days are handled as ISO strings, and arithmetic goes through UTC so that no
 * daylight saving jump can move a policy's expiry by a day. */
function partsToStamp(year: number, month: number, day: number): number | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const stamp = Date.UTC(year, month - 1, day);
  const date = new Date(stamp);
  // Rejects the dates that do not exist: 31 February rolls forward, and a roll
  // means the input was wrong.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return stamp;
}

function fromParts(year: number, month: number, day: number): string | null {
  const stamp = partsToStamp(year, month, day);
  return stamp === null ? null : isoFromStamp(stamp);
}

function isoFromStamp(stamp: number): string {
  const date = new Date(stamp);
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");
  return `${date.getUTCFullYear()}-${month}-${day}`;
}

/** Single digits are allowed where chrono's `%Y-%m-%d` allows them. */
function stampOf(isoDate: string): number | null {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(isoDate.trim());
  if (!match) return null;
  return partsToStamp(Number(match[1]), Number(match[2]), Number(match[3]));
}

const DAY = 86_400_000;

export function todayIso(): string {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function addDays(isoDate: string, days: number): string | null {
  const stamp = stampOf(isoDate);
  return stamp === null ? null : isoFromStamp(stamp + days * DAY);
}

const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

/** Month names match however they were typed, long or short, as chrono's do. */
function monthFromName(name: string): number | null {
  const text = name.trim().toLowerCase();
  const index = MONTH_NAMES.findIndex((month) => month === text || month.slice(0, 3) === text);
  return index === -1 ? null : index + 1;
}

/** Two digits, as chrono reads them: 00–68 is this century, 69–99 the last. */
function fullYear(twoDigits: number): number {
  return twoDigits <= 68 ? 2000 + twoDigits : 1900 + twoDigits;
}

/**
 * Accepts the date shapes that turn up in real agency spreadsheets and returns
 * an ISO string. Day-first is assumed for ambiguous values because the target
 * users write DD/MM/YYYY.
 */
export function parseDate(raw: string): string | null {
  const text = raw.trim();
  if (text === "") return null;

  // Already ISO, possibly with a time component.
  const head = text.split(/[T ]/)[0] ?? "";
  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(head);
  if (isoMatch) {
    const parsed = fromParts(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
    if (parsed) return parsed;
  }

  const dayFirst = /^(\d{1,2})([/\-.])(\d{1,2})\2(\d{4})$/.exec(text);
  if (dayFirst) {
    const parsed = fromParts(Number(dayFirst[4]), Number(dayFirst[3]), Number(dayFirst[1]));
    if (parsed) return parsed;
  }

  const shortYear = /^(\d{1,2})([/\-])(\d{1,2})\2(\d{2})$/.exec(text);
  if (shortYear) {
    const parsed = fromParts(fullYear(Number(shortYear[4])), Number(shortYear[3]), Number(shortYear[1]));
    if (parsed) return parsed;
  }

  const namedMonth = /^(\d{1,2})([- ])([A-Za-z]+)\2(\d{4})$/.exec(text);
  if (namedMonth) {
    const month = monthFromName(namedMonth[3]!);
    if (month) {
      const parsed = fromParts(Number(namedMonth[4]), month, Number(namedMonth[1]));
      if (parsed) return parsed;
    }
  }

  const monthFirst = /^([A-Za-z]+) (\d{1,2}), (\d{4})$/.exec(text);
  if (monthFirst) {
    const month = monthFromName(monthFirst[1]!);
    if (month) {
      const parsed = fromParts(Number(monthFirst[3]), month, Number(monthFirst[2]));
      if (parsed) return parsed;
    }
  }

  const yearFirst = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(text);
  if (yearFirst) {
    const parsed = fromParts(Number(yearFirst[1]), Number(yearFirst[2]), Number(yearFirst[3]));
    if (parsed) return parsed;
  }

  // Excel stores dates as a day count from 1899-12-30. The range keeps a
  // premium of 45000 from being read as a date in 2023.
  if (/^-?\d+(\.\d+)?$/.test(text)) {
    const serial = Number(text);
    if (serial >= 20_000 && serial < 80_000) return excelSerialToIso(serial);
  }

  return null;
}

export function excelSerialToIso(serial: number): string {
  return isoFromStamp(Date.UTC(1899, 11, 30) + Math.trunc(serial) * DAY);
}

/**
 * Strips currency symbols, thousands separators and stray text from a number.
 * "₹10,00,000" and "Rs. 24,500.50" both come through intact.
 */
export function parseNumber(raw: string): number | null {
  const negative = raw.trimStart().startsWith("-") || raw.includes("(");
  let cleaned = Array.from(raw)
    .filter((char) => (char >= "0" && char <= "9") || char === ".")
    .join("");

  // Leading dots come from prefixes like "Rs." rather than from the number.
  cleaned = cleaned.replace(/^\.+/, "");

  // Several dots means they are grouping separators; only the last can be decimal.
  const dots = (cleaned.match(/\./g) ?? []).length;
  if (dots > 1) {
    const split = cleaned.lastIndexOf(".");
    cleaned = cleaned.slice(0, split).replace(/\./g, "") + cleaned.slice(split);
  }

  if (cleaned.replace(/^\.+|\.+$/g, "") === "") return null;

  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

/**
 * Renders an ISO date the way the agency writes it, following the `date_format`
 * setting. Anything unrecognised falls back to day-first, which is what the
 * seeded default uses.
 */
export function formatDate(isoDate: string, pattern: string): string {
  const stamp = stampOf(isoDate);
  if (stamp === null) return isoDate;
  const date = new Date(stamp);
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");
  const shortMonth = MONTH_NAMES[date.getUTCMonth()]!.slice(0, 3);
  const monthName = shortMonth.charAt(0).toUpperCase() + shortMonth.slice(1);

  switch (pattern.trim()) {
    case "yyyy-MM-dd":
      return `${year}-${month}-${day}`;
    case "MM/dd/yyyy":
      return `${month}/${day}/${year}`;
    case "dd-MM-yyyy":
      return `${day}-${month}-${year}`;
    case "dd MMM yyyy":
      return `${day} ${monthName} ${year}`;
    default:
      return `${day}/${month}/${year}`;
  }
}

/**
 * Money in the Indian convention: a group of three, then groups of two, so
 * 1000000 reads as 10,00,000 rather than 1,000,000.
 */
export function formatMoney(amount: number, currency: string): string {
  const code = currency.trim().toUpperCase();
  const symbols: Record<string, string> = { INR: "₹", "": "₹", USD: "$", EUR: "€", GBP: "£" };
  const symbol = symbols[code];
  if (symbol === undefined) return `${code} ${groupIndian(amount)}`;
  return `${symbol}${groupIndian(amount)}`;
}

function groupIndian(amount: number): string {
  const negative = amount < 0;
  const rounded = Math.round(Math.abs(amount) * 100) / 100;
  const whole = Math.trunc(rounded);
  const paise = Math.round((rounded - whole) * 100);

  const digits = `${whole}`;
  let grouped = digits;
  if (digits.length > 3) {
    const head = digits.slice(0, digits.length - 3);
    const tail = digits.slice(digits.length - 3);
    const parts: string[] = [];
    let index = head.length;
    while (index > 2) {
      parts.push(head.slice(index - 2, index));
      index -= 2;
    }
    parts.push(head.slice(0, index));
    parts.reverse();
    grouped = `${parts.join(",")},${tail}`;
  }

  const body = paise > 0 ? `${grouped}.${`${paise}`.padStart(2, "0")}` : grouped;
  return negative ? `-${body}` : body;
}

/** Whole days from today until the date, negative once it is in the past. */
export function daysUntil(isoDate: string): number | null {
  const stamp = stampOf(isoDate);
  if (stamp === null) return null;
  const today = stampOf(todayIso());
  if (today === null) return null;
  return Math.round((stamp - today) / DAY);
}

/** Adds a year (minus a day) to a start date, the usual annual policy term. */
export function defaultExpiry(start: string): string | null {
  const stamp = stampOf(start);
  if (stamp === null) return null;
  const date = new Date(stamp);
  const year = date.getUTCFullYear() + 1;
  const month = date.getUTCMonth() + 1;
  // A 29 February start has no anniversary in a common year, so it takes the
  // 28th, as the Rust side does.
  const anniversary = fromParts(year, month, date.getUTCDate()) ?? fromParts(year, month, 28);
  return anniversary === null ? null : addDays(anniversary, -1);
}

export const CATEGORIES = [
  "health",
  "life",
  "motor",
  "travel",
  "home",
  "personal_accident",
  "critical_illness",
  "other",
] as const;

export type Category = (typeof CATEGORIES)[number];

/** Maps whatever the spreadsheet calls a product line onto our category set. */
export function normaliseCategory(raw: string): string {
  const text = raw.trim().toLowerCase();
  if (text === "") return "other";
  if ((CATEGORIES as readonly string[]).includes(text)) return text;
  const has = (needles: string[]) => needles.some((needle) => text.includes(needle));

  if (has(["mediclaim", "health", "hospital", "family floater", "medical"])) return "health";
  if (has(["term", "endowment", "ulip", "life", "money back", "pension", "annuity"])) return "life";
  if (has(["motor", "car", "bike", "two wheeler", "2 wheeler", "vehicle", "auto"])) return "motor";
  if (has(["travel", "trip", "international", "overseas", "student"])) return "travel";
  if (has(["home", "house", "property", "fire", "householder"])) return "home";
  if (has(["accident", "pa "])) return "personal_accident";
  if (has(["critical", "cancer"])) return "critical_illness";
  return "other";
}

export function categoryLabel(category: string): string {
  switch (category) {
    case "health":
      return "Health";
    case "life":
      return "Life";
    case "motor":
      return "Motor";
    case "travel":
      return "Travel / International";
    case "home":
      return "Home";
    case "personal_accident":
      return "Personal Accident";
    case "critical_illness":
      return "Critical Illness";
    default:
      return "Other";
  }
}

export function normaliseGender(raw: string): string | null {
  switch (raw.trim().toLowerCase()) {
    case "m":
    case "male":
    case "man":
      return "male";
    case "f":
    case "female":
    case "woman":
      return "female";
    case "":
      return null;
    default:
      return "other";
  }
}

/** The words `client_relations.relationship` accepts, matching its `CHECK`. */
export const RELATIONSHIPS = [
  "spouse",
  "son",
  "daughter",
  "father",
  "mother",
  "brother",
  "sister",
  "other",
];

/**
 * Whether a spreadsheet or an operator means the policyholder themselves rather
 * than a second person. There is no `self` relationship: a client does not relate
 * to themselves, so a life named this way resolves to the client's own row.
 */
export function isSelfRelationship(raw: string | null | undefined): boolean {
  switch (raw?.trim().toLowerCase()) {
    case "self":
    case "proposer":
    case "primary":
    case "insured":
    case "policyholder":
      return true;
    default:
      return false;
  }
}

export function normaliseRelationship(raw: string): string {
  switch (raw.trim().toLowerCase()) {
    case "spouse":
    case "wife":
    case "husband":
    case "partner":
      return "spouse";
    case "son":
    case "child (male)":
      return "son";
    case "daughter":
    case "child (female)":
      return "daughter";
    case "father":
    case "dad":
    case "papa":
      return "father";
    case "mother":
    case "mom":
    case "mum":
    case "mummy":
      return "mother";
    case "brother":
    case "bro":
      return "brother";
    case "sister":
    case "sis":
      return "sister";
    default:
      return "other";
  }
}

/** Keeps only digits (and a leading +) from a phone number. */
export function normalisePhone(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const plus = trimmed.startsWith("+");
  const digits = trimmed.replace(/[^0-9]/g, "");
  if (digits === "") return null;
  return plus ? `+${digits}` : digits;
}

export function looksLikeEmail(value: string): boolean {
  const text = value.trim();
  const parts = text.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts as [string, string];
  return (
    local !== "" &&
    domain.includes(".") &&
    !domain.startsWith(".") &&
    !domain.endsWith(".") &&
    !/\s/.test(text)
  );
}

/** Title-cases a name without mangling initials or hyphenated parts. */
export function tidyName(raw: string): string {
  return raw
    .split(/\s+/)
    .filter((word) => word !== "")
    .map((word) => {
      // "SBI" and "M/s" are left alone; "RAJESH" is not, because a short word in
      // capitals is an initialism and a long one is someone shouting.
      const initialism = Array.from(word).every((char) => {
        const cased = char !== char.toLowerCase() || char !== char.toUpperCase();
        return !cased || char === char.toUpperCase();
      });
      if (initialism && word.length <= 3) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}
