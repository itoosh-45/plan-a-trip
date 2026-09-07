import { el, icon, toast, fmtDateRange, sheet } from './ui.js';
import { listTrips, tripDates } from './trips.js';
import * as migrate from './migrate.js';
import * as rates from './rates.js';
import * as cur from './currencies.js';
import * as backup from './backup.js';

// חמישה טאבים. התוויות קצרות בכוונה — ברוחב טלפון תווית בת שתי מילים
// נשברת לשתי שורות ומעוותת את גובה הסרגל.
const SCREENS = [
  { key: 'prep',     label: 'הכנה',   iconName: 'check' },
  { key: 'plan',     label: 'תכנון',  iconName: 'plan' },
  { key: 'expenses', label: 'הוצאות', iconName: 'expenses' },
  { key: 'summary',  label: 'סיכום',  iconName: 'summary' },
  { key: 'settings', label: 'הגדרות', iconName: 'settings' },
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

  // סמל זהות, לא פקד: ההגדרות עברו לטאב התחתון ואין לו לאן לנווט.
  const logo = el('img', { class: 'topbar-logo', src: './icons/icon-192.png', alt: '' });

  if (!all.length) {
    activeTrip = null;
    return el('div', { class: 'topbar-row' }, [
      el('div', { class: 'grow row-title', text: 'תכנון טיול ותקציב' }),
      logo,
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
    el('div', { class: 'topbar-row' }, [select, logo]),
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

/** רענון שערים יומי, שקט לגמרי. כישלון אינו מפריע לאפליקציה לעלות. */
async function autoRefreshRates() {
  try {
    const res = await rates.autoRefresh(await cur.listActive());
    if (res.saved) refresh();
  } catch { /* אין רשת או שהשירות נפל — ננסה שוב בטעינה הבאה */ }
}

/** תזכורת עדינה כל כמה שבועות לגבות לקובץ. רק אם יש מה לגבות. */
async function maybeRemindBackup() {
  if (!(await listTrips()).length) return;
  if (!(await backup.dueForReminder())) return;

  const s = sheet({
    title: 'לגבות את הטיולים?',
    body: el('p', { class: 'dim',
      text: 'עברו כמה שבועות מאז הגיבוי האחרון. אפשר לגבות עכשיו לקובץ, או להידחות.' }),
    actions: [
      el('button', { class: 'btn btn-tertiary btn-block', text: 'תזכיר לי מאוחר יותר',
        onClick: async () => { await backup.markBackedUp(); s.close(); } }),
      el('button', { class: 'btn btn-primary btn-block', text: 'גבה עכשיו', onClick: async () => {
        s.close();
        try {
          const res = await backup.toFile();
          await backup.markBackedUp();
          if (res.method === 'share') toast('הגיבוי נשלח לשיתוף', 'success');
          else if (res.method === 'download') toast('קובץ הגיבוי הורד', 'success');
        } catch (err) { toast(err.message, 'error'); }
      } }),
    ],
  });
}

export async function boot() {
  buildNav();
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  try { activeTrip = localStorage.getItem('activeTripId') || null; } catch { activeTrip = null; }
  const report = await migrate.run();
  await migrate.recolorCategories();
  await migrate.dropLegacyGearTasks();
  if (!report.skipped && report.trips) toast('הנתונים הקיימים הותאמו למבנה החדש', 'success');
  document.addEventListener('data:changed', () => refresh());
  window.addEventListener('online',  () => { toast('חזרנו לרשת', 'success'); autoRefreshRates(); });
  window.addEventListener('offline', () => toast('אין רשת. האפליקציה ממשיכה לעבוד.', 'warning'));
  await refresh();
  autoRefreshRates();
  maybeRemindBackup();
}
