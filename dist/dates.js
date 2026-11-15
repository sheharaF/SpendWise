const zone = 'Asia/Colombo';
const months = 'January February March April May June July August September October November December'.split(' ');
const weekdays = 'Sunday Monday Tuesday Wednesday Thursday Friday Saturday'.split(' ');
const monthPattern = months.map(m => m.slice(0, 3) + '(?:' + m.slice(3) + ')?').join('|');
const dateToken = new RegExp('\\b(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+(' + monthPattern + '))?(?:[, ]+(20\\d{2}))?\\b', 'gi');

export function sriDate(value = Date.now()) {
  if (value == null || value === '') return '';
  const date = new Date(value);
  if (Number.isNaN(+date)) return '';
  return new Intl.DateTimeFormat('sv-SE', { timeZone: zone }).format(date);
}

export function dateAt(year, month, day) {
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

export function shift(date, days) {
  const [year, month, day] = date.split('-').map(Number);
  return dateAt(year, month - 1, day + days);
}

export function printDate(date, options = { day: 'numeric', month: 'short', year: 'numeric' }) {
  return new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' }).format(new Date(date));
}

function tokensFor(text, fallback) {
  const matches = [...text.matchAll(dateToken)];
  const explicit = matches.filter(m => m[2]);
  if (!explicit.length) return [];
  const fallbackYear = fallback?.slice(0, 4);
  const tokenDate = (match, index) => {
    const nearest = matches.slice(index + 1).find(m => m[2]) || [...matches.slice(0, index)].reverse().find(m => m[2]);
    const monthName = match[2] || nearest?.[2];
    const year = match[3] || matches.slice(index + 1).find(m => m[3])?.[3] || fallbackYear;
    if (!year || !monthName) return '';
    const month = months.findIndex(m => m.toLowerCase().startsWith(monthName.toLowerCase()));
    const day = Number(match[1]);
    const key = dateAt(Number(year), month, day);
    return Number(key.slice(-2)) === day ? key : '';
  };
  return matches.map((match, index) => ({ key: tokenDate(match, index), index: match.index, end: match.index + match[0].length })).filter(m => m.key);
}

export function parseSchedule(raw, { listedFrom = '', fallbackEnd = '' } = {}) {
  const text = raw.trim().replaceAll(/\s+/g, ' ').replace(/^promotion period\s*[:–-]?\s*/i, '')
    .replaceAll(/\bat\s+\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?/gi, '');
  const dates = tokensFor(text, fallbackEnd);
  const last = dates.at(-1)?.key ?? '';
  const every = text.match(/\bevery\b([^.;]*?)(?:\b(?:till|until|from|on)\b|$)/i) ||
    text.match(/\bon\s+((?:sun|mon|tues|wednes|thurs|fri|satur)days?[^\d(]*)(?=[\d(]|$)/i);
  if (every) {
    const days = weekdays.flatMap((day, index) => new RegExp('\\b' + day + 's?\\b', 'i').test(every[1]) ? [index] : []);
    const end = last || fallbackEnd;
    const from = dates.length === 2 && /^(?:to|[-–—])$/i.test(text.slice(dates[0].end, dates[1].index).trim())
      ? dates[0].key : dates.length <= 1 ? listedFrom : '';
    if (end && from && from <= end && days.length && !/except|excluding|first|last/i.test(text)) {
      return { end, periods: [{ from, to: end, days }] };
    }
    return { end, periods: [] };
  }
  if (/\b(?:till|until|through)\b/i.test(text) && dates.length === 1) return { end: last, periods: [] };
  if (!dates.length || /\b(?:booking|checkout|check.?in|blackout|except|excluding|weekday|weekend)\b/i.test(text)) {
    return { end: fallbackEnd, periods: [] };
  }
  const periods = [];
  for (let i = 0; i < dates.length; i++) {
    const a = dates[i];
    const b = dates[i + 1];
    const between = b ? text.slice(a.end, b.index).trim() : '';
    if (b && /^(?:to|[-–—])$/i.test(between) && a.key <= b.key) {
      periods.push({ from: a.key, to: b.key });
      i++;
    } else {
      periods.push({ from: a.key, to: a.key });
    }
  }
  return { end: periods.map(p => p.to).sort().at(-1) || fallbackEnd, periods };
}

export function eventKind(offer, day) {
  if (offer.excluded?.includes(day)) return '';
  const match = offer.periods.some(p => p.from <= day && day <= p.to &&
    (!p.days || p.days.includes(new Date(day).getUTCDay())));
  if (match) return 'Offer day';
  return !offer.periods.length && day === offer.end ? 'Expiry reminder' : '';
}

