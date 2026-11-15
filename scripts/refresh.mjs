import { readFile, writeFile, rename } from 'node:fs/promises';
import { parseSchedule, sriDate } from '../dist/dates.js';

const output = new URL('../dist/offers.json', import.meta.url);
const sources = {
  sampath: 'https://www.sampath.lk/sampath-cards/credit-card-offer',
  boc: 'https://www.boc.lk/personal-banking/card-offers',
};
const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ndash: '–', mdash: '—', bull: '•', middot: '·', reg: '®' };
const clean = (raw = '') => String(raw ?? '').replace(/<\/?(?:p|div|li|br)\b[^>]*>/gi, ' ').replace(/<[^>]*>/g, '')
  .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (value, code) => {
    if (!code.startsWith('#')) return entities[code.toLowerCase()] ?? value;
    const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
    return point <= 0x10ffff ? String.fromCodePoint(point) : value;
  }).replace(/\s+/g, ' ').trim();

async function get(url, json = false) {
  const headers = json ? { locale: 'en', platform: 'web', accept: 'application/json' } : {};
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(25000) });
  if (!response.ok) throw new Error(`${response.status} fetching ${url}`);
  return json ? response.json() : response.text();
}

function cardTypes(text) {
  const types = [];
  if (/\bcredit\b/i.test(text)) types.push('credit');
  if (/\bdebit\b/i.test(text)) types.push('debit');
  return types;
}

function imageUrl(value, base) {
  if (!value) return '';
  const url = new URL(clean(value), base);
  return url.protocol === 'https:' ? url.href : '';
}

function discount(text) {
  return (text.match(/(?:up\s*(?:to|tp)\s*)?\d+(?:\.\d+)?\s*%/i)?.[0] ?? '').replace(/up\s*(?:to|tp)\s*/i, 'Up to ');
}

async function sampathRows(category) {
  const size = 40;
  const rows = new Map();
  for (let page = 1; page <= 30; page++) {
    const query = new URLSearchParams({ category, page_number: page, size });
    const { data, total } = await get(`https://www.sampath.lk/api/card-promotions?${query}`, true);
    if (!Array.isArray(data) || !Number.isInteger(total)) throw new Error('Sampath promotion format changed');
    if (!data.length && rows.size < total) throw new Error(`Sampath returned an incomplete ${category} listing`);
    for (const row of data) rows.set(row.id, row);
    if (rows.size >= total || !data.length) return [...rows.values()];
  }
  throw new Error(`Sampath page limit reached for ${category}`);
}

function sampathOffer(row, category) {
  const field = pattern => clean(row.cards_new?.find(item => pattern.test(item.title))?.description);
  const summary = clean(row.short_description || row.description) || clean(row.description);
  const eligibility = field(/eligible card/i) || clean(row.eligible_card_categories);
  const expiry = sriDate(row.expire_on == null ? null : Number(row.expire_on));
  const detail = clean(row.promotion_details);
  const period = field(/promotion period|validity|offer period|booking period/i) || clean(row.promotion_period) ||
    detail.match(/(?:valid (?:only )?(?:on|from|till|until)|every)\b[^.•*]+/i)?.[0]?.trim() || '';
  const schedule = parseSchedule(period, {
    listedFrom: sriDate(row.display_on == null ? null : Number(row.display_on)),
    fallbackEnd: expiry,
  });
  const restricted = /blackout|exclusion dates|excluding (?:weekends|public holidays)|except (?:on|during)/i.test(detail + ' ' + clean(row.terms_and_conditions));
  return {
    id: `sampath-${row.id}`, bank: 'sampath', category,
    name: clean(row.company_name), summary, eligibility, types: cardTypes(eligibility || clean(row.description)),
    discount: discount(clean(row.short_discount || row.discount) || summary),
    location: clean(row.city), image: imageUrl(row.image_url, sources.sampath),
    period, end: schedule.end,
    periods: restricted ? [] : schedule.periods,
    // If a restriction leaves the final eligible day uncertain, suppress the reminder.
    calendar: !restricted,
    url: `${sources.sampath}/${row.id}`,
  };
}

async function loadSampath() {
  const listing = await get('https://www.sampath.lk/api/offer-catergories', true);
  const categories = listing.filter(row => row.enable && !row.delete_status).map(row => ({ id: row.value, label: row.label }));
  if (!categories.length) throw new Error('Sampath returned no categories');
  const offers = [];
  for (let i = 0; i < categories.length; i += 3) {
    const groups = await Promise.all(categories.slice(i, i + 3).map(async ({ id }) => {
      const rows = await sampathRows(id);
      return rows.filter(row => row.enable !== false && !row.delete_status).map(row => sampathOffer(row, id));
    }));
    offers.push(...groups.flat());
  }
  return { categories, offers };
}

const bocCategories = /<h[234][^>]*>([^<]+)<\/h[234]>\s*(?:<a|<\/div>\s*<a)[^>]+href="[^"]*card-offers\/([^/"]+)"/g;
const bocCards = /<a\b[^>]*href="([^"]*\/card-offers\/([^/"]+)\/([^/"]+)\/product)"[^>]*>([\s\S]*?)<\/a>/g;

function parseBoc(html, categoryNames) {
  return [...html.matchAll(bocCards)].flatMap(([, url, category, id, body]) => {
    if (!categoryNames.has(category)) return [];
    const first = pattern => clean(body.match(pattern)?.[1]);
    const name = first(/<h4[^>]*>([\s\S]*?)<\/h4>/);
    if (!name) return [];
    const summary = first(/<div class="description">([\s\S]*?)<\/div>/);
    const expiry = first(/Expiration date\s*:\s*<\/td>\s*<td[^>]*>([^<]*)/i);
    const end = parseSchedule(expiry).end;
    const period = summary.match(/(?:valid (?:on|from)|\bevery\s+\w+day|\bon\s+(?:(?:sun|mon|tues|wednes|thurs|fri|satur)days?|\d{1,2}(?:st|nd|rd|th)\b))[^.•]*?20\d{2}\)?/i)?.[0] || '';
    const schedule = parseSchedule(period, { fallbackEnd: end });
    return [{
      id: `boc-${category}-${id}`, bank: 'boc', category, name, url: new URL(url, sources.boc).href,
      image: imageUrl(first(/<img\s+class="offer-logo"\s+src="([^"]+)"/), sources.boc),
      summary, types: cardTypes(summary), discount: discount(first(/<div class="offer">([\s\S]*?)<\/div>/) || summary),
      location: first(/<p class="location-name">([^<]*)<\/p>/),
      period: period || (expiry ? `Ends ${expiry}` : ''), end: schedule.end,
      periods: schedule.periods, calendar: true,
    }];
  });
}

async function loadBoc() {
  const html = await get(sources.boc);
  const categories = [...new Map([...html.matchAll(bocCategories)].map(([, label, id]) => [id, clean(label)]))]
    .map(([id, label]) => ({ id, label }));
  if (!categories.length) throw new Error('BOC category format changed');
  const categoryNames = new Set(categories.map(c => c.id));
  const offers = new Map(parseBoc(html, categoryNames).map(offer => [offer.id, offer]));
  for (let i = 0; i < categories.length; i += 3) {
    const pages = await Promise.all(categories.slice(i, i + 3).map(c => get(`${sources.boc}/${c.id}`)));
    for (const page of pages) for (const offer of parseBoc(page, categoryNames)) offers.set(offer.id, offer);
  }
  return { categories, offers: [...offers.values()] };
}

const previous = await readFile(output, 'utf8').then(JSON.parse).catch(error => {
  if (error.code === 'ENOENT') return { banks: {}, offers: [] };
  throw error;
});
const result = { banks: {}, offers: [] };
const jobs = { sampath: loadSampath, boc: loadBoc };
const fetched = await Promise.allSettled(Object.values(jobs).map(load => load()));
for (const [index, bank] of Object.keys(jobs).entries()) {
  const job = fetched[index];
  const offers = job.status === 'fulfilled' ? job.value.offers.filter(offer => offer.name) : [];
  if (offers.length) {
    result.banks[bank] = { source: sources[bank], categories: job.value.categories, refreshed: new Date().toISOString() };
    result.offers.push(...new Map(offers.map(offer => [offer.id, offer])).values());
    console.log(`${bank}: ${offers.length} offers across ${job.value.categories.length} categories`);
  } else {
    console.error(`${bank}: ${job.reason?.message ?? 'No offers parsed'}`);
    if (!previous.banks[bank]) process.exitCode = 1;
    else result.banks[bank] = previous.banks[bank];
    result.offers.push(...previous.offers.filter(offer => offer.bank === bank));
  }
}
if (result.offers.length) {
  const temp = new URL('offers.json.tmp', output);
  await writeFile(temp, JSON.stringify(result) + '\n');
  await rename(temp, output);
}

