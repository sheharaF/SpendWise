import { dateAt, eventKind, printDate, shift, sriDate } from './dates.js';
import { calendarFile, googleCalendar } from './event.js';

const $ = id => document.getElementById(id);
const names = { sampath: 'Sampath Bank', boc: 'Bank of Ceylon' };
const colors = ['#629345', '#a04983', '#267f7d', '#b75d30', '#6b5daa', '#987014', '#39749e', '#977052'];
const tints = ['#eaf1de', '#f1e6ef', '#e0f0eb', '#f7e9dd', '#ebe7f4', '#f5edd9', '#e4edf5', '#f0e8dd'];
const today = sriDate();
const state = { bank: '', view: 'offers', month: today.slice(0, 7) + '-01', limit: 15 };
const dialog = $('popup');
let data = { banks: {}, offers: [] };
let filtered = [];
let calendarByDay = new Map();
let detailContext = null;
let loaded = false;
const fields = ['query', 'card', 'category', 'sort', 'from', 'to'];
const cardTypes = { credit: 'Credit card', debit: 'Debit card' };
const storageKey = 'offer-finder.preferences.v1';
const preferences = { hiddenBanks: new Set(), hiddenCategories: new Set(), hiddenCards: new Set(), favorites: new Set() };
try {
  const stored = JSON.parse(localStorage.getItem(storageKey));
  for (const key of Object.keys(preferences)) {
    if (Array.isArray(stored?.[key])) preferences[key] = new Set(stored[key]);
  }
} catch {
  $('settings-status').textContent = 'Your browser could not load saved preferences.';
}

const esc = value => String(value ?? '').replace(/[&<>"']/g, ch =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const categoryKey = offer => offer.bank + ':' + offer.category;
const categoryName = offer => data.banks[offer.bank]?.categories.find(c => c.id === offer.category)?.label || 'Other';
function hue(key) {
  return [...key].reduce((total, ch) => (total * 31 + ch.charCodeAt(0)) % colors.length, 0);
}
function cardLabel(offer) {
  if (offer.types.length === 2) return 'Credit & debit';
  return cardTypes[offer.types[0]] || 'See eligible cards';
}
function safeLink(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? esc(url.href) : '';
  } catch {
    return '';
  }
}

function allowedCards(bank) {
  return Object.keys(cardTypes).filter(type => !preferences.hiddenCards.has(bank + ':' + type));
}

function isVisible(offer) {
  if (preferences.hiddenBanks.has(offer.bank) || preferences.hiddenCategories.has(categoryKey(offer))) return false;
  const cards = allowedCards(offer.bank);
  return offer.types.length ? offer.types.some(type => cards.includes(type)) : cards.length === Object.keys(cardTypes).length;
}

function renderBanks() {
  const banks = Object.entries(names).filter(([bank]) => !preferences.hiddenBanks.has(bank));
  if (!banks.some(([bank]) => bank === state.bank)) state.bank = '';
  $('banks').innerHTML = [['', 'All banks'], ...banks].map(([value, label]) =>
    `<button type="button" class="pill" data-bank="${value}" aria-pressed="${state.bank === value}">${label}</button>`).join('');
}
function renderCategories() {
  const selected = $('category').value;
  const groups = state.bank ? [state.bank] : Object.keys(names).filter(bank => !preferences.hiddenBanks.has(bank));
  $('category').innerHTML = '<option value="">All categories</option>' + groups.map(bank => {
    const options = (data.banks[bank]?.categories || [])
      .filter(c => !preferences.hiddenCategories.has(bank + ':' + c.id))
      .map(c => `<option value="${esc(bank + ':' + c.id)}">${esc(c.label)}</option>`).join('');
    return state.bank || !options ? options : `<optgroup label="${names[bank]}">${options}</optgroup>`;
  }).join('');
  if ([...$('category').options].some(option => option.value === selected)) $('category').value = selected;
}

function preferenceCheckbox(group, key, label) {
  const selected = preferences[group].has(key) === (group === 'favorites');
  return `<input type="checkbox" aria-label="${esc(label)}" data-preference="${group}" value="${esc(key)}"${selected ? ' checked' : ''}>`;
}

function renderSettings() {
  $('settings-banks').innerHTML = Object.entries(data.banks).map(([bank, source]) => {
    const label = names[bank];
    const cards = Object.entries(cardTypes).map(([type, name]) =>
      `<label>${preferenceCheckbox('hiddenCards', bank + ':' + type, label + ' ' + name)} ${name}</label>`).join('');
    const categories = source.categories.map(({ id, label: category }) => {
      const key = bank + ':' + id;
      return `<div class="settings-category">
        <span>${esc(category)}</span>
        ${preferenceCheckbox('hiddenCategories', key, 'Show ' + category + ' from ' + label)}
        ${preferenceCheckbox('favorites', key, 'Favorite ' + category + ' from ' + label)}
      </div>`;
    }).join('');
    return `<section class="settings-bank" aria-labelledby="settings-${bank}">
      <div class="settings-bank-head">
        <h2 id="settings-${bank}">${esc(label)}</h2>
        <label>${preferenceCheckbox('hiddenBanks', bank, 'Show ' + label)} Show bank</label>
      </div>
      <fieldset class="settings-card-types">
        <legend>Cards</legend>
        ${cards}
      </fieldset>
      <div class="settings-category category-head" aria-hidden="true"><span>Category</span><span>Show</span><span>Favorite</span></div>
      ${categories}
    </section>`;
  }).join('') || '<p>No bank categories are available.</p>';
}

function matchesValidity(offer, from, to) {
  if (!from && !to) return true;
  if (!offer.end || (from && offer.end < from)) return false;
  if (!offer.periods.length) return !to || offer.end <= to;
  return offer.periods.some(period => {
    if ((to && period.from > to) || (from && period.to < from)) return false;
    if (!period.days) return true;
    const start = from && period.from < from ? from : period.from;
    const end = to && period.to > to ? to : period.to;
    for (let day = start, i = 0; i < 7 && day <= end; day = shift(day, 1), i++) {
      if (period.days.includes(new Date(day).getUTCDay())) return true;
    }
    return false;
  });
}

function applyFilters() {
  const q = $('query').value.trim().toLowerCase();
  const card = $('card').value;
  const category = $('category').value;
  const useValidity = state.bank === 'boc';
  const from = useValidity ? $('from').value : '';
  const to = useValidity ? $('to').value : '';
  $('filter-error').hidden = !(from && to && from > to);
  $('to').min = from;
  $('validity').hidden = !useValidity;
  $('sort-field').hidden = state.view === 'calendar';
  $('reset').hidden = !(state.bank || fields.some(id => $(id).value && $(id).value !== 'default'));
  const valid = $('filter-error').hidden;
  filtered = data.offers.filter(offer => valid &&
    isVisible(offer) &&
    (!state.bank || offer.bank === state.bank) &&
    (!card || offer.types.includes(card)) &&
    (!category || categoryKey(offer) === category) &&
    (!offer.end || offer.end >= today) &&
    (!q || [offer.name, offer.summary, offer.location, categoryName(offer)].some(value => value?.toLowerCase().includes(q))) &&
    matchesValidity(offer, from, to));
  if ($('sort').value === 'name') filtered.sort((a, b) => a.name.localeCompare(b.name));
  else if ($('sort').value === 'date') filtered.sort((a, b) => (a.end || '9999').localeCompare(b.end || '9999'));
  else if (!state.bank) {
    const groups = Object.keys(names).map(bank => filtered.filter(o => o.bank === bank));
    filtered = Array.from({ length: Math.max(...groups.map(g => g.length)) }, (_, i) =>
      groups.flatMap(g => g[i] ? [g[i]] : [])).flat();
  }
}

function offerCard(offer) {
  const image = safeLink(offer.image);
  const index = hue(categoryKey(offer));
  const initial = offer.name.split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase();
  const dateOptions = { day: 'numeric', month: 'short' };
  if (offer.end?.slice(0, 4) !== today.slice(0, 4)) dateOptions.year = 'numeric';
  const validity = offer.end ? `Through ${printDate(offer.end, dateOptions)}` : '';
  return `<button type="button" class="offer" data-offer="${esc(offer.id)}">
    <span class="offer-media" aria-hidden="true" style="--tint:${tints[index]}">
      <span>${esc(initial)}</span>${image ? `<img src="${image}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ''}
    </span>
    <span class="offer-info"><span class="offer-meta">${esc(names[offer.bank])} · ${esc(categoryName(offer))}</span>
      <strong class="offer-name">${esc(offer.name)}</strong>
      ${offer.discount ? `<span class="offer-discount">${esc(offer.discount)}</span>` : ''}
      <span class="offer-period">${cardLabel(offer)}${validity ? ' · ' + esc(validity) : ''}</span>
    </span>
  </button>`;
}

function renderOffers() {
  $('result-count').textContent = `${filtered.length} ${filtered.length === 1 ? 'offer' : 'offers'}`;
  $('offer-list').innerHTML = filtered.slice(0, state.limit).map(offerCard).join('') ||
    '<p class="empty">No offers match your filters or <a href="#settings">display settings</a>.</p>';
  $('more').hidden = filtered.length <= state.limit;
}

function monthOffset(amount) {
  const [year, month] = state.month.split('-').map(Number);
  state.month = dateAt(year, month - 1 + amount, 1);
  renderCalendar();
}

function renderCalendar() {
  const monthTitle = printDate(state.month, { month: 'long', year: 'numeric' });
  $('month').textContent = monthTitle;
  const first = new Date(state.month);
  const offset = (first.getUTCDay() + 6) % 7;
  const [year, month] = state.month.split('-').map(Number);
  const days = Number(dateAt(year, month, 0).slice(-2));
  const rows = Math.ceil((offset + days) / 7);
  const legend = new Map();
  calendarByDay = new Map();
  let markup = '';
  for (let i = 0; i < rows * 7; i++) {
    const day = shift(state.month, i - offset);
    const inMonth = day.startsWith(state.month.slice(0, 7));
    const entries = new Map();
    if (inMonth) {
      for (const offer of filtered) {
        if (offer.calendar === false || !eventKind(offer, day)) continue;
        const key = categoryKey(offer);
        if (!entries.has(key)) entries.set(key, []);
        entries.get(key).push(offer);
        legend.set(key, categoryName(offer));
      }
    }
    if (entries.size) calendarByDay.set(day, entries);
    const current = day === today ? ' aria-current="date"' : '';
    const digit = Number(day.slice(-2));
    const mark = [...entries].slice(0, 3).map(([key, offers]) => {
      const label = categoryName(offers[0]);
      return `<button class="marker" type="button" data-day="${day}" data-category="${esc(key)}"
        style="--dot:${colors[hue(key)]}" title="${esc(label)}" aria-label="${esc(label + ' on ' + printDate(day))}"><span class="dot"></span><span>${esc(label)}</span></button>`;
    }).join('');
    markup += `<div class="day${inMonth ? '' : ' outside'}">${entries.size
      ? `<button type="button" class="day-number" data-day="${day}" aria-label="Offers on ${printDate(day)}"${current}>${digit}</button>`
      : `<span class="day-number"${current}>${digit}</span>`}
      <div class="day-markers">${mark}${entries.size > 3 ? `<button class="marker more-categories" type="button" data-day="${day}" aria-label="All categories on ${printDate(day)}">+${entries.size - 3}</button>` : ''}</div></div>`;
  }
  $('month-grid').innerHTML = markup;
  $('legend').innerHTML = [...legend].map(([key, label]) =>
    `<button type="button" data-month-category="${esc(key)}" style="--dot:${colors[hue(key)]}"><span class="dot"></span>${esc(label)}${state.bank ? '' : ` · ${names[key.split(':')[0]] === names.boc ? 'BOC' : 'Sampath'}`}</button>`).join('') ||
    '<span class="calendar-help">No dated offers this month.</span>';
}

function render() {
  if (!loaded || state.view === 'settings') return;
  applyFilters();
  if (state.view === 'calendar') renderCalendar();
  else {
    renderReminders();
    renderOffers();
  }
}
function syncView(focus = false) {
  const path = location.hash.slice(1);
  const view = path === 'calendar' || path === 'settings' ? path : 'offers';
  state.view = view;
  document.querySelectorAll('[data-view]').forEach(link => {
    if (link.dataset.view === view) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  $('filters').hidden = view === 'settings';
  $('offers').hidden = view !== 'offers';
  $('calendar').hidden = view !== 'calendar';
  $('settings').hidden = view !== 'settings';
  if (view !== 'offers') $('reminders').hidden = true;
  render();
  if (focus) {
    $(view === 'offers' ? 'offer-heading' : view + '-heading').focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
}

function openPopup(title, body) {
  $('popup-title').textContent = title;
  $('popup-body').innerHTML = body;
  dialog.scrollTop = 0;
  if (!dialog.open) dialog.showModal();
  else dialog.querySelector('.close').focus();
}

function calendarPopup(day, key) {
  const selections = day ? [calendarByDay.get(day)] : [...calendarByDay.values()];
  const offers = new Map();
  for (const options of selections) {
    if (!options) continue;
    for (const [category, items] of options) {
      if (key && key !== category) continue;
      for (const offer of items) if (!offers.has(offer.id)) offers.set(offer.id, offer);
    }
  }
  detailContext = { day, key };
  const date = day ? printDate(day) : $('month').textContent;
  const category = key && offers.size ? categoryName(offers.values().next().value) : '';
  const title = category ? `${category} · ${date}` : date;
  openPopup(title, `<div class="dialog-offers">${[...offers.values()].map(offer => `<div>
    ${day ? `<span class="dialog-meta">${eventKind(offer, day)}</span>` : ''}
    ${offerCard(offer)}</div>`).join('')}</div>`);
}

function nextEvent(offer) {
  if (offer.calendar === false) return '';
  if (!offer.periods.length) return offer.end >= today && eventKind(offer, offer.end) ? offer.end : '';
  const next = [];
  for (const period of offer.periods) {
    const start = period.from > today ? period.from : today;
    for (let day = start, i = 0; i < 14 && day <= period.to; i++, day = shift(day, 1)) {
      if (eventKind(offer, day)) {
        next.push(day);
        break;
      }
    }
  }
  return next.sort()[0] || '';
}

function renderReminders() {
  const tomorrow = shift(today, 1);
  const month = today.slice(0, 7);
  const reminders = filtered
    .filter(offer => offer.types.length && preferences.favorites.has(categoryKey(offer)))
    .map(offer => ({ offer, day: nextEvent(offer) }))
    .filter(({ day }) => day === tomorrow || day.startsWith(month))
    .sort((a, b) => a.day.localeCompare(b.day) ||
      (parseFloat(b.offer.discount?.match(/[\d.]+/)?.[0]) || 0) - (parseFloat(a.offer.discount?.match(/[\d.]+/)?.[0]) || 0));
  $('reminders').hidden = !reminders.length;
  const row = ({ offer, day }) => {
    const when = day === today ? 'Today' : day === tomorrow ? 'Tomorrow' : printDate(day, { day: 'numeric', month: 'short' });
    const timing = eventKind(offer, day) === 'Expiry reminder'
      ? 'Ends ' + (day === today || day === tomorrow ? when.toLowerCase() : when)
      : when;
    return `<button type="button" class="reminder" data-offer="${esc(offer.id)}">
      <span class="reminder-date">${esc(timing)}</span>
      <strong>${esc(offer.name)}</strong>
      ${offer.discount ? `<span class="offer-discount">${esc(offer.discount)}</span>` : ''}
      <span class="offer-meta">${esc(names[offer.bank])} · ${esc(categoryName(offer))} · ${cardLabel(offer)}</span>
    </button>`;
  };
  $('reminder-list').innerHTML = reminders.slice(0, 3).map(row).join('') +
    (reminders.length > 3 ? `<details class="reminder-more"><summary>More favorite offers</summary>${reminders.slice(3).map(row).join('')}</details>` : '');
}

function showOffer(offer) {
  const day = detailContext?.day || nextEvent(offer);
  const bankUrl = safeLink(offer.url);
  const dateControls = day ? `
    <label>Calendar date<input id="event-date" type="date" value="${day}" ${detailContext?.day || !offer.periods.length ? 'readonly' : ''}></label>
    <button type="button" id="native-add" class="primary">Add to device calendar</button>
    <a class="secondary" id="google-add" target="_blank" rel="noopener noreferrer">Google Calendar</a>` : '';
  openPopup(offer.name, `
    <p class="dialog-meta">${esc(names[offer.bank])} · ${esc(categoryName(offer))} · ${cardLabel(offer)}</p>
    ${offer.summary ? `<p>${esc(offer.summary)}</p>` : ''}
    ${offer.location ? `<p class="dialog-meta">${esc(offer.location)}</p>` : ''}
    ${offer.eligibility ? `<p><strong>Eligible cards</strong><br>${esc(offer.eligibility)}</p>` : ''}
    ${offer.period ? `<p><strong>Offer validity</strong><br>${esc(offer.period)}</p>` : ''}
    ${bankUrl ? `<p><a href="${bankUrl}" target="_blank" rel="noopener noreferrer">View official offer and terms ↗</a></p>` : ''}
    <div class="dialog-actions">${dateControls}${detailContext ? '<button type="button" class="secondary" id="dialog-back">Back to calendar offers</button>' : ''}</div>
    ${day ? '<p id="event-help" class="calendar-help" role="status"></p>' : ''}`);
  $('dialog-back')?.addEventListener('click', () => calendarPopup(detailContext.day, detailContext.key));
  if (!day) return;
  const dateInput = $('event-date');
  const native = $('native-add');
  const google = $('google-add');
  const message = $('event-help');
  function syncCalendarLinks() {
    const date = dateInput.value;
    const kind = date && eventKind(offer, date);
    native.disabled = !kind;
    google.hidden = !kind;
    if (kind) google.href = googleCalendar(offer, date, kind, names[offer.bank]);
    message.textContent = kind ? `${kind}. Open the calendar file to review and save the event in your calendar app.` :
      'Choose a date listed for this offer.';
  }
  dateInput.addEventListener('input', syncCalendarLinks);
  native.addEventListener('click', () => {
    const kind = eventKind(offer, dateInput.value);
    if (!kind) return;
    const url = URL.createObjectURL(new Blob([calendarFile(offer, dateInput.value, kind, names[offer.bank])],
      { type: 'text/calendar;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${offer.id}.ics`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  });
  syncCalendarLinks();
}

window.addEventListener('hashchange', () => syncView(true));
$('settings-banks').addEventListener('change', event => {
  const checkbox = event.target.closest('input[data-preference]');
  if (!checkbox) return;
  const group = checkbox.dataset.preference;
  const selected = checkbox.checked === (group === 'favorites');
  if (selected) preferences[group].add(checkbox.value);
  else preferences[group].delete(checkbox.value);
  try {
    localStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(
      Object.entries(preferences).map(([key, values]) => [key, [...values]]))));
    $('settings-status').textContent = 'Your choices are saved in this browser.';
  } catch {
    $('settings-status').textContent = 'Preferences apply until you reload. Your browser could not save them.';
  }
  state.limit = 15;
  renderBanks();
  renderCategories();
});
$('banks').addEventListener('click', event => {
  const button = event.target.closest('button[data-bank]');
  if (!button) return;
  state.bank = button.dataset.bank;
  state.limit = 15;
  document.querySelectorAll('[data-bank]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  renderCategories();
  render();
});
for (const id of fields) {
  $(id).addEventListener('input', () => {
    state.limit = 15;
    render();
  });
}
$('reset').addEventListener('click', () => {
  state.bank = '';
  state.limit = 15;
  renderBanks();
  renderCategories();
  for (const id of fields) $(id).value = id === 'sort' ? 'default' : '';
  render();
  $('banks').querySelector('[data-bank=""]').focus();
});
$('more').addEventListener('click', () => {
  const firstNew = state.limit;
  state.limit += 15;
  renderOffers();
  $('offer-list').children[firstNew]?.focus();
});
$('prev').addEventListener('click', () => monthOffset(-1));
$('next').addEventListener('click', () => monthOffset(1));
$('today').addEventListener('click', () => {
  state.month = today.slice(0, 7) + '-01';
  renderCalendar();
});
$('month-grid').addEventListener('click', event => {
  const button = event.target.closest('button[data-day]');
  if (button) calendarPopup(button.dataset.day, button.dataset.category);
});
$('legend').addEventListener('click', event => {
  const button = event.target.closest('button[data-month-category]');
  if (button) calendarPopup('', button.dataset.monthCategory);
});
document.addEventListener('click', event => {
  const button = event.target.closest('button[data-offer]');
  if (!button) return;
  if (!dialog.contains(button)) detailContext = null;
  const offer = data.offers.find(item => item.id === button.dataset.offer);
  if (offer) showOffer(offer);
});
dialog.addEventListener('close', () => { detailContext = null; });
document.addEventListener('error', event => {
  if (event.target.matches?.('.offer-media img')) event.target.hidden = true;
}, true);

renderBanks();
renderCategories();
syncView();
try {
  const response = await fetch('./offers.json', { cache: 'no-cache' });
  if (!response.ok) throw new Error('Offer feed unavailable');
  data = await response.json();
  loaded = true;
  renderCategories();
  renderSettings();
  render();
  const sources = Object.entries(data.banks).map(([bank, value]) =>
    `<li><a href="${safeLink(value.source)}" target="_blank" rel="noopener noreferrer">${names[bank]}</a>
      · Updated ${esc(printDate(sriDate(value.refreshed)))}</li>`).join('');
  $('sources').innerHTML = `<ul>${sources}</ul><p>Check the bank’s terms for eligibility and exclusions.</p>`;
} catch {
  $('result-count').textContent = 'Bank offers could not be loaded. Refresh to try again.';
  $('settings-banks').textContent = 'Bank categories could not be loaded. Refresh to try again.';
}

