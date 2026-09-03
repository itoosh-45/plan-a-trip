import * as it from '../itinerary.js';
import * as trips from '../trips.js';
import { el, card, sheet, toast, confirmDanger, icon, fmtMoney, fmtDateRange, fmtDate, nightsBetween } from '../ui.js';
import { refresh } from '../app.js';
import { mountPrepCard } from './prep.js';

const openSegments = new Set();   // נשמר בין רינדורים כדי שהפתיחה לא תיסגר בכל שמירה
let openDay = null;

function typeLabel(key) {
  return it.ITEM_TYPES.find(t => t.key === key)?.label || 'אחר';
}
function typeIcon(key) {
  return it.ITEM_TYPES.find(t => t.key === key)?.icon || 'other';
}

function segmentForm(existing) {
  const city = el('input', { class: 'field', type: 'text', value: existing?.city || '' });
  const country = el('input', { class: 'field', type: 'text', value: existing?.country || '' });
  const start = el('input', { class: 'field', type: 'date', value: existing?.startDate || '' });
  const end = el('input', { class: 'field', type: 'date', value: existing?.endDate || '' });
  const currency = el('input', { class: 'field', type: 'text', maxlength: '3', style: 'text-transform:uppercase', value: existing?.currency || '' });

  const body = el('div', {}, [
    el('div', { class: 'field-row' }, [el('label', { class: 'field-label', text: 'עיר' }), city]),
    el('div', { class: 'field-row' }, [el('label', { class: 'field-label', text: 'מדינה' }), country]),
    el('div', { class: 'field-row' }, [el('label', { class: 'field-label', text: 'מתאריך' }), start]),
    el('div', { class: 'field-row' }, [el('label', { class: 'field-label', text: 'עד תאריך' }), end]),
    el('div', { class: 'field-row' }, [el('label', { class: 'field-label', text: 'מטבע מקומי' }), currency]),
  ]);

  return { body, read: () => ({
    id: existing?.id,
    city: city.value,
    country: country.value,
    startDate: start.value,
    endDate: end.value,
    currency: (currency.value || 'ILS').toUpperCase(),
  }) };
}

function openSegmentSheet(tripId, existing) {
  const form = segmentForm(existing);
  const actions = [
    el('button', { class: 'btn btn-tertiary btn-block', text: 'ביטול', onClick: () => s.close() }),
    el('button', { class: 'btn btn-primary btn-block', text: 'שמור', onClick: async () => {
      try {
        await it.saveSegment(tripId, form.read());
        toast('המקטע נשמר', 'success');
        s.close();
        refresh();
      } catch (err) { toast(err.message, 'error'); }
    } }),
  ];
  const s = sheet({ title: existing ? 'עריכת מקטע' : 'מקטע חדש', body: form.body, actions });
}

function openMoveSheet(tripId, seg) {
  const date = el('input', { class: 'field', type: 'date', value: seg.startDate });
  const s = sheet({
    title: `הזזת ${seg.city}`,
    body: el('div', {}, [
      el('p', { class: 'dim', style: 'margin:0 0 12px',
        text: 'כל הפריטים שבתוך המקטע יזוזו באותו מספר ימים.' }),
      el('div', { class: 'field-row' }, [el('label', { class: 'field-label', text: 'תאריך התחלה חדש' }), date]),
    ]),
    actions: [
      el('button', { class: 'btn btn-tertiary btn-block', text: 'ביטול', onClick: () => s.close() }),
      el('button', { class: 'btn btn-primary btn-block', text: 'הזז', onClick: async () => {
        try {
          await it.moveSegment(tripId, seg.id, date.value);
          toast('המקטע הוזז', 'success');
          s.close();
          refresh();
        } catch (err) { toast(err.message, 'error'); }
      } }),
    ],
  });
}

async function openItemSheet(tripId, date, segmentId, existing) {
  const cats = await trips.categories(tripId);

  const type = el('select', { class: 'field' }, it.ITEM_TYPES.map(t =>
    el('option', { value: t.key, selected: (existing?.type || 'attraction') === t.key, text: t.label })));
  const title = el('input', { class: 'field', type: 'text', value: existing?.title || '' });
  const dateF = el('input', { class: 'field', type: 'date', value: existing?.date || date });
  const time = el('input', { class: 'field', type: 'time', value: existing?.time || '' });
  const endDate = el('input', { class: 'field', type: 'date', value: existing?.endDate || '' });
  const place = el('input', { class: 'field', type: 'text', value: existing?.place || '' });
  const ref = el('input', { class: 'field', type: 'text', value: existing?.ref || '', placeholder: 'מספר הזמנה או קישור' });
  const category = el('select', { class: 'field' }, [
    el('option', { value: '', text: 'ללא קטגוריה' }),
    ...cats.map(c => el('option', { value: c.id, selected: existing?.categoryId === c.id, text: c.name })),
  ]);
  const planned = el('input', { class: 'field', type: 'number', inputmode: 'decimal', step: '0.01', value: existing?.plannedAmount ?? '' });
  const actual = el('input', { class: 'field', type: 'number', inputmode: 'decimal', step: '0.01', value: existing?.actualAmount ?? '' });
  const currency = el('input', { class: 'field', type: 'text', maxlength: '3', style: 'text-transform:uppercase', value: existing?.currency || '' });
  const payStatus = el('select', { class: 'field' }, Object.entries(it.PAY_STATUS).map(([k, v]) =>
    el('option', { value: k, selected: (existing?.payStatus || 'planned') === k, text: v })));
  const method = el('select', { class: 'field' }, [
    el('option', { value: '', text: 'לא נקבע' }),
    ...Object.entries(it.PAY_METHOD).map(([k, v]) =>
      el('option', { value: k, selected: existing?.method === k, text: v })),
  ]);

  const row = (label, node) => el('div', { class: 'field-row' }, [el('label', { class: 'field-label', text: label }), node]);

  const body = el('div', {}, [
    row('סוג', type), row('כותרת', title), row('תאריך', dateF), row('שעה', time),
    row('תאריך סיום (ללינה)', endDate), row('מיקום', place), row('הזמנה או קישור', ref),
    row('קטגוריית תקציב', category), row('סכום מתוכנן', planned), row('סכום בפועל', actual),
    row('מטבע', currency), row('סטטוס תשלום', payStatus), row('אמצעי תשלום', method),
    el('p', { class: 'dim', style: 'font-size:13px; margin-block-start:12px',
      text: 'כשמוזן סכום בפועל, הוא זה שנספר בתקציב ובסיכום. הסכום המתוכנן נשמר כדי להראות את הפער.' }),
  ]);

  const num = f => (f.value === '' ? undefined : Number(f.value));

  const s = sheet({
    title: existing ? 'עריכת פריט' : 'פריט חדש',
    body,
    actions: [
      existing
        ? el('button', { class: 'btn btn-danger btn-block', text: 'מחק', onClick: async () => {
            const ok = await confirmDanger({ title: 'למחוק את הפריט?', body: existing.title, confirmLabel: 'מחק' });
            if (!ok) return;
            await it.removeItem(tripId, existing.id);
            toast('הפריט נמחק', 'success');
            s.close();
            refresh();
          } })
        : el('button', { class: 'btn btn-tertiary btn-block', text: 'ביטול', onClick: () => s.close() }),
      el('button', { class: 'btn btn-primary btn-block', text: 'שמור', onClick: async () => {
        try {
          await it.saveItem(tripId, {
            id: existing?.id,
            segmentId: existing?.segmentId ?? segmentId ?? null,
            type: type.value,
            title: title.value,
            date: dateF.value,
            time: time.value || undefined,
            endDate: endDate.value || undefined,
            place: place.value || undefined,
            ref: ref.value || undefined,
            categoryId: category.value || undefined,
            plannedAmount: num(planned),
            actualAmount: num(actual),
            currency: (currency.value || '').toUpperCase() || undefined,
            payStatus: payStatus.value,
            method: method.value || undefined,
          });
          toast('הפריט נשמר', 'success');
          s.close();
          refresh();
        } catch (err) { toast(err.message, 'error'); }
      } }),
    ],
  });
}

export async function mount(host, tripId) {
  if (!tripId) {
    host.append(card([el('div', { class: 'dim', text: 'צרו טיול במסך ההגדרות כדי להתחיל לתכנן.' })], 'card-gap'));
    return;
  }

  await mountPrepCard(host, tripId);

  const [segs, items] = await Promise.all([it.listSegments(tripId), it.listItems(tripId)]);
  const byDate = it.itemsByDate(items);
  const overlaps = it.overlappingSegments(segs);

  if (!segs.length) {
    host.append(card([
      el('div', { style: 'font-weight:700; margin-block-end:4px', text: 'אין עדיין מקטעים' }),
      el('div', { class: 'dim', text: 'מקטע הוא עיר עם טווח תאריכים. הימים נגזרים ממנו.' }),
    ], 'card-gap'));
  }

  for (const seg of segs) {
    const days = it.segmentDays(seg);
    const cost = items
      .filter(i => i.segmentId === seg.id)
      .reduce((sum, i) => sum + it.effectiveAmount(i), 0);
    const isOpen = openSegments.has(seg.id);

    const head = el('button', {
      style: 'display:flex; align-items:center; gap:8px; width:100%; background:none; border:0; padding:0; text-align:start; cursor:pointer; min-height:44px',
      'aria-expanded': String(isOpen),
      onClick: () => {
        if (isOpen) openSegments.delete(seg.id); else openSegments.add(seg.id);
        refresh();
      },
    }, [
      el('span', { html: icon('chevronDown'), style: `color:var(--color-accent); transform:rotate(${isOpen ? 0 : -90}deg)` }),
      el('span', { style: 'flex:1' }, [
        el('div', { style: 'font-weight:700', text: seg.country ? `${seg.city}, ${seg.country}` : seg.city }),
        el('div', { class: 'dim', style: 'font-size:14px',
          text: `${fmtDateRange(seg.startDate, seg.endDate)} · ${nightsBetween(seg.startDate, seg.endDate)} לילות · ${seg.currency}` }),
      ]),
      el('span', { class: 'num', style: 'font-weight:700', text: cost ? fmtMoney(cost, seg.currency) : '' }),
    ]);

    const body = [];
    if (isOpen) {
      if (overlaps.has(seg.id)) {
        body.push(el('div', {
          style: 'display:flex; gap:6px; align-items:center; color:var(--color-warning); font-size:13px; margin-block-start:8px',
          html: `${icon('alert')}<span>יום מעבר משותף עם מקטע נוסף</span>`,
        }));
      }
      for (const d of days) {
        const dayItems = (byDate.get(d) || []).filter(i => i.segmentId === seg.id || i.segmentId === null);
        body.push(el('div', { class: 'hairline', style: 'padding-block:10px' }, [
          el('button', {
            style: 'display:flex; justify-content:space-between; width:100%; background:none; border:0; padding:0; min-height:44px; cursor:pointer; text-align:start',
            onClick: () => { openDay = openDay === `${seg.id}|${d}` ? null : `${seg.id}|${d}`; refresh(); },
          }, [
            el('span', { style: 'font-weight:600', text: fmtDate(d) }),
            el('span', { class: 'dim', style: 'font-size:13px', text: dayItems.length ? `${dayItems.length} פריטים` : 'אין תכנון' }),
          ]),
          ...dayItems.map(i => el('button', {
            style: 'display:flex; align-items:center; gap:8px; width:100%; background:none; border:0; padding:8px 0; min-height:44px; cursor:pointer; text-align:start',
            onClick: () => openItemSheet(tripId, d, seg.id, i),
          }, [
            el('span', { html: icon(typeIcon(i.type)), style: 'color:var(--color-accent)' }),
            el('span', { class: 'dim num', style: 'font-size:13px; min-width:44px', text: i.time || '' }),
            el('span', { style: 'flex:1; overflow-wrap:anywhere', text: i.title }),
            el('span', { class: 'num', style: 'font-size:14px',
              text: it.effectiveAmount(i) ? fmtMoney(it.effectiveAmount(i), i.currency || seg.currency) : '' }),
          ])),
          openDay === `${seg.id}|${d}`
            ? el('button', {
                class: 'btn btn-secondary btn-block', style: 'margin-block-start:8px',
                html: `${icon('plus')}<span>הוסף פריט ל-${fmtDate(d)}</span>`,
                onClick: () => openItemSheet(tripId, d, seg.id, null),
              })
            : null,
        ]));
      }
      body.push(el('div', { style: 'display:flex; gap:8px; margin-block-start:12px' }, [
        el('button', { class: 'btn btn-tertiary btn-block', text: 'ערוך מקטע', onClick: () => openSegmentSheet(tripId, seg) }),
        el('button', { class: 'btn btn-tertiary btn-block', text: 'הזז', onClick: () => openMoveSheet(tripId, seg) }),
        el('button', { class: 'btn btn-danger', 'aria-label': 'מחק מקטע', html: icon('trash'), onClick: async () => {
          const ok = await confirmDanger({
            title: `למחוק את המקטע ${seg.city}?`,
            body: 'הפריטים שבתוכו יישמרו, אך יאבדו את השיוך למקטע.',
            confirmLabel: 'מחק מקטע',
          });
          if (!ok) return;
          await it.removeSegment(tripId, seg.id);
          openSegments.delete(seg.id);
          toast('המקטע נמחק', 'success');
          refresh();
        } }),
      ]));
    }

    host.append(card([head, ...body], 'card-gap'));
  }

  const orphans = items.filter(i => i.segmentId === null);
  if (orphans.length) {
    host.append(card([
      el('div', { style: 'font-weight:700; margin-block-end:8px', text: 'פריטים ללא מקטע' }),
      ...orphans.map(i => el('button', {
        style: 'display:flex; align-items:center; gap:8px; width:100%; background:none; border:0; padding:8px 0; min-height:44px; cursor:pointer; text-align:start',
        onClick: () => openItemSheet(tripId, i.date, null, i),
      }, [
        el('span', { html: icon(typeIcon(i.type)), style: 'color:var(--color-accent)' }),
        el('span', { style: 'flex:1; overflow-wrap:anywhere', text: `${fmtDate(i.date)} · ${i.title}` }),
      ])),
    ], 'card-gap'));
  }

  host.append(el('button', {
    class: 'btn btn-primary fab', 'aria-label': 'הוסף מקטע',
    html: `${icon('plus')}<span>מקטע</span>`,
    onClick: () => openSegmentSheet(tripId, null),
  }));
}
