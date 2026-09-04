import * as db from '../db.js';
import * as trips from '../trips.js';
import * as rates from '../rates.js';
import * as cur from '../currencies.js';
import * as money from '../money.js';
import * as excel from '../excel.js';
import * as backup from '../backup.js';
import { el, card, sheet, toast, confirmDanger, icon, fmtMoney, fmtDateRange } from '../ui.js';
import { refresh, setActiveTrip, navigate } from '../app.js';
import { openTripWizard } from '../onboarding.js';

const CATEGORY_ICONS = [
  'restaurant', 'ride', 'lodging', 'attraction', 'shopping', 'flight',
  'transfer', 'meeting', 'gear', 'cash', 'card', 'other',
];

function section(title, children) {
  return card([
    el('h2', { class: 'card-title', text: title }),
    ...[].concat(children),
  ], 'card-gap');
}

// ---------- טיולים ----------

function tripCard(trip, totals, isActive) {
  return el('article', { class: 'trip-card card-gap', 'aria-current': String(isActive) }, [
    el('div', { class: 'trip-card-head' }, [
      el('button', {
        class: 'trip-card-edit', 'aria-label': `ערוך את ${trip.name}`,
        html: icon('edit'), onClick: () => openTripWizard(trip),
      }),
      el('span', { class: 'trip-card-currency', text: cur.symbol(trip.currency) }),
      el('h3', { text: trip.name }),
      el('div', {
        class: 'dates',
        text: trip.startDate ? fmtDateRange(trip.startDate, trip.endDate) : 'ללא תאריכים',
      }),
    ]),
    el('button', {
      class: 'trip-card-body',
      style: 'width:100%; background:none; border:0; cursor:pointer; font:inherit; color:inherit',
      onClick: () => { setActiveTrip(trip.id); navigate('summary'); },
    }, [
      el('span', { class: 'dim', text: `סה"כ הוצאות (${totals.count})` }),
      el('span', { class: 'total num', text: fmtMoney(totals.amount, trip.currency) }),
    ]),
    el('div', { style: 'display:flex; gap:8px; padding:0 16px 16px' }, [
      el('button', {
        class: 'btn btn-tertiary btn-block',
        text: isActive ? 'הטיול הפעיל' : 'עבור לטיול',
        disabled: isActive || null,
        onClick: () => setActiveTrip(trip.id),
      }),
      el('button', {
        class: 'btn btn-danger', 'aria-label': `מחק את ${trip.name}`, html: icon('trash'),
        onClick: () => removeTripFlow(trip),
      }),
    ]),
  ]);
}

async function removeTripFlow(trip) {
  const first = await confirmDanger({
    title: `למחוק את "${trip.name}"?`,
    body: 'היעדים, הפריטים, ההוצאות ורשימת ההכנה של הטיול יימחקו.',
    confirmLabel: 'המשך',
  });
  if (!first) return;
  const second = await confirmDanger({
    title: 'אישור סופי',
    body: 'הפעולה אינה ניתנת לביטול. אם אין לך גיבוי, הנתונים אובדים.',
    confirmLabel: 'מחק לצמיתות',
  });
  if (!second) return;
  await trips.removeTrip(trip.id);
  toast('הטיול נמחק', 'success');
  refresh();
}

// ---------- מטבעות ----------

function currencySection(active) {
  const chosen = new Set(active);
  const chips = el('div', { style: 'display:flex; flex-wrap:wrap; gap:8px' },
    Object.keys(cur.NAMES).map(code => {
      const chip = el('button', {
        class: 'chip', 'aria-pressed': String(chosen.has(code)),
        text: cur.label(code),
        onClick: async () => {
          if (code === 'ILS') { toast('השקל תמיד פעיל', 'warning'); return; }
          if (chosen.has(code)) chosen.delete(code); else chosen.add(code);
          chip.setAttribute('aria-pressed', String(chosen.has(code)));
          await cur.setActive([...chosen]);
        },
      });
      return chip;
    }));

  return section('מטבעות פעילים', [
    el('p', { class: 'dim', style: 'margin:0 0 12px',
      text: 'רק המטבעות שנבחרו כאן מופיעים בדרופדאון שליד כל שדה סכום.' }),
    chips,
  ]);
}

// ---------- שערי המרה ----------

function fxAge(ts) {
  const days = Math.floor((Date.now() - Date.parse(ts)) / 86400000);
  if (days <= 0) return 'עודכן היום';
  if (days === 1) return 'עודכן אתמול';
  return `עודכן לפני ${days} ימים`;
}

function openManualRateSheet(currency, existing) {
  const rate = el('input', {
    class: 'field', type: 'number', inputmode: 'decimal', step: '0.0001', value: existing?.rate ?? '',
  });
  const s = sheet({
    title: `שער ידני ל-${currency}`,
    body: el('div', { class: 'field-row' }, [
      el('label', { class: 'field-label', text: `כמה שקלים שווה 1 ${currency}` }), rate,
    ]),
    actions: [
      el('button', { class: 'btn btn-tertiary btn-block', text: 'ביטול', onClick: () => s.close() }),
      el('button', { class: 'btn btn-primary btn-block', text: 'שמור', onClick: async () => {
        try {
          await rates.setManualRate(currency, rate.value);
          toast('השער נשמר', 'success');
          s.close();
          refresh();
        } catch (err) { toast(err.message, 'error'); }
      } }),
    ],
  });
}

/** מושך שערים, מציג אותם לאישור, ורק אחרי אישור דורס את הידניים. */
async function refreshRatesFlow(currencies) {
  toast('מושך שערים…');
  const fetched = await rates.fetchRates(currencies);
  const ok = Object.entries(fetched).filter(([, r]) => r.ok);
  if (!ok.length) { toast('לא ניתן היה למשוך שערים כרגע', 'warning'); return; }

  const s = sheet({
    title: 'שערים שנמשכו',
    body: el('div', {}, [
      el('p', { class: 'dim', style: 'margin:0 0 12px',
        text: 'השערים יידרסו רק אחרי אישור. סכומים שכבר נרשמו אינם משתנים.' }),
      ...ok.map(([code, r]) => el('div', { class: 'row' }, [
        el('span', { class: 'grow', text: cur.label(code) }),
        el('span', { class: 'num', text: `${r.rate.toFixed(4)} ₪` }),
      ])),
      ...Object.entries(fetched).filter(([, r]) => !r.ok).map(([code]) =>
        el('div', { class: 'sub', text: `${code} — לא נמצא שער` })),
    ]),
    actions: [
      el('button', { class: 'btn btn-tertiary btn-block', text: 'ביטול', onClick: () => s.close() }),
      el('button', { class: 'btn btn-primary btn-block', text: 'עדכן שערים', onClick: async () => {
        const saved = await rates.applyRates(fetched);
        toast(`עודכנו ${saved} שערים`, 'success');
        s.close();
        refresh();
      } }),
    ],
  });
}

function fxSection(currencies, known) {
  const foreign = currencies.filter(c => c !== 'ILS');
  if (!foreign.length) return null;
  return section('שערי המרה', [
    el('p', { class: 'dim', style: 'margin:0 0 12px',
      text: 'כל השערים מול השקל. האפליקציה עובדת אופליין עם השערים הידניים.' }),
    ...foreign.map(code => {
      const r = known[code];
      return el('div', { class: 'row' }, [
        el('div', { class: 'grow' }, [
          el('div', { class: 'row-title', text: cur.label(code) }),
          el('div', { class: 'sub',
            text: r
              ? `1 ${code} = ${r.rate} ₪ · ${fxAge(r.ts)} (${r.source})${r.stale ? ' · ישן' : ''}`
              : 'אין שער שמור — הזן ידנית' }),
        ]),
        el('button', {
          class: 'icon-btn', 'aria-label': `שער ידני ל-${code}`,
          html: icon('edit'), onClick: () => openManualRateSheet(code, r),
        }),
      ]);
    }),
    el('button', {
      class: 'btn btn-secondary btn-block', style: 'margin-block-start:12px',
      html: `${icon('refresh')}<span>רענן שערים מהאינטרנט</span>`,
      onClick: () => refreshRatesFlow(foreign),
    }),
  ]);
}

// ---------- קטגוריות ----------

function openCategorySheet(tripId, existing) {
  const name = el('input', { class: 'field', type: 'text', value: existing?.name || '' });
  const color = el('input', {
    class: 'field', type: 'color', value: existing?.color || '#06BCC1', style: 'height:48px; padding:4px',
  });
  let chosenIcon = existing?.icon || 'other';

  const grid = el('div', { style: 'display:flex; flex-wrap:wrap; gap:8px' },
    CATEGORY_ICONS.map(key => {
      const btn = el('button', {
        class: 'chip', 'aria-pressed': String(key === chosenIcon), 'aria-label': key,
        html: icon(key),
        onClick: () => {
          chosenIcon = key;
          for (const b of grid.children) b.setAttribute('aria-pressed', String(b === btn));
        },
      });
      return btn;
    }));

  const s = sheet({
    title: existing ? 'עריכת קטגוריה' : 'קטגוריה חדשה',
    body: el('div', {}, [
      el('div', { class: 'field-row' }, [el('label', { class: 'field-label', text: 'שם' }), name]),
      el('div', { class: 'field-row' }, [el('label', { class: 'field-label', text: 'אייקון' }), grid]),
      el('div', { class: 'field-row' }, [el('label', { class: 'field-label', text: 'צבע' }), color]),
    ]),
    actions: [
      el('button', { class: 'btn btn-tertiary btn-block', text: 'ביטול', onClick: () => s.close() }),
      el('button', { class: 'btn btn-primary btn-block', text: 'שמור', onClick: async () => {
        try {
          await trips.upsertCategory(tripId, {
            id: existing?.id, name: name.value, color: color.value, icon: chosenIcon,
          });
          toast('נשמר', 'success');
          s.close();
        } catch (err) { toast(err.message, 'error'); }
      } }),
    ],
  });
}

// ---------- אקסל וגיבוי ----------

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
  } catch (err) { toast(err.message, 'error'); }
}

function openImportPreview(trip, parsed) {
  const s = sheet({
    title: 'אישור ייבוא',
    body: el('div', {}, [
      el('p', { class: 'dim', style: 'margin:0 0 12px',
        text: `הקובץ יחליף את המסלול וההוצאות של "${trip.name}" בלבד. אין ייבוא עד לאישור.` }),
      el('div', { text: `יעדים: ${parsed.preview.segments}` }),
      el('div', { text: `פריטי מסלול: ${parsed.preview.items}` }),
      el('div', { text: `הוצאות: ${parsed.preview.expenses}` }),
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

function pickFile(accept, onFile) {
  const input = el('input', { type: 'file', accept, style: 'display:none' });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.remove();
    if (file) await onFile(file);
  });
  document.body.append(input);
  input.click();
}

function importExcel(trip) {
  pickFile('.xlsx', async file => {
    const parsed = await excel.parse(file);
    if (!parsed.ok) {
      const s = sheet({
        title: 'הקובץ לא תקין',
        body: el('div', {}, parsed.errors.map(e =>
          el('div', { class: 'toast error', style: 'margin-block-end:8px', text: e }))),
        actions: [el('button', { class: 'btn btn-tertiary btn-block', text: 'סגירה', onClick: () => s.close() })],
      });
      return;
    }
    openImportPreview(trip, parsed);
  });
}

async function runBackup() {
  try {
    const res = await backup.toFile();
    if (res.method === 'share') toast('הגיבוי נשלח לשיתוף', 'success');
    else if (res.method === 'download') toast('קובץ הגיבוי הורד', 'success');
  } catch (err) { toast(err.message, 'error'); }
}

function runRestore() {
  pickFile('.json,application/json', async file => {
    const parsed = await backup.parseBackup(file);
    if (!parsed.ok) { toast(parsed.error, 'error'); return; }
    const rows = Object.entries(parsed.preview).filter(([, n]) => n > 0);
    const s = sheet({
      title: 'שחזור מגיבוי',
      body: el('div', {}, [
        el('p', { class: 'row-title', style: 'color:var(--color-danger); margin:0 0 12px',
          text: 'השחזור מוחק ומחליף את כל הנתונים הקיימים במכשיר הזה — כל הטיולים.' }),
        rows.length
          ? el('div', {}, rows.map(([store, n]) => el('div', { text: `${store}: ${n}` })))
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
          } catch (err) { toast(err.message, 'error'); }
        } }),
      ],
    });
  });
}

// ---------- המסך ----------

export async function mount(host, tripId) {
  const all = await trips.listTrips();
  const trip = all.find(t => t.id === tripId) || null;

  const totals = new Map();
  for (const t of all) {
    const sum = await money.tripTotals(t.id);
    const rows = await db.all(db.STORES.expenses, t.id);
    totals.set(t.id, { amount: sum.total, count: rows.filter(r => r.kind !== 'cashSpend').length });
  }

  host.append(el('h2', { class: 'screen-title', style: 'margin-block-start:16px', text: 'טיולים' }));
  for (const t of all) host.append(tripCard(t, totals.get(t.id), t.id === tripId));
  host.append(el('button', {
    class: 'btn btn-primary btn-block card-gap',
    html: `${icon('plus')}<span>טיול חדש</span>`,
    onClick: () => openTripWizard(null),
  }));

  const active = await cur.listActive();
  host.append(currencySection(active));

  const known = {};
  for (const code of active) known[code] = await rates.getRate(code);
  const fx = fxSection(active, known);
  if (fx) host.append(fx);

  if (trip) {
    const cats = await trips.categories(trip.id);
    host.append(section('קטגוריות', [
      ...cats.map(c => el('div', { class: 'row' }, [
        el('span', {
          class: 'cat-icon', html: icon(c.icon || 'other'),
          style: `background:color-mix(in srgb, ${c.color} 14%, transparent); color:${c.color}`,
        }),
        el('span', { class: 'grow', text: c.name }),
        el('button', { class: 'icon-btn', 'aria-label': `ערוך ${c.name}`, html: icon('edit'),
          onClick: () => openCategorySheet(trip.id, c) }),
        el('button', {
          class: 'icon-btn', style: 'color:var(--color-danger)', 'aria-label': `מחק ${c.name}`,
          html: icon('trash'),
          onClick: async () => {
            try {
              await trips.removeCategory(trip.id, c.id);
              toast('הקטגוריה נמחקה', 'success');
              refresh();
            } catch (err) { toast(err.message, 'error'); }
          },
        }),
      ])),
      el('button', {
        class: 'btn btn-secondary btn-block', style: 'margin-block-start:12px',
        html: `${icon('plus')}<span>קטגוריה חדשה</span>`,
        onClick: () => openCategorySheet(trip.id, null),
      }),
    ]));

    host.append(section('ייצוא וייבוא אקסל', [
      el('p', { class: 'dim', style: 'margin:0 0 12px',
        text: 'קובץ מעוצב עם 4 גיליונות: סיכום, מסלול, תקציב, הוצאות.' }),
      el('div', { style: 'display:flex; gap:8px' }, [
        el('button', { class: 'btn btn-secondary btn-block', html: `${icon('download')}<span>ייצוא</span>`,
          onClick: () => exportExcel(trip) }),
        el('button', { class: 'btn btn-tertiary btn-block', html: `${icon('share')}<span>ייבוא</span>`,
          onClick: () => importExcel(trip) }),
      ]),
    ]));
  }

  host.append(section('גיבוי ושחזור', [
    el('p', { class: 'dim', style: 'margin:0 0 12px',
      text: 'קובץ JSON מלא של כל הטיולים. הגיבוי באחריותך ובלחיצת כפתור — לא אוטומטי.' }),
    el('div', { style: 'display:flex; gap:8px' }, [
      el('button', { class: 'btn btn-secondary btn-block', html: `${icon('share')}<span>גיבוי עכשיו</span>`,
        onClick: runBackup }),
      el('button', { class: 'btn btn-danger btn-block', html: `${icon('refresh')}<span>שחזור מקובץ</span>`,
        onClick: runRestore }),
    ]),
  ]));

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
        setActiveTrip(null);
      },
    }),
  ]));
}
