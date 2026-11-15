import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eventKind, parseSchedule, sriDate } from '../dist/dates.js';
import { calendarFile, googleCalendar } from '../dist/event.js';

test('Sampath’s separate supermarket dates do not become a continuous period', () => {
  const schedule = parseSchedule('Valid on 14th & 28th November 2026');
  assert.equal(eventKind(schedule, '2026-11-14'), 'Offer day');
  assert.equal(eventKind(schedule, '2026-11-15'), '');
  assert.equal(eventKind(schedule, '2026-11-28'), 'Offer day');
});
test('weekly offers are bounded and only marked on the named weekday', () => {
  const schedule = parseSchedule('EVERY WEDNESDAY till 25th November 2026', { listedFrom: '2026-10-30' });
  assert.equal(eventKind(schedule, '2026-11-18'), 'Offer day');
  assert.equal(eventKind(schedule, '2026-11-19'), '');
  assert.equal(eventKind(schedule, '2026-12-02'), '');
});
test('calendar keeps a stated date range and distinguishes expiry-only data', () => {
  const range = parseSchedule('Valid from 01st December 2026 to 31st March 2027');
  assert.equal(eventKind(range, '2027-02-01'), 'Offer day');
  assert.equal(eventKind(range, '2027-04-01'), '');
  const expiry = parseSchedule('Valid till 25th November 2026');
  assert.equal(eventKind(expiry, '2026-11-25'), 'Expiry reminder');
  assert.equal(eventKind(expiry, '2026-11-24'), '');
  assert.equal(sriDate(new Date('2026-11-15T18:30:00Z')), '2026-11-16');
});
test('BOC weekday ranges and Sampath ranges with a start time keep the correct dates', () => {
  const boc = parseSchedule('On Wednesdays & Sundays (01st - 29th November 2026)');
  assert.equal(eventKind(boc, '2026-11-18'), 'Offer day');
  assert.equal(eventKind(boc, '2026-11-22'), 'Offer day');
  assert.equal(eventKind(boc, '2026-11-19'), '');
  const sampath = parseSchedule('Valid from 10th November at 8 PM to 21st November 2026');
  assert.equal(eventKind(sampath, '2026-11-08'), '');
  assert.equal(eventKind(sampath, '2026-11-16'), 'Offer day');
});
test('both calendar exports produce a single all-day event with an exclusive end', () => {
  const offer = { id: 'boc-1', name: 'A test, with punctuation', summary: 'විශේෂ දීමනා '.repeat(35), url: 'https://www.boc.lk/' };
  const ics = calendarFile(offer, '2026-12-31', 'Expiry reminder', 'BOC', new Date('2026-11-15T18:30:00Z'));
  assert.match(ics, /DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101\r\n/);
  assert.match(ics, /SUMMARY:Offer ends: A test\\, with punctuation/);
  assert.ok(ics.split('\r\n').every(line => Buffer.byteLength(line) <= 75));
  const google = new URL(googleCalendar(offer, '2026-12-31', 'Expiry reminder', 'BOC'));
  assert.equal(google.searchParams.get('dates'), '20261231/20270101');
});

