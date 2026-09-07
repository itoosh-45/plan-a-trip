import { el, card } from '../ui.js';
import { openTripWizard } from '../onboarding.js';
import { runRestore } from './settings.js';

/**
 * המסך של מי שעדיין אין לו טיול. זהה בכל ארבעת המסכים, ולכן הוא יושב כאן:
 * שתי הדרכים להתחיל — לשחזר גיבוי או לפתוח טיול חדש — שוות במשקל.
 */
export function noTripCard(note) {
  return card([
    el('div', { class: 'empty-title', text: 'אין עדיין טיול' }),
    el('div', { class: 'dim', text: note }),
    el('div', { class: 'empty-actions' }, [
      el('button', { class: 'btn btn-tertiary', text: 'העלאת גיבוי', onClick: () => runRestore() }),
      el('button', { class: 'btn btn-tertiary', text: 'יצירת טיול חדש', onClick: () => openTripWizard(null) }),
    ]),
  ], 'card-gap empty-no-trip');
}
