import * as db from './db.js';
import { listTrips } from './trips.js';
import { el } from './ui.js';
import { openTripWizard } from './onboarding.js';
import { runRestore } from './screens/settings.js';

const SEEN_KEY = 'welcomeSeen';
const APP_PARTS = ['topbar', 'screen', 'nav'];

function setAppInert(on) {
  for (const id of APP_PARTS) {
    const node = document.getElementById(id);
    if (node) node.inert = on;
  }
}

export function openWelcome() {
  // הגדרות מאפשרות לפתוח את המסך שוב; לחיצה כפולה לא יוצרת שני dialogs.
  const existing = document.querySelector('.welcome');
  if (existing) return { close: () => existing.querySelector('[data-close]')?.click() };

  const root = el('div', {
    class: 'welcome', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'ברוכים הבאים',
  });
  const title = el('h1', { class: 'welcome-title', tabindex: '-1', text: 'הטיול שלך, במקום אחד' });
  const close = (next) => {
    root.remove();
    setAppInert(false);
    document.removeEventListener('keydown', onKey);
    // פתיחת בורר הקבצים חייבת להישאר ישירות בתוך אירוע הלחיצה.
    if (next) next();
    db.setSetting(SEEN_KEY, true).catch(() => {});
  };
  function onKey(event) {
    if (event.key === 'Escape') { event.preventDefault(); close(); }
  }

  root.append(el('div', { class: 'welcome-body welcome-center' }, [
    title,
    el('p', { class: 'welcome-text', text: 'תכנון ימים, רשימת הכנה והוצאות — כל מה שצריך לטיול אחד במקום אחד.' }),
    el('div', { class: 'welcome-actions' }, [
      el('button', { class: 'btn btn-primary btn-block', text: 'יצירת טיול',
        onClick: () => close(() => openTripWizard(null)) }),
      el('button', { class: 'btn btn-tertiary btn-block', text: 'שחזור מגיבוי',
        onClick: () => close(runRestore) }),
    ]),
    el('p', { class: 'welcome-storage', text: 'הנתונים נשמרים במכשיר ועובדים גם בלי אינטרנט.' }),
    el('button', { class: 'welcome-dismiss', 'data-close': '', text: 'אחר כך',
      onClick: () => close() }),
  ]));

  document.body.append(root);
  setAppInert(true);
  document.addEventListener('keydown', onKey);
  title.focus({ preventScroll: true });
  return { close: () => close() };
}

export async function maybeOpenWelcome() {
  try {
    if (await db.getSetting(SEEN_KEY)) return false;
    if ((await listTrips()).length) return false;
  } catch {
    return false;
  }
  openWelcome();
  return true;
}
