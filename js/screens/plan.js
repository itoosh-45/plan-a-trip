import * as trips from '../trips.js';
import * as it from '../itinerary.js';
import * as prep from '../prep.js';
import * as money from '../money.js';
import * as rates from '../rates.js';
import * as cur from '../currencies.js';
import {
  el, card, sheet, toast, confirmDanger, icon, amountField, ilsNote,
  fmtMoney, fmtDate, fmtDateRange, nightsBetween,
} from '../ui.js';
import { refresh } from '../app.js';

let openSegmentId = null;   // null = רשימת היעדים; אחרת תצוגת היעד
let openDay = null;

const typeOf = key => it.ITEM_TYPES.find(t => t.key === key) || it.ITEM_TYPES.at(-1);

function row(label, node) {
  return el('div', { class: 'field-row' }, [el('label', { class: 'field-label', text: label }), node]);
}

function dateRange(from, to, { min, max } = {}) {
  const start = el('input', { class: 'field', type: 'date', value: from || '', min, max, 'aria-label': 'מתאריך' });
  const end = el('input', { class: 'field', type: 'date', value: to || '', min, max, 'aria-label': 'עד תאריך' });
  return { node: el('div', { class: 'date-row field-row' }, [start, end]), start, end };
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
      el('button', { class: 'btn btn-tertiary btn-block', text: 'ביטול', onClick: () => s.close() }),
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

async function openItemSheet(trip, seg, date, existing) {
  const cats = await trips.categories(trip.id);
  const currencies = await cur.listActive();

  const type = el('select', { class: 'field' }, it.ITEM_TYPES.map(t =>
    el('option', { value: t.key, selected: (existing?.type || 'attraction') === t.key, text: t.label })));
  const title = el('input', { class: 'field', type: 'text', value: existing?.title || '' });
  const dateF = el('input', {
    class: 'field', type: 'date', value: existing?.date || date,
    min: seg.startDate || undefined, max: seg.endDate || undefined,
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
        text: 'זו עלות מתוכננת בלבד. כסף שיצא בפועל נרשם בטאב "הוצאות".' }),
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
            segmentId: seg.id,
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

// ---------- תצוגת יעד יחיד ----------

async function renderSegment(host, trip, seg) {
  const [items, tasks] = await Promise.all([it.listItems(trip.id), prep.listTasks(trip.id)]);
  const mine = items.filter(i => i.segmentId === seg.id);
  const byDate = it.itemsByDate(mine);
  const segTasks = tasks.filter(t => t.segmentId === seg.id);

  host.append(el('button', {
    class: 'group-head card-gap', style: 'color:var(--color-accent)',
    onClick: () => { openSegmentId = null; refresh(); },
  }, [el('span', { html: icon('chevronLeft') }), el('span', { text: 'חזרה לכל היעדים' })]));

  host.append(card([
    el('div', { style: 'display:flex; align-items:flex-start; gap:8px' }, [
      el('div', { class: 'grow' }, [
        el('div', { class: 'screen-title',
          text: seg.country ? `${seg.city}, ${seg.country}` : seg.city }),
        el('div', { class: 'sub',
          text: `${fmtDateRange(seg.startDate, seg.endDate)} · ${nightsBetween(seg.startDate, seg.endDate)} לילות` }),
      ]),
      el('button', { class: 'icon-btn', 'aria-label': 'ערוך יעד', html: icon('edit'),
        onClick: () => openSegmentSheet(trip, seg) }),
    ]),
    el('div', { class: 'row' }, [
      el('span', { class: 'grow dim', text: 'הקצאת תקציב' }),
      el('span', { class: 'num', text: fmtMoney(seg.allocation || 0, trip.currency) }),
    ]),
  ], 'card-gap'));

  for (const day of it.segmentDays(seg)) {
    const dayItems = byDate.get(day) || [];
    const isOpen = openDay === day;
    host.append(card([
      el('button', {
        class: 'group-head', 'aria-expanded': String(isOpen),
        onClick: () => { openDay = isOpen ? null : day; refresh(); },
      }, [
        el('span', { html: icon('chevronDown'),
          style: `color:var(--color-accent); transform:rotate(${isOpen ? 0 : 90}deg)` }),
        el('span', { class: 'grow row-title', text: fmtDate(day) }),
        el('span', { class: 'sub',
          text: dayItems.length ? `${dayItems.length} פריטים` : 'אין תכנון' }),
      ]),
      ...dayItems.map(i => el('button', {
        class: 'row', style: 'width:100%; background:none; border:0; text-align:start; cursor:pointer; font:inherit; color:inherit',
        onClick: () => openItemSheet(trip, seg, day, i),
      }, [
        el('span', { class: 'cat-icon', html: icon(typeOf(i.type).icon),
          style: 'background:var(--color-surface-2); color:var(--color-accent)' }),
        el('span', { class: 'grow' }, [
          el('span', { style: 'display:block', text: i.title }),
          el('span', { class: 'sub' }, [
            el('span', { text: `${typeOf(i.type).label}${i.time ? ` · ${i.time}` : ''}` }),
            i.place ? el('span', { text: ` · ${i.place}` }) : null,
            i.note ? el('span', { text: ` · ${i.note}` }) : null,
          ]),
        ]),
        i.plannedAmount
          ? el('span', {}, [
              el('div', { class: 'num', text: fmtMoney(i.plannedAmount, i.currency || trip.currency) }),
              ilsNote(i.plannedAmount, i.currency || trip.currency, i.rateToILS),
            ])
          : null,
      ])),
      isOpen
        ? el('button', {
            class: 'btn btn-secondary btn-block', style: 'margin-block-start:8px',
            html: `${icon('plus')}<span>הוסף פריט ל-${fmtDate(day)}</span>`,
            onClick: () => openItemSheet(trip, seg, day, null),
          })
        : null,
    ], 'card-gap'));
  }

  host.append(card([
    el('div', { class: 'card-title', text: 'צ׳קליסט ליעד' }),
    segTasks.length
      ? el('div', {}, segTasks.map(t => el('div', { class: 'row' }, [
          el('button', {
            class: 'tick', 'aria-pressed': String(!!t.done), 'aria-label': t.title, html: icon('check'),
            style: `--urgency: var(--urgency-${t.urgency || 'normal'})`,
            onClick: async () => { await prep.toggleDone(trip.id, t.id); refresh(); },
          }),
          el('span', { class: 'grow', text: t.title }),
          el('span', { class: 'sub', text: prep.URGENCY[t.urgency] || 'רגיל' }),
        ])))
      : el('div', { class: 'dim', text: 'אין עדיין משימות שמשויכות ליעד הזה.' }),
    el('div', { class: 'sub', style: 'margin-block-start:8px',
      text: 'שיוך משימה ליעד נעשה בעריכת המשימה בטאב "רשימת הכנה".' }),
  ], 'card-gap'));

  if (seg.kind !== 'general') {
    host.append(el('button', {
      class: 'btn btn-danger btn-block card-gap',
      html: `${icon('trash')}<span>מחק את היעד</span>`,
      onClick: async () => {
        const ok = await confirmDanger({
          title: `למחוק את ${seg.city}?`,
          body: 'הפריטים, ההוצאות והמשימות שלו יעברו למקטע "כללי" ולא יימחקו.',
          confirmLabel: 'מחק יעד',
        });
        if (!ok) return;
        await it.removeSegment(trip.id, seg.id);
        openSegmentId = null;
        toast('היעד נמחק', 'success');
        refresh();
      },
    }));
  }
}

// ---------- המסך ----------

export async function mount(host, tripId) {
  if (!tripId) {
    host.append(card([
      el('div', { class: 'empty-title', text: 'אין עדיין טיול' }),
      el('div', { class: 'dim', text: 'פתחו את ההגדרות וצרו טיול כדי להתחיל לתכנן.' }),
    ], 'card-gap'));
    return;
  }

  const trip = await trips.getTrip(tripId);
  const segs = await it.listSegments(tripId);

  if (openSegmentId) {
    const seg = segs.find(s => s.id === openSegmentId);
    if (seg) { await renderSegment(host, trip, seg); return; }
    openSegmentId = null;
  }

  const totals = await money.tripTotals(tripId);
  const budget = await trips.budgetSummary(tripId);

  host.append(card([
    el('div', { class: 'card-title', text: 'תקציב הטיול' }),
    el('div', { class: 'row' }, [
      el('span', { class: 'grow dim', text: 'תקרה' }),
      el('span', { class: 'num', text: fmtMoney(budget.ceiling, trip.currency) }),
    ]),
    el('div', { class: 'row' }, [
      el('span', { class: 'grow dim', text: 'סך שהוקצה' }),
      el('span', { class: 'num', text: fmtMoney(budget.allocated, trip.currency) }),
    ]),
    el('div', { class: 'row' }, [
      el('span', { class: 'grow row-title', text: 'יתרה לא מוקצית' }),
      el('span', { class: `pill ${budget.over ? 'over' : 'ok'} num`,
        text: fmtMoney(budget.unallocated, trip.currency) }),
    ]),
    budget.over
      ? el('div', { class: 'toast warning', style: 'margin-block-start:12px',
          text: `ההקצאות ליעדים עוברות את התקרה ב-${fmtMoney(-budget.unallocated, trip.currency)}. אפשר לשמור, אבל שווה לבדוק.` })
      : null,
  ], 'card-gap'));

  for (const seg of segs) {
    const stat = totals.bySegment.find(x => x.id === seg.id) || { amount: 0, allocation: 0, over: false };
    const pct = stat.allocation ? Math.min(Math.round((stat.amount / stat.allocation) * 100), 100) : 0;
    host.append(card([
      el('button', {
        class: 'group-head',
        onClick: () => { openSegmentId = seg.id; openDay = null; refresh(); },
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
        el('span', { class: 'grow num', text: `${fmtMoney(stat.amount, trip.currency)} מתוך ${fmtMoney(stat.allocation, trip.currency)}` }),
        stat.allocation
          ? el('span', { class: `pill ${stat.over ? 'over' : 'ok'}`, text: stat.over ? 'חריגה' : 'בתקציב' })
          : el('span', { class: 'sub', text: 'ללא הקצאה' }),
      ]),
      el('div', { class: 'bar' }, [
        el('span', { class: stat.over ? 'over' : '', style: `width:${stat.over ? 100 : pct}%` }),
      ]),
    ], 'card-gap'));
  }

  host.append(el('button', {
    class: 'btn btn-primary btn-block card-gap',
    html: `${icon('plus')}<span>יעד חדש</span>`,
    onClick: () => openSegmentSheet(trip, null, it.defaultRange(trip, segs)),
  }));
}
