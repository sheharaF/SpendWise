import { shift } from './dates.js';

const dateCode = date => date.replaceAll('-', '');
const escapeText = value => String(value).replaceAll('\\', '\\\\').replaceAll(/\r\n|\r|\n/g, '\\n').replaceAll(';', '\\;').replaceAll(',', '\\,');

function eventInfo(offer, kind, bank) {
  return {
    title: `${kind === 'Expiry reminder' ? 'Offer ends' : 'Offer'}: ${offer.name} · ${bank}`,
    description: [offer.summary, offer.eligibility, offer.period, offer.url].filter(Boolean).join('\n'),
  };
}

function fold(line) {
  const encoder = new TextEncoder();
  let result = '';
  let count = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    if (count + bytes > 75) {
      result += '\r\n ';
      count = 1;
    }
    result += char;
    count += bytes;
  }
  return result;
}

export function calendarFile(offer, date, kind, bank, now = new Date()) {
  const event = eventInfo(offer, kind, bank);
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Offer Finder//Card Offers//EN', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT', `UID:${offer.id}-${date}@offer-finder`,
    `DTSTAMP:${now.toISOString().replaceAll(/[-:]|\.\d{3}/g, '')}`,
    `DTSTART;VALUE=DATE:${dateCode(date)}`, `DTEND;VALUE=DATE:${dateCode(shift(date, 1))}`,
    `SUMMARY:${escapeText(event.title)}`, `DESCRIPTION:${escapeText(event.description)}`,
    `LOCATION:${escapeText(offer.location || '')}`, 'END:VEVENT', 'END:VCALENDAR',
  ].map(fold).join('\r\n') + '\r\n';
}

export function googleCalendar(offer, date, kind, bank) {
  const event = eventInfo(offer, kind, bank);
  const url = new URL('https://calendar.google.com/calendar/render');
  url.search = new URLSearchParams({
    action: 'TEMPLATE', text: event.title, details: event.description,
    dates: `${dateCode(date)}/${dateCode(shift(date, 1))}`, location: offer.location || '',
  }).toString();
  return url.href;
}

