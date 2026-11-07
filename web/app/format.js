// Display formatting. Numbers are rounded by the engine; this file only
// decides how they read.

export const HOUR = 60 * 60 * 1000;

export function hours(ms) {
  const h = ms / HOUR;
  if (h === 0) return '0 h';
  if (h < 1) return `${Math.round(ms / 60000)} min`;
  return `${h.toFixed(1)} h`;
}

export function h1(value) {
  return `${Number(value).toFixed(1)} h`;
}

export function pct(value, digits = 0) {
  return `${(value * 100).toFixed(digits)}%`;
}

export function signed(value) {
  if (value === null || value === undefined) return null;
  const sign = value > 0 ? '+' : '';
  return `${sign}${Number(value).toFixed(1)}%`;
}

export function dayLabel(iso, style = 'short') {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (style === 'long') {
    return date.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  }
  return date.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function rangeLabel(start, end) {
  const fmt = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });
  };
  return `${fmt(start)} – ${fmt(end)}`;
}

export function hourLabel(hour) {
  const suffix = hour < 12 ? 'am' : 'pm';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}${suffix}`;
}

export function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}
