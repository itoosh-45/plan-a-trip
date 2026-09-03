import * as db from '../db.js';
import * as trips from '../trips.js';
import * as money from '../money.js';
import * as excel from '../excel.js';
import * as backup from '../backup.js';
import { el, card, sheet, toast, confirmDanger, icon, fmtMoney } from '../ui.js';
import { refresh, setActiveTrip } from '../app.js';

async function runBackup() {
  try {
    const res = await backup.toFile();
    if (res.method === 'share') toast('הגיבוי נשלח לשיתוף', 'success');
    else if (res.method === 'download') toast('קובץ הגיבוי הורד', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

function openRestorePreview(parsed) {
  const rows = Object.entries(parsed.preview).filter(([, n]) => n > 0);
  const s = sheet({
    title: 'שחזור מגיבוי',
    body: el('div', {}, [
      el('p', { style: 'color:var(--color-danger); font-weight:700; margin:0 0 12px',
        text: 'השחזור מוחק ומחליף את כל הנתונים הקיימים במכשיר הזה — כל הטיולים.' }),
      rows.length
        ? el('div', { style: 'display:flex; flex-direction:column; gap:4px' },
            rows.map(([store, n]) => el('div', { text: `${store}: ${n}` })))
        : el('div', { class: 'dim', text: 'קובץ הגיבוי ריק.' }),
    ]),
    actions: [
      el('button', { class: 'btn btn-tertiary btn-block', text: 'ביטול', onClick: () => s.close() }),
      el('button', { class: 'btn btn-danger btn-block', text: 'שחזר והחלף הכול', onClick: async () => {
        const ok = await confirmDanger({
          title: 'אישור סופי לשחזור',
          body: 'כל הנתונים הנוכחיים יימחקו ויוחלפו בתוכן הגיבוי. אין דרך לבטל.',
          confirmLabel: 'שחזר לצמיתות',
        });
        if (!ok) return;
        try {
          await backup.restore(parsed.payload);
          toast('השחזור הושלם', 'success');
          s.close();
          setActiveTrip(null);
          refresh();
        } catch (err) { toast(err.message, 'error'); }
      } }),
    ],
  });
}

function runRestore() {
  const input = el('input', { type: 'file', accept: '.json,application/json', style: 'display:none' });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;
    const parsed = await backup.parseBackup(file);
    if (!parsed.ok) { toast(parsed.error, 'error'); return; }
    openRestorePreview(parsed);
  });
  document.body.append(input);
  input.click();
}

async function exportExcel(trip) {
  try {
    const blob = await excel.build(trip.id);
    const filename = `${trip.name.replace(/[\\/:*?"<>|]/g, '-')}-${new Date().toISOString().slice(0, 10)}.xlsx`;
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast('הקובץ יוצא', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

function openImportPreview(trip, parsed) {
  const s = sheet({
    title: 'אישור ייבוא',
    body: el('div', {}, [
      el('p', { class: 'dim', style: 'margin:0 0 12px',
        text: `הקובץ יחליף את המסלול, התקציב וההוצאות של "${trip.name}" בלבד. אין ייבוא ← עד לאישור.` }),
      el('div', { style: 'display:flex; flex-direction:column; gap:4px' }, [
        el('div', { text: `מקטעים: ${parsed.preview.segments}` }),
        el('div', { text: `פריטי מסלול: ${parsed.preview.items}` }),
        el('div', { text: `שורות תקציב: ${parsed.preview.budgets}` }),
        el('div', { text: `הוצאות: ${parsed.preview.expenses}` }),
      ]),
    ]),
    actions: [
      el('button', { class: 'btn btn-tertiary btn-block', text: 'ביטול', onClick: () => s.close() }),
      el('button', { class: 'btn btn-primary btn-block', text: 'אשר ויבא', onClick: async () => {
        try {
          await excel.apply(trip.id, parsed);
          toast('הייבוא הושלם', 'success');
          s.close();
          refresh();
        } catch (err) { toast(err.message, 'error'); }
      } }),
    ],
  });
}

function importExcel(trip) {
  const input = el('input', { type: 'file', accept: '.xlsx', style: 'display:none' });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;
    const parsed = await excel.parse(file);
    if (!parsed.ok) {
      const s = sheet({
        title: 'הקובץ לא תקין',
        body: el('div', {}, parsed.errors.map(e => el('div', { class: 'toast error', style: 'margin-block-end:8px', text: e }))),
        actions: [el('button', { class: 'btn btn-tertiary btn-block', text: 'סגירה', onClick: () => s.close() })],
      });
      return;
    }
    openImportPreview(trip, parsed);
  });
  document.body.append(input);
  input.click();
}

async function tripCurrencies(tripId) {
  const [segs, items, expenses] = await Promise.all([
    db.all(db.STORES.segments, tripId),
    db.all(db.STORES.items, tripId),
    db.all(db.STORES.expenses, tripId),
  ]);
  const all = [...segs, ...items, ...expenses].map(r => (r.currency || '').toUpperCase()).filter(c => c && c !== 'ILS');
  return [...new Set(all)].sort();
}

function fxAge(ts) {
  const days = Math.floor((Date.now() - Date.parse(ts)) / 86400000);
  if (days <= 0) return 'עודכן היום';
  if (days === 1) return 'עודכן אתמול';
  return `עודכן לפני ${days} ימים`;
}

function openManualRateSheet(currency) {
  const rate = el('input', { class: 'field', type: 'number', inputmode: 'decimal', step: '0.0001' });
  const s = sheet({
    title: `שער ידני ל-${currency}`,
    body: el('div', { class: 'field-row' }, [
      el('label', { class: 'field-label', text: `כמה שקלים ב-1 ${currency}` }), rate,
    ]),
    actions: [
      el('button', { class: 'btn btn-tertiary btn-block', text: 'ביטול', onClick: () => s.close() }),
      el('button', { class: 'btn btn-primary btn-block', text: 'שמור', onClick: async () => {
        try {
          await money.setManualRate(currency, rate.value);
          toast('השער נשמר', 'success');
          s.close();
          refresh();
        } catch (err) { toast(err.message, 'error'); }
      } }),
    ],
  });
}

function fxSection(tripId, currencies, rates) {
  if (!currencies.length) return null;
  return section('שערי מטבע', [
    ...currencies.map(cur => {
      const r = rates[cur];
      return el('div', {
        class: 'hairline', style: 'display:flex; align-items:center; gap:8px; padding-block:10px',
      }, [
        el('div', { style: 'flex:1' }, [
          el('div', { style: 'font-weight:600', text: cur }),
          el('div', { class: 'dim', style: 'font-size:13px',
            text: r ? `1 ${cur} = ${r.rate} ₪ · ${fxAge(r.ts)} (${r.source})${r.stale ? ' · ישן' : ''}` : 'אין שער שמור' }),
        ]),
        el('button', { class: 'icon-btn', 'aria-label': `שער ידני ל-${cur}`, html: icon('edit'), onClick: () => openManualRateSheet(cur) }),
      ]);
    }),
    el('button', {
      class: 'btn btn-secondary btn-block', style: 'margin-block-start:12px',
      html: `${icon('refresh')}<span>רענון שערים אונליין</span>`,
      onClick: async () => {
        const res = await money.refreshRates(currencies);
        const ok = Object.values(res).filter(r => r.ok).length;
        toast(ok ? `עודכנו ${ok} שערים` : 'לא ניתן היה לעדכן שערים כרגע', ok ? 'success' : 'warning');
        refresh();
      },
    }),
  ]);
}

function section(title, children) {
  return card([
    el('h2', { style: 'font-size:16px; font-weight:700; margin:0 0 12px', text: title }),
    ...[].concat(children),
  ], 'card-gap');
}

function tripForm(existing) {
  const name = el('input', { class: 'field', type: 'text', value: existing?.name || '', placeholder: 'לדוגמה: יפן 2026' });
  const currency = el('input', { class: 'field', type: 'text', value: existing?.homeCurrency || 'ILS', maxlength: '3', style: 'text-transform:uppercase' });
  const budget = el('input', { class: 'field', type: 'number', inputmode: 'decimal', step: '0.01', value: existing?.totalBudget ?? 0 });
  const status = el('select', { class: 'field' }, Object.entries(trips.TRIP_STATUS).map(([k, v]) =>
    el('option', { value: k, selected: (existing?.status || 'planned') === k, text: v })));

  const body = el('div', {}, [
    el('div', { class: 'field-row' }, [el('label', { class: 'field-label', text: 'שם הטיול' }), name]),
    el('div', { class: 'field-row' }, [el('label', { class: 'field-label', text: 'מטבע בית' }), currency]),
    el('div', { class: 'field-row' }, [el('label', { class: 'field-label', text: 'תקציב כולל' }), budget]),
    el('div', { class: 'field-row' }, [el('label', { class: 'field-label', text: 'סטטוס' }), status]),
    el('div', { class: 'field-row dim', style: 'font-size:13px',
      text: 'תאריכי הטיול נגזרים מהמקטעים במסך התכנון ואינם מוזנים כאן.' }),
  ]);

  return { body, read: () => ({
    id: existing?.id,
    name: name.value,
    homeCurrency: (currency.value || 'ILS').toUpperCase(),
    totalBudget: Number(budget.value) || 0,
    status: status.value,
  }) };
}

function openTripSheet(existing) {
  const form = tripForm(existing);
  const s = sheet({
    title: existing ? 'עריכת טיול' : 'טיול חדש',
    body: form.body,
    actions: [
      el('button', { class: 'btn btn-tertiary btn-block', text: 'ביטול', onClick: () => s.close() }),
      el('button', { class: 'btn btn-primary btn-block', text: 'שמור', onClick: async () => {
        try {
          const data = form.read();
          if (existing) {
            await trips.updateTrip(data);
            toast('הטיול עודכן', 'success');
          } else {
            const t = await trips.createTrip(data);
            setActiveTrip(t.id);
            toast('הטיול נוצר', 'success');
          }
          s.close();
        } catch (err) {
          toast(err.message, 'error');
        }
      } }),
    ],
  });
}

function openCategorySheet(tripId, existing) {
  const name = el('input', { class: 'field', type: 'text', value: existing?.name || '' });
  const color = el('input', { class: 'field', type: 'color', value: existing?.color || '#06BCC1', style: 'height:48px; padding:4px' });
  const s = sheet({
    title: existing ? 'עריכת קטגוריה' : 'קטגוריה חדשה',
    body: el('div', {}, [
      el('div', { class: 'field-row' }, [el('label', { class: 'field-label', text: 'שם' }), name]),
      el('div', { class: 'field-row' }, [el('label', { class: 'field-label', text: 'צבע בגרף' }), color]),
    ]),
    actions: [
      el('button', { class: 'btn btn-tertiary btn-block', text: 'ביטול', onClick: () => s.close() }),
      el('button', { class: 'btn btn-primary btn-block', text: 'שמור', onClick: async () => {
        try {
          await trips.upsertCategory(tripId, { id: existing?.id, name: name.value, color: color.value });
          toast('נשמר', 'success');
          s.close();
        } catch (err) {
          toast(err.message, 'error');
        }
      } }),
    ],
  });
}

export async function mount(host, tripId) {
  const all = await trips.listTrips();
  const trip = all.find(t => t.id === tripId) || null;

  host.append(section('טיולים', [
    ...all.map(t => el('div', {
      class: 'hairline',
      style: 'display:flex; align-items:center; gap:8px; padding-block:10px',
    }, [
      el('div', { style: 'flex:1' }, [
        el('div', { style: 'font-weight:600', text: t.name }),
        el('div', { class: 'dim', style: 'font-size:13px',
          text: `${trips.TRIP_STATUS[t.status]} · תקציב ${fmtMoney(t.totalBudget, t.homeCurrency)}` }),
      ]),
      el('button', { class: 'icon-btn', 'aria-label': `ערוך ${t.name}`, html: icon('edit'), onClick: () => openTripSheet(t) }),
      el('button', {
        class: 'icon-btn', 'aria-label': `מחק ${t.name}`, style: 'color:var(--color-danger)', html: icon('trash'),
        onClick: async () => {
          const first = await confirmDanger({
            title: `למחוק את "${t.name}"?`,
            body: 'המקטעים, הפריטים, ההוצאות ורשימת ההכנה של הטיול יימחקו.',
            confirmLabel: 'המשך',
          });
          if (!first) return;
          const second = await confirmDanger({
            title: 'אישור סופי',
            body: 'הפעולה אינה ניתנת לביטול. אם אין לך גיבוי, הנתונים אובדים.',
            confirmLabel: 'מחק לצמיתות',
          });
          if (!second) return;
          await trips.removeTrip(t.id);
          toast('הטיול נמחק', 'success');
          refresh();
        },
      }),
    ])),
    el('button', {
      class: 'btn btn-primary btn-block', style: 'margin-block-start:12px',
      html: `${icon('plus')}<span>טיול חדש</span>`, onClick: () => openTripSheet(null),
    }),
  ]));

  host.append(section('גיבוי ושחזור', [
    el('p', { class: 'dim', style: 'margin:0 0 12px',
      text: 'קובץ JSON מלא של כל הטיולים. גיבוי הוא באחריותך ובלחיצת כפתור — לא אוטומטי.' }),
    el('div', { style: 'display:flex; gap:8px' }, [
      el('button', { class: 'btn btn-secondary btn-block', html: `${icon('share')}<span>גיבוי עכשיו</span>`, onClick: runBackup }),
      el('button', { class: 'btn btn-danger btn-block', html: `${icon('refresh')}<span>שחזור מקובץ</span>`, onClick: runRestore }),
    ]),
  ]));

  if (trip) {
    host.append(section('ייצוא וייבוא אקסל', [
      el('p', { class: 'dim', style: 'margin:0 0 12px', text: 'קובץ מעוצב עם 4 גיליונות: סיכום, מסלול, תקציב, הוצאות.' }),
      el('div', { style: 'display:flex; gap:8px' }, [
        el('button', { class: 'btn btn-secondary btn-block', html: `${icon('download')}<span>ייצוא</span>`, onClick: () => exportExcel(trip) }),
        el('button', { class: 'btn btn-tertiary btn-block', html: `${icon('share')}<span>ייבוא</span>`, onClick: () => importExcel(trip) }),
      ]),
    ]));

    const currencies = await tripCurrencies(trip.id);
    const rates = {};
    for (const cur of currencies) rates[cur] = await money.getRate(cur);
    const fx = fxSection(trip.id, currencies, rates);
    if (fx) host.append(fx);

    const cats = await trips.categories(trip.id);
    host.append(section('קטגוריות', [
      ...cats.map(c => el('div', {
        class: 'hairline', style: 'display:flex; align-items:center; gap:10px; padding-block:10px',
      }, [
        el('span', { style: `width:14px; height:14px; border-radius:4px; background:${c.color}` }),
        el('span', { style: 'flex:1', text: c.name }),
        el('button', { class: 'icon-btn', 'aria-label': `ערוך ${c.name}`, html: icon('edit'), onClick: () => openCategorySheet(trip.id, c) }),
        el('button', {
          class: 'icon-btn', 'aria-label': `מחק ${c.name}`, style: 'color:var(--color-danger)', html: icon('trash'),
          onClick: async () => {
            try {
              await trips.removeCategory(trip.id, c.id);
              toast('הקטגוריה נמחקה', 'success');
              refresh();
            } catch (err) {
              toast(err.message, 'error');
            }
          },
        }),
      ])),
      el('button', {
        class: 'btn btn-secondary btn-block', style: 'margin-block-start:12px',
        html: `${icon('plus')}<span>קטגוריה חדשה</span>`, onClick: () => openCategorySheet(trip.id, null),
      }),
    ]));
  }

  host.append(section('מחיקת כל הנתונים', [
    el('p', { class: 'dim', style: 'margin:0 0 12px',
      text: 'מוחק את כל הטיולים, ההוצאות והשערים מהמכשיר הזה. הקטלוג נשאר.' }),
    el('button', {
      class: 'btn btn-danger btn-block', text: 'מחק הכול',
      onClick: async () => {
        const ok = await confirmDanger({
          title: 'למחוק את כל הנתונים?',
          body: 'כל הטיולים יימחקו מהמכשיר. אין דרך לשחזר בלי קובץ גיבוי.',
          confirmLabel: 'מחק הכול',
        });
        if (!ok) return;
        await db.wipe();
        try { localStorage.removeItem('activeTripId'); } catch { /* מצב פרטי */ }
        toast('כל הנתונים נמחקו', 'success');
        refresh();
      },
    }),
  ]));
}
