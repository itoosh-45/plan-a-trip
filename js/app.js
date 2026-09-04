import { el, icon, toast, fmtDateRange } from './ui.js';
import { listTrips, tripDates } from './trips.js';
import * as migrate from './migrate.js';

const SCREENS = [
  { key: 'prep',     label: 'רשימת הכנה', iconName: 'check' },
  { key: 'plan',     label: 'תכנון',      iconName: 'plan' },
  { key: 'expenses', label: 'הוצאות',     iconName: 'expenses' },
  { key: 'summary',  label: 'סיכום',      iconName: 'summary' },
];

const mounts = new Map();
let current = 'prep';
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

  const settingsBtn = el('button', {
    class: 'icon-btn',
    'aria-label': 'הגדרות',
    html: icon('settings'),
    onClick: () => navigate('settings'),
  });

  if (!all.length) {
    activeTrip = null;
    return el('div', { class: 'topbar-row' }, [
      el('div', { class: 'grow row-title', text: 'תכנון טיול ותקציב' }),
      settingsBtn,
    ]);
  }

  if (!activeTrip || !all.some(t => t.id === activeTrip)) {
    activeTrip = all[0].id;
    try { localStorage.setItem('activeTripId', activeTrip); } catch { /* מצב פרטי */ }
  }

  const { startDate, endDate } = await tripDates(activeTrip);
  const select = el('select', {
    class: 'field',
    'aria-label': 'בחירת הטיול הפעיל',
    onChange: e => setActiveTrip(e.target.value),
  }, all.map(t => el('option', { value: t.id, selected: t.id === activeTrip, text: t.name })));

  return el('div', {}, [
    el('div', { class: 'topbar-row' }, [select, settingsBtn]),
    startDate
      ? el('div', { class: 'dim', style: 'margin-block-start:6px',
          text: fmtDateRange(startDate, endDate) })
      : el('div', { class: 'dim', style: 'margin-block-start:6px',
          text: 'טרם הוגדרו תאריכים לטיול' }),
  ]);
}

// יצירת טיול משדרת כמה אירועי data:changed ברצף, ולכל אחד מאזין שקורא ל-refresh.
// בלי "רק הרינדור האחרון קובע", שני רינדורים חופפים היו מכפילים את התוכן על המסך.
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
  const report = await migrate.run();
  if (!report.skipped && report.trips) toast('הנתונים הקיימים הותאמו למבנה החדש', 'success');
  document.addEventListener('data:changed', () => refresh());
  window.addEventListener('online',  () => toast('חזרנו לרשת', 'success'));
  window.addEventListener('offline', () => toast('אין רשת. האפליקציה ממשיכה לעבוד.', 'warning'));
  await refresh();
}
