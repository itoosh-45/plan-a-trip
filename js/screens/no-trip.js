import { el, card } from '../ui.js';
import { openTripWizard } from '../onboarding.js';
import { runRestore } from './settings.js';

/**
 * המסך של מי שעדיין אין לו טיול, ותוכן ההיכרות עם האפליקציה.
 *
 * שני הדברים יושבים יחד כי הם אותה שאלה — "מה זה, ואיך מתחילים". הנקודות
 * מוגדרות פעם אחת ומוצגות בשני מקומות: במסך שנפתח ראשון לפני שיש טיול,
 * ובהגדרות, למי שרוצה לחזור אליהן אחרי שכבר יצר אחד.
 */

export const INTRO_LEAD = 'כל מה שקשור לטיול אחד במקום אחד — מהרשימה הראשונה שאורזים לפיה ועד ההוצאה האחרונה. הכול נשמר על המכשיר שלך ועובד גם בלי אינטרנט.';

const POINTS = [
  ['רשימת הכנה', 'קטלוג של 613 פריטים בחמישה שלבים: לפני, בדרך, בשהות, בחזרה וציוד מיוחד. אפשר גם לייבא רשימה משלך מאקסל.'],
  ['מסלול ויעדים', 'כל יעד עם התאריכים שלו, ומתחתיו הטיסות, הלינות והאטרקציות שתכננת.'],
  ['תקציב', 'תקרה לכל הטיול, והקצאה נפרדת לכל יעד. רואים תמיד כמה נשאר.'],
  ['הוצאות בכל מטבע', 'כל הוצאה נשמרת בשער של היום שבו היא יצאה, ולכן הסיכום לא משתנה למפרע. כולל ארנק מזומן ומשיכות מכספומט.'],
  ['סיכום', 'פילוח לפי קטגוריה ולפי יעד, מול התקציב שהצבת.'],
  ['גיבוי', 'לקובץ בלחיצה אחת, או לגיליון גוגל שמתעדכן מעצמו.'],
];

export function introPoints() {
  return el('ul', { class: 'intro-points' }, POINTS.map(([term, text]) =>
    el('li', {}, [el('b', { text: term }), ' — ', text])));
}

/**
 * `intro` נדלק רק במסך שנפתח ראשון. בשאר המסכים אותו הסבר בדיוק היה חוזר
 * על עצמו ארבע פעמים, ולכן שם נשאר המשפט הקצר שמכוון למסך שבו עומדים.
 */
export function noTripCard(note, { intro = false } = {}) {
  return card([
    el('div', { class: 'empty-title', text: intro ? 'תכנון טיול ותקציב' : 'אין עדיין טיול' }),
    el('div', { class: 'dim', text: intro ? INTRO_LEAD : note }),
    intro ? introPoints() : null,
    intro ? el('div', { class: 'dim', style: 'margin-block-start:14px', text: 'כדי להתחיל צריך טיול:' }) : null,
    el('div', { class: 'empty-actions' }, [
      el('button', { class: 'btn btn-tertiary', text: 'העלאת גיבוי', onClick: () => runRestore() }),
      el('button', { class: 'btn btn-tertiary', text: 'יצירת טיול חדש', onClick: () => openTripWizard(null) }),
    ]),
  ], 'card-gap empty-no-trip');
}
