import { el, icon, toast, fmtDateRange } from './ui.js';
import { listTrips, tripDates, TRIP_STATUS } from './trips.js';

const SCREENS = [
  { key: 'plan',     label: 'תכנון',   iconName: 'plan' },
  { key: 'budget',   label: 'תקציב',   iconName: 'budget' },
  { key: 'expenses', label: 'הוצאות',  iconName: 'expenses' },
  { key: 'summary',  label: 'סיכום',   iconName: 'summary' },
  { key: 'settings', label: 'הגדרות',  iconName: 'settings' },
];

const mounts = new Map();
let current = 'plan';
let activeTrip = null;

export function registerScreen(key, mountFn) { mounts.set(key, mountFn); }
export function activeTripId() { return activeTrip; }

export function setActiveTrip(id) {
  activeTrip = id;
  try { localStorage.setItem('activeTripId', id ?? ''); } catch { /* מצב פרטי */ }
  refresh();
}

export function navigate(key) {
  current = key;
  for (const b of document.querySelectorAll('#nav button')) {
    b.setAttribute('aria-current', b.dataset.key === key ? 'page' : 'false');
  }
  refresh();
}

async function buildTopbar() {
  const all = await listTrips();

  if (!all.length) {
    activeTrip = null;
    return el('div', { class: 'card', style: 'margin:12px 16px' }, [
      el('div', { style: 'font-weight:700', text: 'אין עדיין טיול' }),
      el('div', { class: 'dim', style: 'margin-block-start:4px', text: 'צרו טיול ראשון במסך ההגדרות.' }),
    ]);
  }

  if (!activeTrip || !all.some(t => t.id === activeTrip)) {
    activeTrip = all[0].id;
    try { localStorage.setItem('activeTripId', activeTrip); } catch { /* מצב פרטי */ }
  }

  const trip = all.find(t => t.id === activeTrip);
  const { startDate, endDate } = await tripDates(trip.id);
  const select = el('select', {
    class: 'field',
    'aria-label': 'בחירת הטיול הפעיל',
    style: 'font-weight:700',
    onChange: e => setActiveTrip(e.target.value),
  }, all.map(t => el('option', { value: t.id, selected: t.id === activeTrip, text: t.name })));

  return el('div', { style: 'padding:12px 16px 0' }, [
    select,
    el('div', {
      class: 'dim',
      style: 'margin-block-start:6px; font-size:14px',
      text: startDate
        ? `${TRIP_STATUS[trip.status]} · ${fmtDateRange(startDate, endDate)}`
        : `${TRIP_STATUS[trip.status]} · טרם הוגדרו מקטעים`,
    }),
  ]);
}

// יצירת טיול משדרת כמה אירועי data:changed ברצף (put הטיול + bulkPut הקטגוריות),
// ולכל אחד יש מאזין שקורא ל-refresh. בלי שמירת "רק הרינדור האחרון קובע", שני
// רינדורים חופפים היו שניהם נספחים ל-host ומכפילים את התוכן על המסך.
let renderId = 0;

export async function refresh() {
  const myId = ++renderId;
  const topbarNode = await buildTopbar();

  const frag = document.createDocumentFragment();
  const mount = mounts.get(current);
  if (!mount) {
    frag.append(el('div', { class: 'card card-gap dim', text: 'המסך הזה עוד לא נבנה.' }));
  } else {
    try {
      await mount(frag, activeTrip);
    } catch (err) {
      frag.append(el('div', { class: 'card card-gap' }, [
        el('div', { class: 'toast error', text: `שגיאה בטעינת המסך: ${err.message}` }),
      ]));
    }
  }

  if (myId !== renderId) return; // התבטל על ידי רינדור מאוחר יותר
  document.getElementById('topbar').replaceChildren(topbarNode);
  document.getElementById('screen').replaceChildren(...frag.childNodes);
}

function buildNav() {
  const nav = document.getElementById('nav');
  nav.replaceChildren(...SCREENS.map(s =>
    el('button', {
      'data-key': s.key,
      'aria-current': s.key === current ? 'page' : 'false',
      onClick: () => navigate(s.key),
    }, [
      el('span', { html: icon(s.iconName) }),
      el('span', { text: s.label }),
    ])
  ));
}

export async function boot() {
  buildNav();
  try { activeTrip = localStorage.getItem('activeTripId') || null; } catch { activeTrip = null; }
  document.addEventListener('data:changed', () => refresh());
  window.addEventListener('online',  () => toast('חזרנו לרשת', 'success'));
  window.addEventListener('offline', () => toast('אין רשת. האפליקציה ממשיכה לעבוד.', 'warning'));
  await refresh();
}
