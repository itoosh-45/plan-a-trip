import * as trips from '../trips.js';
import * as it from '../itinerary.js';
import * as prep from '../prep.js';
import * as money from '../money.js';
import * as rates from '../rates.js';
import * as cur from '../currencies.js';
import {
  el, card, sheet, toast, confirmDanger, icon, amountField, ilsText, ilsNote, ilsPairNote,
  fmtMoney, fmtMoneyHtml, fmtDate, fmtDateRange, fmtDayLabel, fmtWeekday, fmtMonth, fmtDays,
  nightsBetween,
} from '../ui.js';
import { refresh, holdRefresh, releaseRefresh } from '../app.js';
import { noTripCard } from './no-trip.js';

let openSegmentId = null;   // רק בתצוגת "לפי יעדים": היעד שנכנסו אליו

const typeOf = key => it.ITEM_TYPES.find(t => t.key === key) || it.ITEM_TYPES.at(-1);

function row(label, node) {
  return el('div', { class: 'field-row' }, [el('label', { class: 'field-label', text: label }), node]);
}

function dateRange(from, to, { min, max } = {}) {
  const start = el('input', { class: 'field', type: 'date', value: from || '', min, max, 'aria-label': 'מתאריך' });
  const end = el('input', { class: 'field', type: 'date', value: to || '', min, max, 'aria-label': 'עד תאריך' });
  return { node: el('div', { class: 'date-row field-row' }, [start, end]), start, end };
}

// ---------- העדפות התצוגה ----------

/**
 * תצוגה, קיבוץ ומה שמקופל — העדפות של מכשיר ולא נתוני טיול, ולכן הן יושבות
 * ב-localStorage ולא במסד: הן לא נכנסות לגיבוי ולא לייצוא. מצב פרטי חוסם
 * את האחסון, ואז המסך פשוט נפתח מלא ובברירות המחדל.
 */
const GROUPINGS = Object.keys(it.GROUPINGS);
const prefsKey = tripId => `plan:${tripId}`;

function readPrefs(tripId) {
  let raw = {};
  try { raw = JSON.parse(localStorage.getItem(prefsKey(tripId)) || '{}') || {}; } catch { raw = {}; }
  return {
    view: raw.view === 'segments' ? 'segments' : 'days',
    grouping: GROUPINGS.includes(raw.grouping) ? raw.grouping : 'days',
    collapsed: new Set(Array.isArray(raw.collapsed) ? raw.collapsed : []),
  };
}

function savePrefs(tripId, prefs) {
  try {
    localStorage.setItem(prefsKey(tripId), JSON.stringify({
      view: prefs.view, grouping: prefs.grouping, collapsed: [...prefs.collapsed],
    }));
  } catch { /* מצב פרטי — ההעדפה פשוט לא נשמרת */ }
}

/**
 * מפתח קיפול נושא את התאריך שממנו הקבוצה או היום מתחילים. תאריך שכבר אינו
 * בטיול (התאריכים שונו) נשמט, אבל מפתח של מצב קיבוץ אחר נשאר וממתין לחזרה.
 */
function prunePrefs(tripId, prefs, days) {
  const valid = new Set(days);
  const before = prefs.collapsed.size;
  for (const key of [...prefs.collapsed]) {
    const [kind, date] = [key.slice(0, 1), key.slice(2)];
    if ((kind === 'g' || kind === 'd') && !valid.has(date)) prefs.collapsed.delete(key);
  }
  if (prefs.collapsed.size !== before) savePrefs(tripId, prefs);
}

function toggleKey(ctx, key) {
  const { collapsed } = ctx.prefs;
  if (collapsed.has(key)) collapsed.delete(key); else collapsed.add(key);
  savePrefs(ctx.trip.id, ctx.prefs);
  refresh();
}

// ---------- יעד ----------

/**
 * מוודא שטווח הטיול מכיל את תאריכי היעד. אם לא — שואל אם להאריך את הטיול,
 * ומאריך אותו. מחזיר את הטיול שאיתו אפשר להמשיך, או null אם המשתמש ביטל.
 * מיוצא כי אשף יצירת הטיול מוסיף יעדים באותה הדרך בדיוק.
 */
export async function ensureTripCovers(trip, startDate, endDate) {
  const over = it.rangeOverflow(trip, startDate, endDate);
  if (!over) return trip;

  const wants = [
    over.startDate ? `להקדים את תחילתו ל-${fmtDate(over.startDate)}` : null,
    over.endDate ? `להאריך אותו עד ${fmtDate(over.endDate)}` : null,
  ].filter(Boolean).join(' ו');

  const ok = await confirmDanger({
    title: 'תאריכים מחוץ לטווח הטיול',
    body: `הטיול מוגדר ${fmtDateRange(trip.startDate, trip.endDate)}. ${wants}?`,
    confirmLabel: 'עדכן את הטיול',
    confirmClass: 'btn-primary',
  });
  if (!ok) return null;

  return trips.updateTrip({
    ...trip,
    startDate: over.startDate || trip.startDate,
    endDate: over.endDate || trip.endDate,
  });
}

function openSegmentSheet(trip, existing, prefill = { startDate: '', endDate: '' }) {
  const city = el('input', { class: 'field', type: 'text', value: existing?.city || '' });
  const country = el('input', { class: 'field', type: 'text', value: existing?.country || '' });
  // בלי min/max: חריגה מטווח הטיול היא מקרה לגיטימי שנפתר בחלון ההארכה,
  // ולא משהו שהדפדפן צריך לחסום לפני שהמשתמש בכלל הספיק לבקש.
  const range = dateRange(
    existing?.startDate ?? prefill.startDate,
    existing?.endDate ?? prefill.endDate,
  );
  const allocation = el('input', {
    class: 'field', type: 'number', inputmode: 'decimal', step: '1', value: existing?.allocation || '',
  });

  const s = sheet({
    title: existing ? 'עריכת יעד' : 'יעד חדש',
    body: el('div', {}, [
      row('שם היעד', city),
      row('מדינה', country),
      el('label', { class: 'field-label', style: 'margin-block-start:12px', text: 'טווח התאריכים ביעד' }),
      range.node,
      row(`הקצאת תקציב (${cur.symbol(trip.currency)})`, allocation),
      el('p', { class: 'sub',
        text: 'תאריכים שחורגים מטווח הטיול יציעו להאריך אותו. חפיפה ליעד אחר אינה אפשרית.' }),
    ]),
    actions: [
      existing && existing.kind !== 'general'
        ? el('button', { class: 'btn btn-danger btn-block', text: 'מחק יעד', onClick: async () => {
            const ok = await confirmDanger({
              title: `למחוק את ${existing.city}?`,
              body: 'הפריטים, ההוצאות והמשימות שלו יעברו למקטע "כללי" ולא יימחקו.',
              confirmLabel: 'מחק יעד',
            });
            if (!ok) return;
            await it.removeSegment(trip.id, existing.id);
            openSegmentId = null;
            toast('היעד נמחק', 'success');
            s.close();
            refresh();
          } })
        : el('button', { class: 'btn btn-tertiary btn-block', text: 'ביטול', onClick: () => s.close() }),
      el('button', { class: 'btn btn-primary btn-block', text: 'שמור', onClick: async () => {
        try {
          const covering = await ensureTripCovers(trip, range.start.value, range.end.value);
          if (!covering) return;
          await it.saveSegment(trip.id, {
            ...existing,
            city: city.value, country: country.value,
            startDate: range.start.value, endDate: range.end.value,
            allocation: Number(allocation.value) || 0,
            currency: existing?.currency || trip.currency,
          });
          toast('היעד נשמר', 'success');
          s.close();
          refresh();
        } catch (err) { toast(err.message, 'error'); }
      } }),
    ],
  });
}

// ---------- פריט מסלול ----------

/** היעד שאליו שייך פריט נגזר מהתאריך שלו. אין תאריך בתוך יעד — הפריט "כללי". */
function segmentIdFor(ctx, date) {
  return it.segmentForDate(ctx.segs, date)?.id ?? ctx.generalId;
}

async function openItemSheet(ctx, date, existing, bounds = {}) {
  const { trip } = ctx;
  const cats = await trips.categories(trip.id);
  const currencies = await cur.listActive();

  const type = el('select', { class: 'field' }, it.ITEM_TYPES.map(t =>
    el('option', { value: t.key, selected: (existing?.type || 'attraction') === t.key, text: t.label })));
  const title = el('input', { class: 'field', type: 'text', value: existing?.title || '' });
  const dateF = el('input', {
    class: 'field', type: 'date', value: existing?.date || date,
    min: bounds.min || undefined, max: bounds.max || undefined,
  });
  const time = el('input', { class: 'field', type: 'time', value: existing?.time || '' });
  const place = el('input', { class: 'field', type: 'text', value: existing?.place || '' });
  const ref = el('input', {
    class: 'field', type: 'text', value: existing?.ref || '', placeholder: 'מספר הזמנה או קישור',
  });
  const note = el('input', { class: 'field', type: 'text', value: existing?.note || '' });
  const category = el('select', { class: 'field' }, [
    el('option', { value: '', text: 'ללא קטגוריה' }),
    ...cats.map(c => el('option', { value: c.id, selected: existing?.categoryId === c.id, text: c.name })),
  ]);
  const planned = amountField({
    amount: existing?.plannedAmount, currency: existing?.currency || trip.currency, currencies,
  });

  const s = sheet({
    title: existing ? 'עריכת פריט' : 'פריט חדש',
    body: el('div', {}, [
      row('סוג', type), row('כותרת', title), row('תאריך', dateF), row('שעה', time),
      row('מיקום', place), row('הזמנה או קישור', ref), row('קטגוריה', category),
      row('עלות מתוכננת', planned.node), row('הערות', note),
      el('p', { class: 'sub',
        text: 'עלות היא רשות. כסף שיצא בפועל נרשם בטאב "הוצאות".' }),
    ]),
    actions: [
      existing
        ? el('button', { class: 'btn btn-danger btn-block', text: 'מחק', onClick: async () => {
            const ok = await confirmDanger({ title: 'למחוק את הפריט?', body: existing.title, confirmLabel: 'מחק' });
            if (!ok) return;
            await it.removeItem(trip.id, existing.id);
            s.close();
            refresh();
          } })
        : el('button', { class: 'btn btn-tertiary btn-block', text: 'ביטול', onClick: () => s.close() }),
      el('button', { class: 'btn btn-primary btn-block', text: 'שמור', onClick: async () => {
        try {
          const amount = planned.read();
          const stamped = existing?.rateToILS ? {} : await rates.stamp(amount.currency);
          await it.saveItem(trip.id, {
            ...existing,
            segmentId: segmentIdFor(ctx, dateF.value),
            type: type.value,
            title: title.value,
            date: dateF.value,
            time: time.value || undefined,
            place: place.value || undefined,
            ref: ref.value || undefined,
            note: note.value || undefined,
            categoryId: category.value || undefined,
            plannedAmount: amount.amount,
            currency: amount.currency,
            ...stamped,
          });
          toast('הפריט נשמר', 'success');
          s.close();
          refresh();
        } catch (err) { toast(err.message, 'error'); }
      } }),
    ],
  });
}

// ---------- שורת פריט ביום ----------

/**
 * רשימת היום היא רשימת משימות: כותרת, סימון "בוצע", ופרטים רק אם הוזנו.
 * סכום מופיע כאן רק כשמישהו טרח להזין אותו בטופס המפורט, ולצדו השווי
 * בשקלים — לפי השער שנצרב על הפריט, ובלעדיו לפי השער הנוכחי של המטבע.
 */
function itemRow(ctx, date, item, bounds) {
  const type = typeOf(item.type);
  const currency = item.currency || ctx.trip.currency;
  const ils = ilsText(item.plannedAmount, currency, item.rateToILS || ctx.fx[currency]);
  const details = [
    item.type && item.type !== 'other' ? type.label : null,
    item.time || null,
    item.place || null,
    item.note || null,
  ].filter(Boolean).join(' · ');

  return el('div', {
    class: `task ${item.done ? 'done' : ''}`.trim(), 'data-id': item.id,
  }, [
    el('button', {
      class: 'tick', 'aria-pressed': String(!!item.done),
      'aria-label': item.done ? `בטל סימון של ${item.title}` : `סמן שבוצע: ${item.title}`,
      html: icon('check'),
      onClick: async () => {
        try { await it.toggleItemDone(ctx.trip.id, item.id); } catch (err) { toast(err.message, 'error'); }
      },
    }),
    el('button', {
      class: 'title', 'aria-label': `ערוך את ${item.title}`,
      onClick: () => openItemSheet(ctx, date, item, bounds),
    }, [
      el('div', { text: item.title }),
      details || item.plannedAmount
        ? el('div', { class: 'sub' }, [
            details ? el('span', { text: details }) : null,
            item.plannedAmount
              ? el('span', { class: 'num',
                  html: `${details ? ' · ' : ''}${fmtMoneyHtml(item.plannedAmount, currency)}` })
              : null,
            ils ? el('span', { class: 'num', text: ` · ${ils}` }) : null,
          ])
        : null,
    ]),
  ]);
}

/**
 * ההזנה החופשית. פותחת תיבת טקסט בתוך היום עצמו: Enter שומר ומשאיר את
 * התיבה פתוחה למשימה הבאה, "סיים" או Esc סוגרים. כל עוד התיבה פתוחה
 * הרינדור מוחזק — אחרת כל שמירה הייתה בונה את המסך מחדש וגונבת את הפוקוס.
 */
function addRow(ctx, date, list, bounds) {
  const node = el('div', { class: 'day-add' });

  const showButtons = () => node.replaceChildren(
    el('button', {
      class: 'btn btn-quiet grow', html: `${icon('plus')}<span>הוסף משימה</span>`,
      onClick: openBox,
    }),
    el('button', {
      class: 'link-btn', text: 'פריט מפורט',
      onClick: () => openItemSheet(ctx, date, null, bounds),
    }),
  );

  function openBox() {
    let closed = false;
    const input = el('input', {
      class: 'field', type: 'text', enterkeyhint: 'done',
      placeholder: 'מה עושים ביום הזה?', 'aria-label': `משימה חדשה, ${fmtDayLabel(date)}`,
    });

    const save = async () => {
      const title = input.value.trim();
      if (!title) return;
      try {
        const saved = await it.quickAddItem(ctx.trip.id, {
          date, title, segmentId: segmentIdFor(ctx, date),
        });
        list.append(itemRow(ctx, date, saved, bounds));
        input.value = '';
        input.focus();
      } catch (err) { toast(err.message, 'error'); }
    };

    const close = () => {
      if (closed) return;
      closed = true;
      document.removeEventListener('pointerdown', onOutside, true);
      releaseRefresh();
      refresh();
    };

    const onOutside = event => { if (!node.contains(event.target)) close(); };

    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); save(); }
      if (event.key === 'Escape') { event.preventDefault(); close(); }
    });

    node.replaceChildren(
      input,
      el('button', { class: 'btn btn-primary', text: 'הוסף', onClick: save }),
      el('button', { class: 'btn btn-tertiary', text: 'סיים', onClick: close }),
    );
    holdRefresh();
    document.addEventListener('pointerdown', onOutside, true);
    input.focus();
  }

  showButtons();
  return node;
}

// ---------- יום, קבוצה, כותרת יעד ----------

/**
 * "סכום מתוך סכום". כל מספר בתוך .num משלו, והמילה העברית ביניהם טקסט רגיל:
 * מחרוזת מעורבת בתוך .num (שהוא direction:ltr) מוצגת בסדר הפוך למי שקורא עברית.
 */
function outOf(amount, of, currency) {
  return el('div', {}, [
    el('span', { class: 'num', html: fmtMoneyHtml(amount, currency) }),
    ' מתוך ',
    el('span', { class: 'num', html: fmtMoneyHtml(of, currency) }),
  ]);
}

const countLabel = n => (n === 0 ? 'אין תכנון' : n === 1 ? 'פריט אחד' : `${n} פריטים`);

function dayBlock(ctx, date, { showSegment = false, bounds = {} } = {}) {
  const items = ctx.byDate.get(date) || [];
  const key = `d:${date}`;
  const open = !ctx.prefs.collapsed.has(key);
  const seg = it.segmentForDate(ctx.segs, date);
  const list = el('div', { class: 'day-items' }, open ? items.map(i => itemRow(ctx, date, i, bounds)) : []);

  return el('div', { class: 'day' }, [
    el('button', {
      class: 'group-head day-head', 'aria-expanded': String(open),
      onClick: () => toggleKey(ctx, key),
    }, [
      el('span', { html: icon('chevronDown'),
        style: `color:var(--color-accent); transform:rotate(${open ? 0 : 90}deg)` }),
      el('span', { class: 'grow' }, [
        el('div', { class: 'row-title', text: fmtDayLabel(date) }),
        showSegment && seg ? el('div', { class: 'sub', text: seg.city }) : null,
      ]),
      el('span', { class: 'sub', text: countLabel(items.length) }),
    ]),
    open ? list : null,
    open ? addRow(ctx, date, list, bounds) : null,
  ]);
}

function groupTitle(group) {
  if (group.mode === 'weeks') {
    return group.partial ? `שבוע ${group.index} · ${fmtDays(group.dayCount)}` : `שבוע ${group.index}`;
  }
  if (group.mode === 'months') {
    const name = fmtMonth(group.from);
    return group.partial ? `${name} · ${fmtDays(group.dayCount)}` : name;
  }
  return fmtDayLabel(group.from);
}

function groupRange(group) {
  if (group.from === group.to) return fmtDayLabel(group.from);
  return `${fmtWeekday(group.from)} ${fmtDate(group.from)} – ${fmtWeekday(group.to)} ${fmtDate(group.to)}`;
}

function groupCard(ctx, group, { showSegment = false, bounds = {} } = {}) {
  const open = !ctx.prefs.collapsed.has(group.key);
  const count = group.days.reduce((sum, d) => sum + (ctx.byDate.get(d)?.length || 0), 0);
  const seg = ctx.segs.find(s => s.id === group.segmentId);

  return card([
    el('button', {
      class: 'group-head', 'aria-expanded': String(open),
      onClick: () => toggleKey(ctx, group.key),
    }, [
      el('span', { html: icon('chevronDown'),
        style: `color:var(--color-accent); transform:rotate(${open ? 0 : 90}deg)` }),
      el('span', { class: 'grow' }, [
        el('div', { class: 'card-title', text: groupTitle(group) }),
        el('div', { class: 'sub', text: groupRange(group) }),
      ]),
      el('span', { style: 'text-align:end' }, [
        showSegment && seg && seg.kind !== 'general'
          ? el('div', { class: 'sub', text: seg.city })
          : null,
        el('div', { class: 'sub', text: countLabel(count) }),
      ]),
    ]),
    open
      ? el('div', { class: 'day-list' }, group.days.map(d => dayBlock(ctx, d, { showSegment: false, bounds })))
      : null,
  ], 'card-gap');
}

/** כותרת היעד. יושבת מחוץ לקבוצות, ולכן קיפול קבוצה לעולם אינו מסתיר אותה. */
function segmentHeaderCard(ctx, seg) {
  const stat = ctx.totals.bySegment.find(x => x.id === seg.id)
    || { amount: 0, allocation: 0, over: false };
  const tasks = ctx.tasks.filter(t => t.segmentId === seg.id);
  const key = `c:${seg.id}`;
  const openList = !ctx.prefs.collapsed.has(key);

  return card([
    el('div', { style: 'display:flex; align-items:flex-start; gap:8px' }, [
      el('button', {
        class: 'group-head grow', 'aria-label': `ערוך את ${seg.city}`,
        onClick: () => openSegmentSheet(ctx.trip, seg),
      }, [
        el('span', { class: 'grow' }, [
          el('div', { class: 'row-title',
            text: seg.country ? `${seg.city}, ${seg.country}` : seg.city }),
          el('div', { class: 'sub',
            text: `${fmtDateRange(seg.startDate, seg.endDate)} · ${nightsBetween(seg.startDate, seg.endDate)} לילות` }),
        ]),
        el('span', { html: icon('edit'), style: 'color:var(--color-accent)' }),
      ]),
    ]),
    el('div', { class: 'row' }, [
      el('span', { class: 'grow' }, [
        outOf(stat.amount, stat.allocation, ctx.trip.currency),
        ilsPairNote(stat.amount, stat.allocation, ctx.trip.currency, ctx.rate),
      ]),
      stat.allocation
        ? el('span', { class: `pill ${stat.over ? 'over' : 'ok'}`, text: stat.over ? 'חריגה' : 'בתקציב' })
        : el('span', { class: 'sub', text: 'ללא הקצאה' }),
    ]),
    tasks.length
      ? el('button', {
          class: 'group-head cat-head', 'aria-expanded': String(openList),
          onClick: () => toggleKey(ctx, key),
        }, [
          el('span', { html: icon('chevronDown'),
            style: `color:var(--color-accent); transform:rotate(${openList ? 0 : 90}deg)` }),
          el('span', { class: 'grow', text: `צ׳קליסט היעד (${tasks.filter(t => t.done).length}/${tasks.length})` }),
        ])
      : null,
    tasks.length && openList
      ? el('div', {}, tasks.map(t => el('div', { class: 'row' }, [
          el('button', {
            class: 'tick', 'aria-pressed': String(!!t.done), 'aria-label': t.title, html: icon('check'),
            style: `--urgency: var(--urgency-${t.urgency || 'normal'})`,
            onClick: async () => { await prep.toggleDone(ctx.trip.id, t.id); refresh(); },
          }),
          el('span', { class: 'grow', text: t.title }),
          el('span', { class: 'sub', text: prep.URGENCY[t.urgency] || 'רגיל' }),
        ])))
      : null,
  ], 'card-gap seg-header');
}

// ---------- סרגל הפקדים ----------

function toolbar(ctx, collapsibleKeys) {
  const { trip, prefs } = ctx;
  const chip = (label, on, onClick) =>
    el('button', { class: 'chip', 'aria-pressed': String(on), text: label, onClick });

  const setView = view => {
    prefs.view = view;
    if (view === 'days') openSegmentId = null;
    savePrefs(trip.id, prefs);
    refresh();
  };

  // "פתח הכל" רק כשהכל באמת מקופל. יום אחד שקופל לא אמור להפוך את הכפתור
  // לכפתור פתיחה, כי אז צריך שתי לחיצות כדי לקפל את השאר.
  const allCollapsed = collapsibleKeys.length > 0 && collapsibleKeys.every(k => prefs.collapsed.has(k));

  return el('div', { class: 'card-gap plan-toolbar' }, [
    el('div', { class: 'plan-toolbar-scroll' }, [
      chip('לפי ימים', prefs.view === 'days', () => setView('days')),
      chip('לפי יעדים', prefs.view === 'segments', () => setView('segments')),
      el('span', { class: 'plan-toolbar-sep' }),
      ...Object.entries(it.GROUPINGS).map(([key, label]) => chip(label, prefs.grouping === key, () => {
        prefs.grouping = key;
        savePrefs(trip.id, prefs);
        refresh();
      })),
    ]),
    collapsibleKeys.length
      ? el('button', {
          class: 'chip plan-collapse', text: allCollapsed ? 'פתח הכל' : 'כווץ הכל',
          onClick: () => {
            if (allCollapsed) for (const k of collapsibleKeys) prefs.collapsed.delete(k);
            else for (const k of collapsibleKeys) prefs.collapsed.add(k);
            savePrefs(trip.id, prefs);
            refresh();
          },
        })
      : null,
  ]);
}

/** המפתחות ש"כווץ הכל" נוגע בהם: הקבוצות, או הימים כשאין קיבוץ. */
function collapsibleOf(groups, grouping) {
  return grouping === 'days'
    ? groups.map(g => `d:${g.from}`)
    : groups.map(g => g.key);
}

// ---------- תקציב הטיול ----------

function tripBudgetCard(trip, budget, rate) {
  const amountCell = (amount, cls = 'num') => el('span', { style: 'text-align:end' }, [
    el('div', { class: cls, html: fmtMoneyHtml(amount, trip.currency) }),
    ilsNote(amount, trip.currency, rate),
  ]);

  return card([
    el('div', { class: 'card-title', text: 'תקציב הטיול' }),
    el('div', { class: 'row' }, [
      el('span', { class: 'grow dim', text: 'תקרה' }),
      amountCell(budget.ceiling),
    ]),
    el('div', { class: 'row' }, [
      el('span', { class: 'grow dim', text: 'סך שהוקצה ליעדים' }),
      amountCell(budget.allocated),
    ]),
    el('div', { class: 'row' }, [
      el('span', { class: 'grow row-title', text: 'יתרה לא מוקצית' }),
      el('span', { style: 'text-align:end' }, [
        el('div', { class: `pill ${budget.over ? 'over' : 'ok'} num`,
          html: fmtMoneyHtml(budget.unallocated, trip.currency) }),
        ilsNote(budget.unallocated, trip.currency, rate),
      ]),
    ]),
    budget.over
      ? el('div', { class: 'toast warning', style: 'margin-block-start:12px',
          text: `ההקצאות ליעדים עוברות את התקרה ב-${fmtMoney(-budget.unallocated, trip.currency)}. אפשר לשמור, אבל שווה לבדוק.` })
      : null,
  ], 'card-gap');
}

// ---------- התצוגות ----------

function renderDays(ctx, days) {
  const groups = it.groupDays(days, ctx.prefs.grouping, ctx.segs);
  const nodes = [];
  const seenSegments = new Set();

  for (const group of groups) {
    const seg = ctx.segs.find(s => s.id === group.segmentId);
    if (seg && seg.kind !== 'general' && !seenSegments.has(seg.id)) {
      seenSegments.add(seg.id);
      nodes.push(segmentHeaderCard(ctx, seg));
    }
    nodes.push(ctx.prefs.grouping === 'days'
      ? card([dayBlock(ctx, group.from, { showSegment: true })], 'card-gap')
      : groupCard(ctx, group, { showSegment: true }));
  }

  return { nodes, keys: collapsibleOf(groups, ctx.prefs.grouping) };
}

function renderSegmentDays(ctx, seg) {
  const days = it.segmentDays(seg);
  const bounds = { min: seg.startDate || undefined, max: seg.endDate || undefined };
  const groups = it.groupDays(days, ctx.prefs.grouping, ctx.segs);
  const nodes = groups.map(group => (ctx.prefs.grouping === 'days'
    ? card([dayBlock(ctx, group.from, { bounds })], 'card-gap')
    : groupCard(ctx, group, { bounds })));
  return { nodes, keys: collapsibleOf(groups, ctx.prefs.grouping) };
}

function renderSegmentList(ctx) {
  const nodes = ctx.segs.map(seg => {
    const stat = ctx.totals.bySegment.find(x => x.id === seg.id) || { amount: 0, allocation: 0, over: false };
    const pct = stat.allocation ? Math.min(Math.round((stat.amount / stat.allocation) * 100), 100) : 0;
    return card([
      el('button', {
        class: 'group-head',
        onClick: () => { openSegmentId = seg.id; refresh(); },
      }, [
        el('span', { class: 'grow' }, [
          el('div', { class: 'row-title', text: seg.city }),
          el('div', { class: 'sub',
            text: seg.kind === 'general'
              ? 'הוצאות שאינן שייכות ליעד ספציפי'
              : `${fmtDateRange(seg.startDate, seg.endDate)} · ${nightsBetween(seg.startDate, seg.endDate)} לילות` }),
        ]),
        el('span', { html: icon('chevronLeft'), style: 'color:var(--color-accent)' }),
      ]),
      el('div', { class: 'row' }, [
        el('span', { class: 'grow' }, [
          outOf(stat.amount, stat.allocation, ctx.trip.currency),
          ilsPairNote(stat.amount, stat.allocation, ctx.trip.currency, ctx.rate),
        ]),
        stat.allocation
          ? el('span', { class: `pill ${stat.over ? 'over' : 'ok'}`, text: stat.over ? 'חריגה' : 'בתקציב' })
          : el('span', { class: 'sub', text: 'ללא הקצאה' }),
      ]),
      el('div', { class: 'bar' }, [
        el('span', { class: stat.over ? 'over' : '', style: `width:${stat.over ? 100 : pct}%` }),
      ]),
    ], 'card-gap');
  });
  return { nodes, keys: [] };
}

// ---------- המסך ----------

export async function mount(host, tripId) {
  if (!tripId) {
    host.append(noTripCard('שחזרו גיבוי קיים או פתחו טיול חדש כדי להתחיל לתכנן.'));
    return;
  }

  const [trip, segs, items, tasks, totals, budget] = await Promise.all([
    trips.getTrip(tripId),
    it.listSegments(tripId),
    it.listItems(tripId),
    prep.listTasks(tripId),
    money.tripTotals(tripId),
    trips.budgetSummary(tripId),
  ]);

  // שערי התצוגה: מטבע הטיול ומטבעות הפריטים שאין להם שער צרוב
  const fx = await rates.rateMap([trip.currency, ...items.map(i => i.currency)]);

  const prefs = readPrefs(tripId);
  const days = it.tripDays(trip, segs);
  prunePrefs(tripId, prefs, days);

  const ctx = {
    trip, segs, prefs, tasks, totals, fx, rate: fx[(trip.currency || 'ILS').toUpperCase()],
    byDate: it.itemsByDate(items),
    generalId: segs.find(s => s.kind === 'general')?.id ?? null,
  };

  const openSeg = prefs.view === 'segments' && openSegmentId
    ? segs.find(s => s.id === openSegmentId)
    : null;
  if (prefs.view === 'segments' && openSegmentId && !openSeg) openSegmentId = null;

  let body;
  if (openSeg) body = renderSegmentDays(ctx, openSeg);
  else if (prefs.view === 'segments') body = renderSegmentList(ctx);
  else body = renderDays(ctx, days);

  host.append(toolbar(ctx, body.keys));

  if (openSeg) {
    host.append(el('button', {
      class: 'group-head card-gap', style: 'color:var(--color-accent)',
      onClick: () => { openSegmentId = null; refresh(); },
    }, [el('span', { html: icon('chevronLeft') }), el('span', { text: 'חזרה לכל היעדים' })]));
    host.append(segmentHeaderCard(ctx, openSeg));
  } else {
    host.append(tripBudgetCard(trip, budget, ctx.rate));
  }

  if (!openSeg && prefs.view === 'days' && !days.length) {
    host.append(card([
      el('div', { class: 'empty-title', text: 'עדיין אין תאריכים לטיול' }),
      el('div', { class: 'dim',
        text: 'אפשר להוסיף יעד עם תאריכים, או להגדיר תאריכי טיול בטאב "הגדרות".' }),
    ], 'card-gap'));
  }

  host.append(...body.nodes);

  if (!openSeg) {
    host.append(el('button', {
      class: 'btn btn-primary btn-hero card-gap',
      html: `${icon('plus')}<span>יעד חדש</span>`,
      onClick: () => openSegmentSheet(trip, null, it.defaultRange(trip, segs)),
    }));
  }
}
