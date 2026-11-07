// Shared numeric and time helpers.
//
// The engine must agree with the Python oracle bit for bit, which means two
// things here are deliberately fussy: rounding is Python's round() (half to
// even), and every date calculation is done on a fixed UTC offset so that a
// timezone change cannot move last week's numbers.

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/**
 * Python's round(), exactly: ties go to the even neighbour, and the tie is
 * decided on the true binary value of the double, not on its decimal
 * approximation. 0.15 is really 0.1499999999999999944, so round(0.15, 1) is
 * 0.1 in Python and must be 0.1 here too — multiplying by ten would call it
 * a tie and return 0.2.
 */
export function pyRound(value, digits = 0) {
  if (!Number.isFinite(value)) return 0;
  if (value === 0) return 0;

  const negative = value < 0;
  const abs = Math.abs(value);

  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, abs);
  const high = view.getUint32(0);
  const low = view.getUint32(4);
  const exponentBits = (high >>> 20) & 0x7ff;
  let mantissa = (BigInt(high & 0xfffff) << 32n) | BigInt(low);
  let exponent;
  if (exponentBits === 0) {
    exponent = -1074;
  } else {
    mantissa |= 1n << 52n;
    exponent = exponentBits - 1075;
  }

  let numerator = mantissa * 10n ** BigInt(digits);
  let denominator = 1n;
  if (exponent >= 0) numerator <<= BigInt(exponent);
  else denominator <<= BigInt(-exponent);

  let quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const twice = remainder * 2n;
  if (twice > denominator || (twice === denominator && quotient % 2n === 1n)) quotient += 1n;

  const result = Number(quotient) / 10 ** digits;
  return negative ? -result : result;
}

/** Python's str() for a float: integral values keep a trailing .0. */
export function pyFloat(value) {
  if (!Number.isFinite(value)) return String(value);
  if (Number.isInteger(value)) return value.toFixed(1);
  return String(value);
}

/** statistics.median(): mean of the two middle values when the count is even. */
export function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function mean(values) {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function pad2(n) {
  return String(n).padStart(2, '0');
}

export function isoDate(ms, offsetMin) {
  const d = new Date(ms + offsetMin * MINUTE);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function isoHour(ms, offsetMin) {
  return new Date(ms + offsetMin * MINUTE).getUTCHours();
}

/** Midnight boundaries of a local date, as UTC milliseconds. */
export function dayBounds(day, offsetMin) {
  const [y, m, d] = day.split('-').map(Number);
  const start = Date.UTC(y, m - 1, d) - offsetMin * MINUTE;
  return [start, start + DAY];
}

export function addDays(day, delta) {
  const [y, m, d] = day.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + delta * DAY;
  return new Date(t).toISOString().slice(0, 10);
}

export function daysBetween(start, end) {
  const out = [];
  let cursor = start;
  while (cursor <= end) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}

export function weekdayIndex(day) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
}
