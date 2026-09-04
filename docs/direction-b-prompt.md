# פרומפט יישום — כיוון ב׳ (שקט משמעותית)

מקור: קנבס הכיוונים https://claude.ai/code/artifact/719f8461-afd8-41c3-8ce3-ed753d5b9a39
הפרומפט למטה מיועד להדבקה ב-Claude Code בתוך `C:\Users\USER\PLAN A TRIP`.

---

<context>
פרויקט: PWA לתכנון טיול ותקציב. Vanilla JS + ES modules, בלי בילד ובלי פריימוורק.
עברית, `dir="rtl"`, גופן Noto Sans Hebrew מוטמע מקומית ב-`fonts/` (variable, משקלים 100–900).
קבצי עיצוב: `css/tokens.css` (טוקנים בלבד) ו-`css/app.css` (כל הכללים).
כל גודל טקסט באפליקציה מגיע מטוקן ב-`tokens.css` — זו מוסכמה קיימת שיש לשמור עליה.
מסכים: `js/screens/prep.js`, `plan.js`, `expenses.js`, `summary.js`, `settings.js`.
המצב הנוכחי: העיצוב תקין פונקציונלית אבל רועש — כמעט כל טקסט במשקל 600–700,
שני צבעי מותג רוויים (טורקיז ‎#06BCC1‎ וורוד ‎#EE4266‎) מופיעים כמילויים גדולים זה לצד זה,
ושורת משימה ברשימת ההכנה נושאת את הדחיפות שלוש פעמים במקביל (רקע מגוון, טבעת מגוונת, ומילה מגוונת מודגשת).
</context>

<task>
יישם כיוון עיצובי בשם "כיוון ב׳ — שקט משמעותית" על האפליקציה.
העבודה היא כמעט כולה CSS: החלפת ערכי טוקנים ב-`css/tokens.css` ועדכון כללים ב-`css/app.css`.
נדרשים בדיוק שני שינויים קטנים בקבצי JS, והם מפורטים במפורש למטה. שום שינוי JS אחר.
</task>

<hard_constraints>
אלה חוקים מוחלטים. הפרה של אחד מהם פוסלת את העבודה.

1. אסור לשנות תוכן. שום מחרוזת עברית, תווית, כותרת, הודעת שגיאה או טקסט כפתור לא משתנה, לא נמחק ולא נוסף.
2. אסור לשנות פונקציונליות. אין הוספה, הסרה או שינוי של פיצ׳רים, מסכים, כפתורים, שדות, אירועים או זרימות.
3. אסור לשנות מבנה DOM. אין הוספה או הסרה של אלמנטים ב-`js/screens/*.js` או ב-`js/ui.js`, פרט לשתי הוספות המחלקה המפורטות ב-<js_changes>.
4. אסור לגעת בסכמת הנתונים, ב-`js/db.js`, ב-`js/migrate.js`, ב-`sw.js`, ב-`manifest.json` או ב-`index.html`.
5. אסור להוסיף תלויות, קבצי CSS חדשים, גופנים חדשים או קריאות רשת. הגופן נשאר Noto Sans Hebrew המוטמע ב-`fonts/`.
6. אסור להוריד נגישות: `--touch-min` נשאר 44px, `--text-base` נשאר 16px (16px בשדות קלט מונע זום אוטומטי ב-iOS), ו-`prefers-reduced-motion` נשמר.
7. אסור להשתמש במשקל 700 בשום מקום באפליקציה אחרי השינוי. המשקלים המותרים הם 400, 500 ו-600 בלבד.
</hard_constraints>

<design_direction>
העיקרון של כיוון ב׳: הכרטיס מפסיק להיות קופסה ומתחיל להיות **רשימה מקובצת**.
במקום מסגרת + צל + רדיוס 16 סביב כל בלוק, יש משטח לבן על רקע אפור בהיר,
כותרת מקטע קטנה שיושבת **מחוץ** לקבוצה, ושורות שמופרדות בקו שיער אחד.

שלושה כללים שמנחים כל החלטה:
- **נושא צבע אחד לכל מידע.** לדחיפות מותר אות ויזואלי אחד בלבד, לא שלושה.
- **מילוי רווי אחד לכל מסך.** הוורוד ‎#EE4266‎ נשמר אך ורק ל-`.btn-primary`. הטורקיז מפסיק להיות מילוי והופך לצבע טקסט ולמילוי דק בלבד.
- **המספר גדול, לא הכפתור.** מה שגדול במסך הוא הנתון, לא הפעולה.
</design_direction>

<step_1_tokens>
ערוך את `css/tokens.css`. שנה את הערכים הבאים בבלוק `:root`. השאר את כל השאר כפי שהוא,
כולל בלוקי `@font-face` ו-`--font-app` — הגופן לא משתנה.

טיפוגרפיה:
```
--text-2xl: 24px   →  28px      /* מספר גדול בכרטיס סיכום; המשקל שלו יורד ל-500 בשלב 2 */
--text-lg:  18px   →  17px      /* כותרת מסך */
--text-base:16px   →  16px      /* לא נוגעים: 16px מונע זום אוטומטי ב-iOS */
--text-sm:  14px   →  14px      /* לא נוגעים: שם של פריט בשורה */
--text-xs:  12px   →  12px      /* לא נוגעים */
--text-11:  11px   →  11px      /* לא נוגעים */
```
הוסף טוקן חדש אחד מתחת ל-`--text-11`:
```
--text-body: 13px;   /* גוף הטקסט. היה 14px וירד ל-13px — זה מה שמוריד את "הגדול מדי" */
```

מרווח אותיות:
```
--tracking-body: -0.01em  →  -0.005em    /* ב-13px כיווץ אגרסיבי פוגע בקריאות של עברית */
--tracking-head: -0.02em  →  -0.02em     /* לא נוגעים */
```
הוסף טוקן חדש:
```
--tracking-num: -0.03em;   /* מספרים גדולים בלבד */
```

צבעים — הפלטה השקטה. הטורקיז והצבעים הסמנטיים עוברים ל-oklch כדי לרדת ברוויה
בלי לשנות גוון, כך שהם נשארים מזוהים אבל מפסיקים לצעוק:
```
--color-bg:        #FCFCFC            →  #F4F5F7    /* הרקע נהיה אפור מובחן, כדי שהמשטח הלבן יופרד בלי מסגרת */
--color-surface:   #FFFFFF            →  #FFFFFF    /* לא נוגעים */
--color-surface-2: #F2F4F6            →  #EAECEF
--color-input:     #F5F7F8            →  #FFFFFF    /* שדה לבן על רקע אפור קורא כשקע, ולא צריך מסגרת חזקה */
--color-text:      #000000            →  #16191D    /* שחור מוחלט מוסיף קשיות; כמעט-שחור מרכך בלי לפגוע בניגודיות */
--color-text-dim:  #5A6672            →  #737C86
--color-accent:    #06BCC1            →  oklch(0.60 0.075 195)
--color-highlight: #EE4266            →  #EE4266    /* לא נוגעים. זה המילוי הרווי היחיד שנשאר */
--color-border:    rgba(0,0,0,0.10)   →  rgba(0,0,0,0.08)
--color-hairline:  rgba(0,0,0,0.06)   →  rgba(0,0,0,0.055)

--color-danger:    #D92D20            →  oklch(0.55 0.14 27)
--color-success:   #0E9F6E            →  oklch(0.62 0.09 160)
--color-warning:   #D97706            →  oklch(0.63 0.11 68)
```
הוסף שלושה טוקנים חדשים:
```
--color-text-mute: #9BA3AC;      /* מטא-דאטה, מונים, תוויות משניות. שכבה שלישית מתחת ל-dim */
--color-control-line: #CDD3D9;   /* מסגרת של פקד לא-פעיל, למשל עיגול סימון שלא סומן */
--color-accent-press: oklch(0.52 0.075 195);
```

הדחיפות ממשיכה להיגזר מהצבעים הסמנטיים — אל תיגע בבלוק הזה, הוא יתעדכן מעצמו:
```
--urgency-critical: var(--color-danger);
--urgency-important: var(--color-warning);
--urgency-normal: var(--color-accent);
```
אותו דבר לגבי `--gradient-trip`: הוא נגזר מ-`--color-accent` ויתעמעם אוטומטית. אל תיגע בו.

צורה:
```
--radius-card:    16px  →  12px
--radius-control: 12px  →  10px
```

צללים — הצל יורד מכרטיסים ונשאר רק למה שבאמת מרחף:
```
--shadow-stamp:  השאר את הערך כפי שהוא (הוא כבר לא ישמש כרטיסים)
```
הוסף טוקן חדש:
```
--shadow-float: 0 1px 2px rgba(16,24,40,0.05), 0 10px 24px -8px rgba(16,24,40,0.14);
```

מרווחים:
```
--space-screen-x:      16px  →  18px
--space-card-p:        16px  →  14px
--space-card-gap:      12px  →  22px   /* קבוצות מופרדות במרווח, לא במסגרת */
--space-screen-bottom: 24px  →  24px   /* לא נוגעים; הרווח ל-FAB נפתר בשלב 2 */
--nav-height:          64px  →  58px
--touch-min:           44px  →  44px   /* לא נוגעים: נגישות */
--date-row-width:      75vw  →  75vw   /* לא נוגעים */
```
</step_1_tokens>

<step_2_css>
ערוך את `css/app.css`. לכל בלוק למטה: מצא את הכלל הקיים ועדכן רק את המאפיינים המצוינים.
אל תשכתב את הקובץ ואל תשנה מאפיין שלא מופיע כאן.

**בסיס**
```css
html, body {
  font-size: var(--text-body);   /* היה var(--text-sm) */
  line-height: 1.5;              /* היה 1.45 */
}
```
הוסף כלל גלובלי אחד חדש מיד אחריו. הפונקציה `icon()` ב-`js/ui.js` מייצרת SVG עם
`stroke-width="1.8"` כתכונת מצגת, ו-CSS גובר עליה — זו הדרך להרזות את כל האייקונים
בלי לגעת ב-JS:
```css
svg { stroke-width: 1.5; }
```

**טיפוגרפיה**
```css
.screen-title  { font-size: var(--text-lg); font-weight: 600; margin: 0 0 10px; }   /* היה 700 */
.card-title    { font-size: 13px; font-weight: 600; color: var(--color-text);
                 letter-spacing: -0.01em; margin: 0 0 8px; }
                 /* היה 12px/700 בצבע dim. בכיוון ב׳ כותרת המקטע כהה ויושבת מחוץ לקבוצה */
.row-title     { font-weight: 500; }    /* היה 600 */
.empty-title   { font-weight: 600; }    /* היה 700 */
.dim           { font-weight: 400; }    /* היה 500 */
.sub           { color: var(--color-text-mute); font-weight: 400; }   /* היה dim/500 */
.stat-value    { font-weight: 500; letter-spacing: var(--tracking-num); }   /* היה 700 */
.money         { font-weight: 500; }    /* היה 700 */
.money-lg      { font-weight: 500; letter-spacing: var(--tracking-num); }   /* היה 700 */
.pill          { font-weight: 500; }    /* היה 700 */
.zone-label,
.cat-head      { font-weight: 500; color: var(--color-text-mute); }   /* היה 700/dim */
```

**כרטיס — הופך לקבוצה**
```css
.card {
  border: 0;            /* היה 1px solid var(--color-border) */
  box-shadow: none;     /* היה var(--shadow-stamp) */
}
```
`background`, `border-radius` ו-`padding` נשארים כפי שהם — הם כבר קוראים מהטוקנים החדשים.

**כפתורים — מילוי רווי אחד**
```css
.btn { font-weight: 500; }   /* היה 700 */

.btn-secondary {
  background: color-mix(in srgb, var(--color-accent) 10%, transparent);
  color: var(--color-accent);
  border-color: transparent;
}
/* היה מילוי טורקיז מלא עם טקסט לבן. זה מה שהתחרה בוורוד בכרטיס הארנק. */
```
`.btn-primary` (ורוד מלא), `.btn-tertiary` ו-`.btn-danger` נשארים כפי שהם.

**שדות**
```css
.field-label { font-size: var(--text-xs); font-weight: 400; }   /* היה text-sm/500 */
```

**צ׳יפים — גלולה שקטה**
המחלקה `.chip` משותפת לארבעה מקומות: מסנן דחיפות (`js/screens/prep.js:413`),
מסנן יעדים (`js/screens/expenses.js:198`), בורר אייקון בהגדרות (`js/screens/settings.js:330`)
ושורת קטלוג ברוחב מלא (`js/screens/prep.js:246`). לכן היא לא הופכת לטאב עם קו תחתון —
היא הופכת לגלולה חסרת מסגרת, שעובדת בכל ארבעת המקומות:
```css
.chip {
  min-height: 34px;                    /* היה 36px */
  padding: 5px 12px;                   /* היה 6px 12px */
  border-radius: 999px;                /* היה var(--radius-control) */
  border: 0;                           /* היה 1px solid var(--color-border) */
  background: var(--color-surface-2);  /* היה var(--color-surface) */
  color: var(--color-text-dim);
  font-size: var(--text-body);         /* היה var(--text-sm) */
  font-weight: 400;                    /* היה 500 */
}
.chip.wrap { border-radius: var(--radius-control); }   /* שורת קטלוג ברוחב מלא לא יכולה להיות גלולה */
.chip[aria-pressed="true"] {
  background: var(--color-text);
  border-color: transparent;
  color: var(--color-surface);
  font-weight: 500;
}
/* היה: רקע טורקיז שקוף + מסגרת טורקיז + טקסט טורקיז. הצ׳יפ הנבחר עכשיו כהה ונייטרלי,
   וזה משחרר את הטורקיז לשמש רק כצבע פעולה. */
```

**סרגל התקדמות**
```css
.bar { height: 3px; }   /* היה 8px */
```

**ניווט תחתון**
```css
#nav { border-block-start: 1px solid var(--color-hairline); }   /* היה --color-border */
#nav button {
  gap: 3px;                          /* היה 2px */
  font-weight: 400;                  /* היה 500 */
  color: var(--color-text-mute);     /* היה dim */
}
#nav button[aria-current="page"] {
  color: var(--color-text);   /* היה var(--color-accent) */
  font-weight: 500;           /* היה 700 */
}
/* הפריט הפעיל מסומן בכהות ובמשקל, לא בצבע. זה מוריד את שתי כתמי הטורקיז
   הגדולים ביותר במסך (הפריט הפעיל בניווט) בלי לפגוע בבהירות של "איפה אני". */
```

**שורת משימה — השינוי המרכזי**
כיום השורה נושאת את הדחיפות שלוש פעמים: רקע `color-mix` בצבע הדחיפות, טבעת 2px
בצבע הדחיפות, ומילה מודגשת בצבע הדחיפות. בכיוון ב׳ נשאר נושא אחד — הטבעת, דקה ומעומעמת.
```css
.task {
  align-items: center;                 /* היה flex-start */
  gap: 12px;                           /* היה 10px */
  padding: 12px var(--space-card-p);   /* היה 10px 12px */
  margin-block-start: 0;               /* היה 8px */
  border: 0;                           /* היה 1px solid var(--color-border) */
  border-radius: 0;                    /* היה var(--radius-control) */
  background: var(--color-surface);    /* היה color-mix בצבע הדחיפות — זה הרקע הצבעוני שיורד */
}
.task + .task { box-shadow: inset 0 1px 0 var(--color-hairline); }
```
כדי שהשורות יגעו בקצה הקבוצה במקום לרחף בתוך ריפוד הכרטיס:
```css
.drop-zone { margin-inline: calc(var(--space-card-p) * -1); }
```
עיגול הסימון:
```css
.tick {
  width: 21px;              /* היה 28px */
  height: 21px;             /* היה 28px */
  border-width: 1.5px;      /* היה 2px */
  box-sizing: border-box;   /* חדש: שומר על 21px חיצוניים */
  margin-block-start: 0;    /* היה 2px; מיותר אחרי align-items: center */
  border-color: var(--color-control-line);   /* חדש: לא מסומן = אפור נייטרלי */
}
.task[data-urgency="critical"] .tick,
.task[data-urgency="important"] .tick { border-color: var(--urgency); }
/* רק קריטי וחשוב נושאים צבע. "רגיל" נשאר אפור — זה מה שהופך את הצבע לאות ולא לרעש. */
.tick svg { width: 13px; height: 13px; stroke-width: 2.6; }
```
פסאודו-האלמנט `.tick::after { inset: -8px }` שומר על אזור מגע 44px — אל תיגע בו,
הוא כבר מכסה גם עיגול של 21px.

המילה "קריטי"/"חשוב"/"רגיל" **נשארת בשורה** (חוק 1: אין שינוי תוכן), אבל מפסיקה להיות
נושאת צבע ומודגשת:
```css
.urgency-tag { color: var(--color-text-mute); font-weight: 400; }
/* היה: var(--urgency) במשקל 700 */
```
ידית הגרירה:
```css
.task .grip { color: var(--color-control-line); }
```

**כותרת קבוצה וקטגוריה**
```css
.zone-label::after,
.cat-head::after { background: var(--color-hairline); }   /* היה --color-border */
```

**הדר עליון**
בורר הטיול הוא `<select class="field">`. הוא נשאר `select` — הבורר הנייטיבי לא משתנה —
אבל מפסיק להיראות כמו שדה טופס:
```css
.topbar-row .field {
  background: transparent;               /* היה var(--color-input) */
  border: 0;                             /* היה 1px solid var(--color-border) */
  padding-inline: 0;
  font-size: var(--text-lg);             /* היה var(--text-base) */
  font-weight: 600;                      /* היה 600 — ללא שינוי */
  letter-spacing: var(--tracking-head);
}
```

**כרטיס טיול (מסך "טיולים")**
```css
.trip-card { border: 0; box-shadow: none; }
.trip-card-head h3 { font-weight: 500; letter-spacing: var(--tracking-num); }   /* היה 700 */
.trip-card-head .dates { font-weight: 400; opacity: 0.78; }                     /* היה 500/0.82 */
.trip-card-currency { font-weight: 500; }                                       /* היה 600 */
.trip-card-body .total { font-weight: 500; letter-spacing: var(--tracking-num); } /* היה 700 */
```

**מרחפים — כאן הצל נשאר**
```css
.toast { border: 0; box-shadow: var(--shadow-float); font-weight: 400; }   /* היה מסגרת + shadow-stamp + 500 */
.fab   { box-shadow: var(--shadow-float); }
.sheet-title { font-weight: 600; }   /* היה 700 */
```

**רווח ל-FAB**
ה-FAB מרחף מעל השורה האחרונה במסך ההוצאות, כי ל-`#screen` יש רק 24px ריפוד תחתון.
הוא מתווסף כילד של `#screen` (`js/screens/expenses.js:258`), ולכן `:has()` פותר את זה
בשורה אחת בלי JS ובלי לגזול מקום במסכים שאין בהם FAB:
```css
#screen:has(.fab) { padding-block-end: 96px; }
```
</step_2_css>

<js_changes>
בדיוק שני שינויים, שניהם הוספת מחלקה קיימת. אין שינוי טקסט, מבנה או לוגיקה.
אם אינך מצליח לבצע אחד מהם בלי לשנות משהו נוסף — דלג עליו ודווח.

1. `js/screens/prep.js:411` — למכולת מסנן הדחיפות יש `class: 'card-gap'` עם סגנון inline.
   הוסף לרשימת המחלקות שם נוסף בלבד, למשל `'card-gap filter-row'`, בלי לגעת ב-`style`.
   זה נותן וו CSS למקרה שתרצי בעתיד להפוך את המסננים לטאבים. לא נדרש CSS נוסף עכשיו.

2. אין שינוי JS שני. אם התכוונת לשנות עוד קובץ JS — עצור ושאל.
</js_changes>

<forbidden_actions>
- אל תריץ `npm install`, אל תוסיף `package.json` ואל תוסיף כלי בנייה.
- אל תמחק קבצים.
- אל תיגע ב-`sw.js`, `manifest.json`, `index.html`, `js/db.js`, `js/migrate.js`, `data/`, `vendor/`, `tests/`.
- אל תבצע commit או push. השאר את השינויים ב-working tree.
- אל "תשפר" דברים שלא נמצאים ברשימה למעלה. אם משהו נראה לך שבור — כתוב אותו בדוח הסיום ואל תתקן.
- עצור ושאל לפני: מחיקת קובץ, הוספת תלות, שינוי סכמת נתונים, או כל שינוי ב-JS מעבר ל-<js_changes>.
</forbidden_actions>

<verification>
אחרי היישום, הרץ את הבדיקות האלה ודווח על התוצאה בפועל. אל תטען שמשהו עובד בלי להריץ אותו.

1. חפש משקל 700 שנשאר:
   `grep -rn "font-weight: *700\|font-weight:700" css/`
   התוצאה חייבת להיות ריקה.

2. חפש צבעים קשיחים שדולפים מחוץ לטוקנים:
   `grep -rn "#06BCC1\|#5A6672\|#FCFCFC" css/app.css js/`
   מותר רק ב-`js/trips.js` (`DEFAULT_CATEGORIES` — צבעי קטגוריה, שהם נתונים ולא עיצוב).

3. הפעל את שרת הפיתוח והסתכל על האפליקציה ברוחב 375px, על ארבעת המסכים.
   הרץ אותו דרך הכלים של סביבת התצוגה, לא דרך `Bash`, והשתמש ב-`.claude/launch.json` הקיים.
   שים לב במיוחד לרשימת ההכנה, שבה השינוי הכי גדול.

4. אמת את ארבעת אלה בפועל, בדפדפן:
   - שורות המשימה לבנות, בלי רקע צבעוני, ומופרדות בקו שיער אחד.
   - ה-FAB במסך ההוצאות אינו מכסה אף שורה בגלילה עד הסוף.
   - הפריט הפעיל בניווט התחתון כהה, לא טורקיז.
   - עיגול הסימון עדיין נלחץ בקלות (אזור מגע 44px) — לחץ עליו ובדוק שהמשימה מסומנת.

5. אין שגיאות ב-console.
</verification>

<output_contract>
בסיום החזר בדיוק את זה, בלי הקדמה ובלי סיכום ארוך:
1. רשימת הקבצים ששונו, עם מספר השורות שהשתנו בכל אחד.
2. תוצאת שתי פקודות ה-grep, מודבקת כפי שהיא.
3. צילום מסך אחד של רשימת ההכנה ברוחב 375px.
4. רשימה של כל דבר שדילגת עליו או שלא הצלחת לבצע, ולמה.
</output_contract>

---

## הערה על סטייה מהמוקאפ

בקנבס, כיוון ב׳ הראה את הדחיפות כנקודה בקוטר 6px, את המילה "קריטי" מוסרת מהשורה,
ואת המסננים כטאבים עם קו תחתון. שלושת אלה שונו בפרומפט הזה בכוונה:

- **הנקודה הוחלפה בטבעת דקה ומעומעמת.** הוספת נקודה דורשת שינוי DOM ב-`taskRow()`,
  והטבעת כבר קיימת — שינוי הצבע והעובי שלה משיג את אותה שקיטה בלי לגעת ב-JS.
- **המילה "קריטי" נשארת**, כי הסרתה היא שינוי תוכן. במקום זאת היא מאבדת את הצבע ואת ההדגשה.
  אם בהמשך תרצי את הגרסה השקטה לגמרי — מוחקים את ה-`span` בשורה `js/screens/prep.js:198`.
- **הצ׳יפים נשארים גלולות ולא טאבים**, כי `.chip` משותפת גם לבורר האייקונים בהגדרות
  ולשורות הקטלוג, וקו תחתון היה שובר אותן.
