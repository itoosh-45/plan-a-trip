import * as db from './db.js';
import { listTrips } from './trips.js';
import { el, icon } from './ui.js';
import { openTripWizard } from './onboarding.js';

/**
 * מסכי הפתיחה של כניסה ראשונה.
 *
 * זה אינו האשף של js/onboarding.js — שם נוצר טיול, כאן רק מסבירים מה
 * האפליקציה עושה. הרצף נפתח פעם אחת בחיי המכשיר, ומי שרוצה לראות אותו שוב
 * מוזמן אליו מההגדרות.
 *
 * כל הטקסט יושב ב-SLIDES ורק שם. הנוסח של no-trip.js (INTRO_LEAD ו-POINTS)
 * הוא טקסט אחר, שנכתב למסך אחר, ובמכוון אינו מאוחד עם זה.
 */

const SEEN_KEY = 'welcomeSeen';

/** יחס הצדדים של כל צילום נמדד מהקובץ עצמו, כדי שהמסגרת תשמור לו מקום מדויק. */
const SLIDES = [
  {
    id: 'welcome',
    center: true,
    title: 'ברוכים הבאים',
    lead: 'כל מה שצריך לטיול שלכם, במקום אחד.',
    body: [
      'תכננו את המסלול, התארגנו לקראת הנסיעה, נהלו את הימים ועקבו אחרי ההוצאות — הכול במקום אחד.',
      'הנתונים נשמרים במכשיר שלכם, כך שתוכלו להשתמש באפליקציה גם בלי חיבור לאינטרנט.',
    ],
  },
  {
    id: 'trip',
    title: 'צרו את הטיול שלכם',
    body: [
      'התחילו עם שם הטיול ובחרו תאריכים ומטבע.',
      'אפשר להוסיף או לשנות את היעדים, התאריכים והתקציב בכל שלב.',
    ],
    shots: [
      { id: 'wizard-step1', ratio: '390 / 476', alt: 'שלב ראשון באשף: שם הטיול ולוח בחירת התאריכים שלו' },
      { id: 'date-range', ratio: '390 / 476', alt: 'לוח התאריכים עם טווח מסומן מ-8 עד 22 בפברואר, וסיכום של 15 ימים' },
    ],
  },
  {
    id: 'prep',
    title: 'כל מה שצריך להכין',
    body: [
      'סמנו את הדברים שצריך לעשות לפני הטיול, במהלכו ואחריו.',
      'בחרו מתוך רשימת משימות מוכנה או הוסיפו משימות משלכם.',
      'סדרו את המשימות לפי רמת חשיבות כדי לדעת במה להתמקד קודם.',
    ],
    shots: [
      { id: 'catalog-pick', ratio: '390 / 476', alt: 'רשימת המשימות המוכנה, עם שלושה פריטים שסומנו להוספה לרשימת ההכנה' },
      { id: 'prep-list', ratio: '390 / 476', alt: 'רשימת ההכנה: סינון לפי חשיבות, ומשימות מסומנות קריטי וחשוב' },
    ],
  },
  {
    id: 'plan',
    title: 'תכננו את הימים שלכם',
    body: [
      'ארגנו את הטיול לפי יעדים ותאריכים.',
      'הוסיפו טיסות, לינות, אטרקציות ומעברים — וכל דבר יופיע ביום המתאים במסלול.',
      'כך תוכלו לראות גם את התמונה המלאה וגם את התכנון של כל יום.',
    ],
    shots: [
      { id: 'plan-days', ratio: '390 / 476', alt: 'רשימת הימים, ובכל יום הטיסות, הלינות והאטרקציות שתוכננו בו' },
      { id: 'plan-segments', ratio: '390 / 476', alt: 'תקציב הטיול, ומתחתיו שני היעדים — כל אחד עם טווח התאריכים שלו' },
    ],
  },
  {
    id: 'money',
    title: 'עקבו אחרי התקציב וההוצאות',
    body: [
      'קבעו תקציב לטיול וחלקו אותו בין היעדים והקטגוריות.',
      'הוסיפו את ההוצאות שלכם ותמיד תדעו כמה הוצאתם וכמה נשאר.',
      'אפשר לנהל הוצאות במטבעות שונים ולעקוב גם אחרי מזומן ומשיכות.',
    ],
    shots: [
      { id: 'expense-add', ratio: '390 / 476', alt: 'הזנת הוצאה בשקלים בטיול שמתנהל בבאט, עם ההמרה לפי השער השמור' },
      { id: 'summary-budget', ratio: '390 / 476', alt: 'מסך הסיכום: סך ההוצאות מול התקרה, מזומן בארנק ופילוח לפי קטגוריה' },
    ],
  },
  {
    id: 'settings',
    title: 'עוד אפשרויות שמחכות לכם',
    features: [
      ['download', 'גיבוי ושחזור', 'שמרו גיבוי של כל הנתונים ושחזרו אותו בכל זמן.'],
      ['cash', 'מטבעות ושערי חליפין', 'בחרו את המטבעות שלכם והשתמשו בשערים אוטומטיים או ידניים.'],
      ['refresh', 'סנכרון עם Google Sheets', 'חברו את הגיליון שלכם וסנכרנו את הנתונים.'],
      ['edit', 'קטגוריות מותאמות אישית', 'צרו וערכו קטגוריות שמתאימות בדיוק לטיול שלכם.'],
    ],
  },
];

/** הרקע הופך למוסתר מהנגישות ומהמקלדת כל עוד הרצף פתוח. */
const APP_PARTS = ['topbar', 'screen', 'nav'];

function setAppInert(on) {
  for (const id of APP_PARTS) {
    const node = document.getElementById(id);
    if (node) node.inert = on;
  }
}

/**
 * צילום מסך בתוך מסגרת ביחס צדדים קבוע, כדי שהפריסה לא תזוז בזמן הטעינה.
 * קובץ חסר אינו משאיר חור: המסגרת נעלמת והטקסט נשאר כמו שהוא.
 */
function shotNode(shot, eager) {
  const frame = el('div', { class: 'welcome-shot', style: `aspect-ratio:${shot.ratio}` });
  const img = el('img', {
    src: `./img/welcome/${shot.id}.webp`,
    alt: shot.alt,
    loading: eager ? 'eager' : 'lazy',
    decoding: 'async',
    onError: () => frame.remove(),
  });
  frame.append(img);
  return frame;
}

function featureNode([iconName, term, text]) {
  return el('li', { class: 'welcome-feature' }, [
    el('span', { class: 'welcome-feature-icon', html: icon(iconName) }),
    el('div', {}, [
      el('div', { class: 'welcome-feature-term', text: term }),
      el('div', { class: 'welcome-text', text }),
    ]),
  ]);
}

export function openWelcome() {
  let index = 0;

  const head = el('div', { class: 'welcome-head' });
  const body = el('div', { class: 'welcome-body' });
  const foot = el('div', { class: 'welcome-foot' });
  const root = el('div', {
    class: 'welcome', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'ברוכים הבאים',
  }, [head, body, foot]);

  const finish = async (then = null) => {
    root.remove();
    setAppInert(false);
    document.removeEventListener('keydown', onKey);
    // הדגל נכתב ביציאה, לא בפתיחה: מי שסגר את הכרטיסייה באמצע יראה את הרצף שוב.
    try { await db.setSetting(SEEN_KEY, true); } catch { /* אחסון חסום — לא שובר את הסגירה */ }
    if (then) then();
  };

  const go = step => {
    index = Math.min(SLIDES.length - 1, Math.max(0, index + step));
    render();
  };

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); finish(); }
    else if (e.key === 'ArrowLeft') go(1);    // בעברית ההתקדמות היא שמאלה
    else if (e.key === 'ArrowRight') go(-1);
  }

  // החלקה: אצבע שנעה ימינה דוחפת את התוכן שמאלה, כלומר קדימה.
  let startX = null;
  body.addEventListener('touchstart', e => { startX = e.touches[0].clientX; }, { passive: true });
  body.addEventListener('touchend', e => {
    if (startX === null) return;
    const dx = e.changedTouches[0].clientX - startX;
    startX = null;
    if (Math.abs(dx) > 50) go(dx > 0 ? 1 : -1);
  });

  function render() {
    const slide = SLIDES[index];
    const last = index === SLIDES.length - 1;

    head.replaceChildren(
      last
        ? el('span', { class: 'welcome-skip-slot' })
        : el('button', { class: 'btn btn-tertiary welcome-skip', text: 'דלג', onClick: () => finish() }),
      el('div', {
        class: 'welcome-dots', role: 'img',
        'aria-label': `מסך ${index + 1} מתוך ${SLIDES.length}`,
      }, SLIDES.map((_, i) => el('span', {
        class: 'welcome-dot', 'aria-hidden': 'true', 'data-on': i === index ? '' : null,
      }))),
      el('span', { class: 'welcome-skip-slot' }),
    );

    const title = el('h1', { class: 'welcome-title', tabindex: '-1', text: slide.title });
    // replaceChildren אינו מדלג על null כמו el(), ולכן הרשימה מסוננת כאן
    body.replaceChildren(...[
      title,
      slide.lead ? el('p', { class: 'welcome-lead', text: slide.lead }) : null,
      ...(slide.body || []).map(text => el('p', { class: 'welcome-text', text })),
      slide.features
        ? el('ul', { class: 'welcome-features' }, slide.features.map(featureNode))
        : null,
      ...(slide.shots || []).map((shot, i) => shotNode(shot, index <= 1 && i === 0)),
    ].filter(Boolean));
    body.classList.toggle('welcome-center', Boolean(slide.center));
    body.scrollTop = 0;
    title.focus({ preventScroll: true });

    foot.replaceChildren(
      index > 0
        ? el('button', { class: 'btn btn-tertiary', text: 'הקודם', onClick: () => go(-1) })
        : el('span'),
      last
        ? el('div', { class: 'welcome-foot-end' }, [
            el('button', { class: 'btn btn-tertiary', text: 'אחר כך', onClick: () => finish() }),
            el('button', {
              class: 'btn btn-primary', text: 'צרו את הטיול שלכם',
              onClick: () => finish(() => openTripWizard(null)),
            }),
          ])
        : el('button', {
            class: 'btn btn-secondary welcome-next', text: 'הבא ←', onClick: () => go(1),
          }),
    );
  }

  render();
  document.addEventListener('keydown', onKey);
  document.body.append(root);
  setAppInert(true);
  return { close: () => finish() };
}

/**
 * הפתיחה האוטומטית. מי שכבר יש לו טיול במכשיר — בין שיצר אותו ובין ששיחזר
 * אותו מגיבוי — אינו צריך היכרות, ולכן שתי הבדיקות ולא אחת.
 */
export async function maybeOpenWelcome() {
  try {
    if (await db.getSetting(SEEN_KEY)) return false;
    if ((await listTrips()).length) return false;
  } catch {
    return false;   // אחסון שלא נפתח אינו סיבה לחסום את האפליקציה
  }
  openWelcome();
  return true;
}
