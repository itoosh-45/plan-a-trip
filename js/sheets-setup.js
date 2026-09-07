import { el, sheet, toast } from './ui.js';
import * as sheets from './sheets.js';
import { refresh } from './app.js';

/**
 * אשף החיבור לגוגל שיטס. שבעה מסכים, אחד בכל פעם.
 *
 * הנוסח כאן מניח שמי שקורא אותו לא יודע מה זה סקריפט ולא פתח מעולם עורך
 * קוד, ולכן כל לחיצה מפורטת ולכל שלב יש משפט "הצלחת אם" — אדם שנתקע בלי
 * לדעת אם התקדם, מוותר.
 */

const STEPS = 7;

const p = text => el('p', { style: 'margin:0 0 10px', text });
const note = text => el('p', { class: 'sub', style: 'margin:0 0 10px', text });

function list(items) {
  return el('ol', { class: 'wizard-list' }, items.map(t =>
    el('li', typeof t === 'string' ? { text: t } : {}, typeof t === 'string' ? [] : [t])));
}

/** "הצלחת אם" — הסימן שאפשר להתקדם. בלעדיו אין דרך לדעת שהשלב עבד. */
function done(text) {
  return el('p', { class: 'wizard-done', text: `הצלחת אם: ${text}` });
}

function warn(text) {
  return el('p', { class: 'wizard-warn', text });
}

export function openSheetsWizard() {
  let step = 0;
  const body = el('div');
  const actions = el('div', { style: 'display:flex; gap:8px; width:100%' });
  const s = sheet({ title: 'חיבור לגוגל שיטס', body, actions: [actions] });

  const appAddress = `${location.origin}${location.pathname}`.replace(/index\.html$/, '');

  // ---- שלב 0: למה צריך מחשב ----
  const intro = () => [
    warn('את השלבים האלה אפשר לעשות רק ממחשב.'),
    p('לא מהטלפון ולא מטאבלט — התפריטים שצריך פשוט לא קיימים באפליקציית Google Sheets בנייד. אחרי שמסיימים פעם אחת במחשב, הכול עובד מהטלפון לבד ולא נוגעים בזה יותר.'),
    note('מה שצריך: חשבון גוגל, ובערך חמש דקות.'),
    el('div', { class: 'wizard-tip' }, [
      el('div', { class: 'row-title', style: 'margin-block-end:4px', text: 'טיפ שיחסוך לך חצי מהעבודה' }),
      el('div', { class: 'sub', text: 'פתח את האפליקציה גם במחשב, באותה כתובת, ותוכל להעתיק ממנה את הקוד ישירות במקום לשלוח אותו לעצמך:' }),
      el('div', { class: 'wizard-code', style: 'margin-block-start:6px', text: appAddress }),
    ]),
  ];

  // ---- שלב 1 ----
  const step1 = () => [
    p('במחשב, פתח דפדפן וכתוב בשורת הכתובת:'),
    el('div', { class: 'wizard-code', text: 'sheets.new' }),
    note('בדיוק כך, בלי www ובלי נקודה בסוף. אם אתה מחובר לגוגל ייפתח גיליון ריק חדש. אם לא — גוגל תבקש ממך להתחבר קודם.'),
    p('אפשר לתת לגיליון שם, למשל "גיבוי טיולים". זה לא חובה.'),
    done('יש מולך טבלה ריקה בדפדפן.'),
  ];

  // ---- שלב 2 ----
  const step2 = () => [
    p('בתפריט העליון של הגיליון לחץ על Extensions (בעברית: תוספים), ואז על Apps Script.'),
    p('תיפתח לשונית חדשה בדפדפן עם מסך שנראה שונה לגמרי — שורות קוד על רקע בהיר או כהה. זה נורמלי. הגיליון שלך לא נעלם, הוא פשוט בלשונית השנייה.'),
    done('נפתחה לשונית חדשה, ובאמצע המסך כתוב משהו כמו function myFunction() {'),
  ];

  // ---- שלב 3 ----
  function step3() {
    const code = el('textarea', {
      class: 'field wizard-source', readonly: 'readonly', rows: '6', spellcheck: 'false',
    });
    code.value = sheets.SCRIPT_SOURCE;

    const copy = el('button', {
      class: 'btn btn-secondary btn-block', text: 'העתק את הקוד',
      onClick: async () => {
        try {
          await navigator.clipboard.writeText(sheets.SCRIPT_SOURCE);
          toast('הקוד הועתק', 'success');
        } catch {
          code.select();
          toast('סמן את הקוד והעתק אותו ידנית', 'warning');
        }
      },
    });

    const share = el('button', {
      class: 'btn btn-tertiary btn-block', text: 'שלח את הקוד לעצמי',
      onClick: async () => {
        try { await navigator.share({ text: sheets.SCRIPT_SOURCE, title: 'קוד לגיבוי טיולים' }); }
        catch { toast('השיתוף בוטל', 'warning'); }
      },
    });

    return [
      p('בחלון הקוד שנפתח:'),
      list([
        'לחץ עם העכבר בתוך אזור הקוד.',
        'לחץ Ctrl + A (במק: Cmd + A). כל הקוד ייצבע בכחול.',
        'לחץ Delete. האזור יתרוקן.',
        'הבא את הקוד שלמטה אל המחשב, ולחץ Ctrl + V (במק: Cmd + V) בתוך האזור הריק.',
        'לחץ על סמל הדיסקט למעלה כדי לשמור.',
      ]),
      note(`אם פתחת את האפליקציה גם במחשב (${appAddress}) — הקוד כאן, מתחת, ואפשר להעתיק אותו ישר. אחרת שלח אותו לעצמך בוואטסאפ ופתח את ההודעה במחשב.`),
      code,
      el('div', { style: 'display:flex; gap:8px; margin-block-start:8px' }, [copy, share]),
      done('האזור מלא בקוד החדש, ולא מופיעה יותר נקודה כתומה שמסמנת שינוי לא שמור.'),
    ];
  }

  // ---- שלב 4 ----
  const step4 = () => [
    p('למעלה מימין לחץ על הכפתור הכחול Deploy, ואז על New deployment.'),
    p('בחלון שנפתח:'),
    list([
      'ליד המילה Select type יש סמל גלגל שיניים. לחץ עליו ובחר Web app.',
      'בשדה Execute as ודא שכתוב Me, עם כתובת המייל שלך.',
      'בשדה Who has access פתח את הרשימה ובחר Anyone.',
      'לחץ Deploy.',
    ]),
    warn('בלי Anyone בשלב 3, האפליקציה בטלפון לא תוכל להגיע לגיליון. זו הטעות הנפוצה ביותר כאן.'),
  ];

  // ---- שלב 5 ----
  const step5 = () => [
    warn('עכשיו יופיע מסך מפחיד. הוא תקין — אל תיבהל.'),
    p('גוגל תבקש הרשאה, ובדרך תציג מסך שכתוב בו "Google hasn’t verified this app" ואולי גם המילה unsafe.'),
    p('ה"אפליקציה" שגוגל מזהירה ממנה היא הקוד שאתה בעצמך הרגע הדבקת, שיושב בגיליון שלך, ומבקש רשות לכתוב לגיליון שלך. הוא לא שייך לאף אחד אחר ולא שולח שום דבר לאף אחד. גוגל מציגה את האזהרה הזו לכל קוד אישי, כי המסלול שמסיר אותה הוא אימות מסחרי שאיש לא עובר בשביל גיליון פרטי.'),
    p('מה לעשות:'),
    list([
      'לחץ Review permissions או Continue.',
      'בחר את חשבון הגוגל שלך.',
      'במסך האזהרה לחץ למטה על Advanced (בעברית: מתקדם).',
      'תיפתח שורה קטנה: Go to ... (unsafe). לחץ עליה.',
      'במסך האחרון לחץ Allow (בעברית: אישור).',
    ]),
    done('המסכים נסגרו וחזרת לחלון של גוגל עם כותרת בסגנון Deployment successfully updated.'),
  ];

  // ---- שלב 6 ----
  const step6 = () => [
    p('בחלון שנפתח יש שני דברים שנראים דומים. שים לב איזה מהם:'),
    el('div', { class: 'wizard-pick bad' }, [
      el('div', { class: 'row-title', text: 'Deployment ID' }),
      el('div', { class: 'sub', text: 'שורת אותיות. לא זה.' }),
    ]),
    el('div', { class: 'wizard-pick good' }, [
      el('div', { class: 'row-title', text: 'Web app ← URL' }),
      el('div', { class: 'sub', text: 'כתובת ארוכה שמתחילה ב-https://script.google.com/macros/s/ ונגמרת ב-/exec. זו הכתובת.' }),
    ]),
    p('לידה יש כפתור Copy. לחץ עליו.'),
    done('הכתובת שהעתקת נגמרת ב-/exec'),
    note('אם היא נגמרת ב-/dev — זו כתובת פנימית שעובדת רק במחשב שלך וכשאתה מחובר לגוגל. חזור וקח את זו שנגמרת ב-/exec.'),
  ];

  // ---- שלב 7 ----
  function step7() {
    const url = el('input', {
      class: 'field', type: 'url', dir: 'ltr', inputmode: 'url', spellcheck: 'false',
      placeholder: 'https://script.google.com/macros/s/.../exec',
    });
    const err = el('p', { class: 'wizard-warn', hidden: true });

    const test = el('button', {
      class: 'btn btn-primary btn-block', text: 'בדוק חיבור',
      onClick: async () => {
        err.hidden = true;
        test.disabled = true;
        test.textContent = 'בודק…';
        try {
          await sheets.connect(url.value);
          toast('הגיליון מחובר. הגיבוי יתעדכן מעכשיו לבד.', 'success');
          s.close();
          sheets.syncNow();
          refresh();
        } catch (e) {
          err.textContent = e.message;
          err.hidden = false;
        } finally {
          test.disabled = false;
          test.textContent = 'בדוק חיבור';
        }
      },
    });

    return [
      p('שלח לעצמך את הכתובת מהמחשב — בוואטסאפ למספר שלך, במייל, מה שנוח — פתח את ההודעה בטלפון, והעתק אותה לכאן.'),
      url,
      el('div', { style: 'margin-block-start:8px' }, [test]),
      err,
      note('אחרי שהחיבור עובד, הגיבוי קורה לבד בכל פתיחה ויציאה מהאפליקציה. אין מה לעשות יותר.'),
      el('p', { class: 'sub hairline', style: 'margin-block-start:14px; padding-block-start:12px',
        text: 'שמור על הכתובת. מי שמקבל אותה יכול לדרוס את תוכן הגיליון — לא לקרוא ממנו — ולכן אין לפרסם אותה.' }),
    ];
  }

  const RENDER = [intro, step1, step2, step3, step4, step5, step6, step7];

  function render() {
    body.replaceChildren();
    actions.replaceChildren();

    if (step > 0) {
      body.append(el('div', { class: 'sub', style: 'margin-block-end:8px',
        text: `שלב ${step} מתוך ${STEPS}` }));
      body.append(el('div', { class: 'wizard-reminder', text: 'השלב הזה נעשה במחשב' }));
    }
    body.append(...RENDER[step]());

    if (step > 0) {
      actions.append(el('button', {
        class: 'btn btn-tertiary', text: 'הקודם', onClick: () => { step--; render(); },
      }));
    }
    if (step < STEPS) {
      actions.append(el('button', {
        class: 'btn btn-primary btn-block', text: step === 0 ? 'הבנתי, בוא נתחיל' : 'הבא',
        onClick: () => { step++; render(); },
      }));
    }
  }

  render();
  return s;
}
