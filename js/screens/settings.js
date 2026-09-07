import * as db from '../db.js';
import * as trips from '../trips.js';
import * as rates from '../rates.js';
import * as cur from '../currencies.js';
import * as money from '../money.js';
import * as excel from '../excel.js';
import * as backup from '../backup.js';
import * as sheets from '../sheets.js';
import * as catalog from '../catalog.js';
import * as imported from '../imported.js';
import { el, card, sheet, toast, confirmDanger, icon, fmtMoney, fmtMoneyHtml, fmtDateRange } from '../ui.js';
import { refresh, setActiveTrip, navigate } from '../app.js';
import { openTripWizard } from '../onboarding.js';
import { openSheetsWizard } from '../sheets-setup.js';
import { INTRO_LEAD, introPoints } from './no-trip.js';

const CATEGORY_ICONS = [
  'restaurant', 'ride', 'lodging', 'attraction', 'shopping', 'flight',
  'transfer', 'meeting', 'gear', 'cash', 'card', 'other',
];

/** כל סקשן בהגדרות נראה אותו דבר: כותרת, משפט הסבר אחד, ואז התוכן. */
function section(title, note, children) {
  return card([
    el('h2', { class: 'card-title', text: title }),
    note ? el('p', { class: 'sub', style: 'margin:0 0 12px', text: note }) : null,
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
      el('span', { class: 'total num', html: fmtMoneyHtml(totals.amount, trip.currency) }),
    ]),
    el('div', { style: 'display:flex; gap:8px; padding:0 14px 10px' }, [
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
  const available = Object.keys(cur.NAMES).filter(c => !chosen.has(c));

  const picker = el('select', { class: 'field', 'aria-label': 'הוספת מטבע' }, [
    el('option', { value: '', text: available.length ? 'בחרו מטבע להוספה…' : 'כל המטבעות כבר פעילים' }),
    ...available.map(code => el('option', { value: code, text: cur.label(code) })),
  ]);
  picker.addEventListener('change', async () => {
    if (!picker.value) return;
    try {
      await cur.setActive([...chosen, picker.value]);
      refresh();
    } catch (err) { toast(err.message, 'error'); }
  });

  const rows = [...chosen].map(code => el('div', { class: 'row' }, [
    el('span', { class: 'grow row-title', text: cur.label(code) }),
    code === 'ILS'
      ? el('span', { class: 'sub', text: 'תמיד פעיל' })
      : el('button', {
          class: 'icon-btn', style: 'color:var(--color-danger)',
          'aria-label': `הסר את ${code}`, html: icon('close'),
          onClick: async () => {
            try {
              await cur.setActive([...chosen].filter(c => c !== code));
              refresh();
            } catch (err) { toast(err.message, 'error'); }
          },
        }),
  ]));

  return section(
    'מטבעות פעילים',
    'רק המטבעות שנבחרו כאן מופיעים בדרופדאון שליד כל שדה סכום. השקל תמיד פעיל.',
    [picker, ...rows],
  );
}

// ---------- פריטים מוסתרים מהקטלוג ----------

// המדורים הפתוחים נשמרים בין רינדורים, אחרת כל החזרת פריט סוגרת את הרשימה
const openHiddenSections = new Set();

async function hiddenCatalogSection() {
  const [hidden, byId, all] = await Promise.all([
    catalog.hiddenIds(), catalog.byId(), catalog.load(),
  ]);
  const items = [...hidden].map(id => byId.get(id)).filter(Boolean);
  const note = 'פריטים שאינם מוצעים בשום טיול. הם לא נמחקו — החזרה כאן מחזירה אותם לבורר הקטלוג.';

  if (!items.length) {
    return section('פריטים מוסתרים מהקטלוג', note, [
      el('div', { class: 'sub', text: 'אין פריטים מוסתרים. כל הקטלוג זמין.' }),
    ]);
  }

  // אותה חלוקה למדורים שיש בקטלוג עצמו, ובאותו סדר
  const order = [];
  for (const item of all) if (!order.includes(item.section)) order.push(item.section);
  const bySection = new Map();
  for (const item of items) {
    if (!bySection.has(item.section)) bySection.set(item.section, []);
    bySection.get(item.section).push(item);
  }

  const body = [
    el('div', { class: 'sub', style: 'margin-block-end:8px',
      text: `${items.length} מוסתרים מתוך ${all.length} בקטלוג. ${all.length - items.length} זמינים.` }),
  ];

  for (const name of order) {
    const group = bySection.get(name);
    if (!group) continue;
    const isOpen = openHiddenSections.has(name);

    body.push(el('button', {
      class: 'group-head cat-head', 'aria-expanded': String(isOpen),
      onClick: () => {
        if (isOpen) openHiddenSections.delete(name); else openHiddenSections.add(name);
        refresh();
      },
    }, [
      el('span', {
        html: icon('chevronDown'),
        style: `color:var(--color-accent); transform:rotate(${isOpen ? 0 : 90}deg)`,
      }),
      el('span', { class: 'grow', text: name }),
      el('span', { class: 'sub num', text: String(group.length) }),
    ]));

    if (!isOpen) continue;
    for (const item of group) {
      body.push(el('div', { class: 'row' }, [
        el('span', { class: 'grow' }, [
          el('span', { style: 'display:block', text: item.text }),
          el('span', { class: 'sub', text: item.topic }),
        ]),
        el('button', {
          class: 'btn btn-tertiary', text: 'החזר',
          onClick: async () => {
            await catalog.unhide(item.id);
            toast('הפריט חזר לקטלוג', 'success');
            refresh();
          },
        }),
      ]));
    }
    body.push(el('button', {
      class: 'btn btn-tertiary btn-block', style: 'margin-block-start:8px',
      text: `החזר את כל ${group.length} הפריטים ב"${name}"`,
      onClick: async () => {
        const ids = new Set(group.map(x => x.id));
        await catalog.setHidden([...hidden].filter(id => !ids.has(id)));
        toast(`${group.length} פריטים חזרו לקטלוג`, 'success');
        refresh();
      },
    }));
  }

  body.push(el('button', {
    class: 'btn btn-secondary btn-block', style: 'margin-block-start:16px',
    text: `החזר את כל ${items.length} הפריטים לקטלוג`,
    onClick: async () => {
      const ok = await confirmDanger({
        title: 'להחזיר את הכול?',
        body: `כל ${items.length} הפריטים המוסתרים יחזרו לבורר הקטלוג.`,
        confirmLabel: 'החזר הכול',
      });
      if (!ok) return;
      await catalog.setHidden([]);
      toast('כל הפריטים חזרו לקטלוג', 'success');
      refresh();
    },
  }));

  return section('פריטים מוסתרים מהקטלוג', note, body);
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
  return section(
    'שערי המרה',
    'כל השערים מול השקל. האפליקציה עובדת אופליין עם השערים הידניים.',
    [...foreign.map(code => {
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
    })],
  );
}

// ---------- קטגוריות ----------

function openCategorySheet(tripId, existing) {
  const name = el('input', { class: 'field', type: 'text', value: existing?.name || '' });
  const color = el('input', {
    class: 'field', type: 'color', value: existing?.color || '#009C89', style: 'height:48px; padding:4px',
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

// ---------- קטלוגים מיובאים ----------

/**
 * חלון ההעלאה. הקובץ כבר נקרא ואומת לפני שהחלון נפתח, ולכן כאן נשארו רק
 * ההחלטות: איך קוראים לרשימה, ולאן היא משויכת. שדות השיוך אופציונליים —
 * בלעדיהם הרשימה זמינה מכל רשימת הכנה, וזו ברירת המחדל.
 */
async function openImportSheet(items, suggestedName) {
  const name = el('input', { class: 'field', type: 'text', value: suggestedName });

  const phases = await catalog.phases();
  const phaseSel = el('select', { class: 'field' }, [
    el('option', { value: '', text: 'ללא שיוך — זמינה בכל הרשימות' }),
    ...phases.map(p => el('option', { value: p, text: p })),
  ]);
  const sectionSel = el('select', { class: 'field', disabled: true }, [
    el('option', { value: '', text: 'ללא מדור' }),
  ]);

  phaseSel.addEventListener('change', async () => {
    const options = [el('option', { value: '', text: 'ללא מדור' })];
    if (phaseSel.value) {
      for (const sec of await catalog.sections(phaseSel.value)) {
        options.push(el('option', { value: sec, text: sec }));
      }
    }
    sectionSel.replaceChildren(...options);
    sectionSel.disabled = !phaseSel.value;
  });

  const row = (label, node) => el('div', { class: 'field-row' }, [
    el('label', { class: 'field-label', text: label }), node,
  ]);

  const s = sheet({
    title: 'רשימה מיובאת',
    body: el('div', {}, [
      el('p', { class: 'sub', style: 'margin:0 0 12px', text: `נקראו ${items.length} פריטים מהקובץ.` }),
      row('שם הרשימה', name),
      row('שלב', phaseSel),
      row('מדור', sectionSel),
      el('p', { class: 'sub',
        text: 'הרשימה תופיע תמיד בסוף בורר הקטלוג, מסומנת כרשימה מיובאת. השיוך קובע רק לאיזו רשימת הכנה ולאיזו קטגוריה הפריטים ייכנסו.' }),
    ]),
    actions: [
      el('button', { class: 'btn btn-tertiary btn-block', text: 'ביטול', onClick: () => s.close() }),
      el('button', { class: 'btn btn-primary btn-block', text: 'שמור', onClick: async () => {
        try {
          await imported.add({
            name: name.value, items,
            phase: phaseSel.value || null,
            section: sectionSel.value || null,
          });
          toast(`נשמרו ${items.length} פריטים`, 'success');
          s.close();
          refresh();
        } catch (err) { toast(err.message, 'error'); }
      } }),
    ],
  });
}

function importCatalogFlow() {
  pickFile('.xlsx,.csv', async file => {
    let parsed;
    try {
      parsed = await imported.parse(file);
    } catch (err) { toast(err.message, 'error'); return; }

    if (!parsed.ok) {
      const s = sheet({
        title: 'הקובץ לא תקין',
        body: el('div', {}, parsed.errors.map(e =>
          el('div', { class: 'toast error', style: 'margin-block-start:8px', text: e }))),
        actions: [el('button', { class: 'btn btn-tertiary btn-block', text: 'סגור', onClick: () => s.close() })],
      });
      return;
    }
    await openImportSheet(parsed.items, file.name.replace(/\.(xlsx|csv)$/i, ''));
  });
}

function importedSection(lists) {
  const rows = lists.map(entry => el('div', { class: 'row' }, [
    el('span', { class: 'grow' }, [
      el('div', { class: 'row-title', text: entry.name }),
      el('div', { class: 'sub', text: [
        `${entry.items.length} פריטים`,
        entry.phase ? `שלב ${entry.phase}` : null,
        entry.section ? `מדור ${entry.section}` : null,
        entry.addedAt,
      ].filter(Boolean).join(' · ') }),
    ]),
    el('button', {
      class: 'icon-btn', style: 'color:var(--color-danger)',
      'aria-label': `מחק את ${entry.name}`, html: icon('trash'),
      onClick: async () => {
        const ok = await confirmDanger({
          title: `למחוק את "${entry.name}"?`,
          body: 'הרשימה תיעלם מבורר הקטלוג. משימות שכבר נוספו לטיולים יישארו במקומן.',
          confirmLabel: 'מחק רשימה',
        });
        if (!ok) return;
        await imported.remove(entry.id);
        toast('הרשימה נמחקה', 'success');
        refresh();
      },
    }),
  ]));

  return section(
    'קטלוגים מיובאים',
    'רשימות פריטים משלך, מקובץ xlsx או csv: עמודה אחת עם הפריטים, ועמודה שנייה אופציונלית עם הדחיפות. הן נשמרות במכשיר הזה וזמינות בכל הטיולים.',
    [
      ...(rows.length ? rows : [el('p', { class: 'dim', style: 'margin:0', text: 'עוד לא העלית רשימות.' })]),
      el('div', { style: 'display:flex; gap:8px; margin-block-start:12px' }, [
        el('button', {
          class: 'btn btn-secondary btn-block', html: `${icon('share')}<span>העלאת רשימה</span>`,
          onClick: importCatalogFlow,
        }),
        el('button', {
          class: 'btn btn-tertiary btn-block', html: `${icon('download')}<span>קובץ תבנית</span>`,
          onClick: () => {
            try {
              const url = URL.createObjectURL(imported.templateBlob());
              const a = el('a', { href: url, download: 'תבנית-רשימה.xlsx' });
              document.body.append(a);
              a.click();
              a.remove();
              setTimeout(() => URL.revokeObjectURL(url), 5000);
            } catch (err) { toast(err.message, 'error'); }
          },
        }),
      ]),
    ],
  );
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

/** שחזור טיול אחד. אם הוא כבר קיים במכשיר — שואלים מה לעשות איתו. */
async function restoreOneTrip(payload, trip) {
  const existing = await trips.getTrip(trip.id);
  let mode = 'replace';

  if (existing) {
    mode = await new Promise(resolve => {
      let settled = false;
      const finish = v => { if (!settled) { settled = true; s.close(); resolve(v); } };
      const s = sheet({
        title: `"${trip.name}" כבר קיים במכשיר`,
        body: el('div', {}, [
          el('p', { class: 'sub',
            text: 'החלפה מוחקת את הטיול שבמכשיר על כל ההוצאות והרשימות שלו. עותק משאיר את שניהם.' }),
          el('button', {
            class: 'btn btn-tertiary btn-block', style: 'margin-block-start:8px',
            text: 'הוסף כעותק נפרד', onClick: () => finish('copy'),
          }),
          el('button', {
            class: 'btn btn-danger btn-block', style: 'margin-block-start:8px',
            text: 'החלף את הקיים', onClick: () => finish('replace'),
          }),
        ]),
        actions: [
          el('button', { class: 'btn btn-tertiary btn-block', text: 'ביטול', onClick: () => finish(null) }),
        ],
      });
    });
    if (!mode) return false;
  }

  try {
    await backup.restoreTrip(payload, trip.id, mode);
    toast(mode === 'copy' ? 'הטיול נוסף כעותק' : 'הטיול שוחזר', 'success');
    return true;
  } catch (err) {
    toast(err.message, 'error');
    return false;
  }
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

async function runBackup(tripId) {
  try {
    const res = await backup.toFile(tripId);
    if (res.method === 'share') { toast('הגיבוי נשלח לשיתוף', 'success'); await backup.markBackedUp(); }
    else if (res.method === 'download') { toast('קובץ הגיבוי הורד', 'success'); await backup.markBackedUp(); }
  } catch (err) { toast(err.message, 'error'); }
}

export function runRestore() {
  pickFile('.json,application/json', async file => {
    const parsed = await backup.parseBackup(file);
    if (!parsed.ok) { toast(parsed.error, 'error'); return; }
    const inFile = backup.tripsIn(parsed.payload);
    const s = sheet({
      title: 'שחזור מגיבוי',
      body: el('div', {}, [
        el('p', { class: 'sub', style: 'margin:0 0 12px',
          text: inFile.length
            ? 'אפשר לשחזר טיול אחד מהקובץ בלי לגעת בשאר הטיולים במכשיר, או להחליף את הכול.'
            : 'לא נמצאו טיולים בקובץ.' }),

        ...inFile.map(trip => el('div', { class: 'row' }, [
          el('span', { class: 'grow' }, [
            el('span', { class: 'row-title', style: 'display:block', text: trip.name }),
            el('span', { class: 'sub',
              text: `${trip.counts.segments} יעדים · ${trip.counts.expenses} הוצאות · ${trip.counts.prepTasks} משימות` }),
          ]),
          el('button', {
            class: 'btn btn-tertiary', text: 'שחזר',
            onClick: async () => {
              const done = await restoreOneTrip(parsed.payload, trip);
              if (done) { s.close(); refresh(); }
            },
          }),
        ])),

        el('p', { class: 'sub hairline', style: 'color:var(--color-danger); margin-block-start:16px; padding-block-start:12px',
          text: 'שחזור מלא מוחק ומחליף את כל הנתונים במכשיר — כל הטיולים, כולל כאלה שאינם בקובץ.' }),
      ]),
      actions: [
        el('button', { class: 'btn btn-tertiary btn-block', text: 'ביטול', onClick: () => s.close() }),
        el('button', { class: 'btn btn-danger btn-block', text: 'החלף הכול', onClick: async () => {
          const ok = await confirmDanger({
            title: 'אישור סופי לשחזור מלא',
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

// ---------- גיבוי לגוגל שיטס ----------

const NEVER = 'עדיין לא סונכרן';

async function sheetsSection() {
  const st = await sheets.status();

  if (!st.connected) {
    return section(
      'גיבוי לגוגל שיטס',
      'אפשר לחבר גיליון גוגל משלך, והאפליקציה תעדכן אותו לבד בכל פתיחה ויציאה. ההתקנה נעשית פעם אחת ממחשב, ואורכת כחמש דקות. הגיבוי לקובץ ממשיך לעבוד בלי קשר.',
      [el('button', {
        class: 'btn btn-secondary btn-block', text: 'הגדרת חיבור',
        onClick: () => openSheetsWizard(),
      })],
    );
  }

  const when = st.lastSyncAt
    ? new Intl.DateTimeFormat('he-IL', { dateStyle: 'short', timeStyle: 'short' })
        .format(new Date(st.lastSyncAt))
    : NEVER;

  return section(
    'גיבוי לגוגל שיטס',
    'הגיליון מתעדכן לבד. הסנכרון חד-כיווני: מה שנכתב בגיליון מתוך גוגל יידרס בעדכון הבא.',
    [
      el('div', { class: 'row' }, [
        el('span', { class: 'grow', text: 'סונכרן לאחרונה' }),
        el('span', { class: 'sub', text: when }),
      ]),
      st.dirty
        ? el('div', { class: 'row' }, [
            el('span', { class: 'grow', text: 'ממתין לשליחה' }),
            el('span', { class: 'sub', text: 'יש שינויים שטרם נשלחו' }),
          ])
        : null,
      // שגיאה מוצגת כאן ולא כהודעה קופצת — כישלון רשת חוזר לא אמור להטריד
      // מישהו באמצע רישום הוצאה.
      st.lastError
        ? el('p', { class: 'wizard-warn', style: 'margin-block-start:8px', text: st.lastError })
        : null,
      el('div', { style: 'display:flex; gap:8px; margin-block-start:8px' }, [
        el('button', { class: 'btn btn-secondary btn-block', html: `${icon('refresh')}<span>סנכרן עכשיו</span>`,
          onClick: async () => {
            const res = await sheets.syncNow();
            if (res.ok) toast('הגיליון עודכן', 'success');
            else toast(res.error || res.skipped || 'הסנכרון נכשל', 'error');
            refresh();
          } }),
        el('button', { class: 'btn btn-danger', text: 'נתק',
          onClick: async () => {
            const ok = await confirmDanger({
              title: 'לנתק את הגיליון?',
              body: 'האפליקציה תפסיק לעדכן אותו. הגיליון עצמו וכל מה שכבר נשמר בו יישארו בגוגל כפי שהם.',
              confirmLabel: 'נתק',
            });
            if (!ok) return;
            await sheets.disconnect();
            toast('הגיליון נותק', 'success');
            refresh();
          } }),
      ]),
    ],
  );
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
  host.append(el('p', { class: 'sub', style: 'margin:0 0 12px',
    text: 'לחיצה על כרטיס פותחת את הסיכום שלו. הטיול הפעיל הוא זה שכל שאר המסכים מציגים.' }));
  for (const t of all) host.append(tripCard(t, totals.get(t.id), t.id === tripId));
  host.append(el('button', {
    class: 'btn btn-primary btn-hero card-gap',
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
    host.append(section(
      'קטגוריות',
      'הקטגוריות של הטיול הזה בלבד. כל הוצאה משויכת לאחת מהן, וכך נבנה פילוח הסיכום.',
      [...cats.map(c => el('div', { class: 'row' }, [
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
      })],
    ));

    host.append(section(
      'ייצוא וייבוא אקסל',
      'קובץ מעוצב עם 4 גיליונות: סיכום, מסלול, תקציב, הוצאות. הייבוא מחליף את המסלול וההוצאות של הטיול הזה בלבד.',
      [el('div', { style: 'display:flex; gap:8px' }, [
        el('button', { class: 'btn btn-secondary btn-block', html: `${icon('download')}<span>ייצוא</span>`,
          onClick: () => exportExcel(trip) }),
        el('button', { class: 'btn btn-tertiary btn-block', html: `${icon('share')}<span>ייבוא</span>`,
          onClick: () => importExcel(trip) }),
      ])],
    ));
  }

  host.append(importedSection(await imported.list()));
  host.append(await hiddenCatalogSection());

  host.append(section(
    'גיבוי ושחזור',
    'האפליקציה מבקשת מהדפדפן לא למחוק את הנתונים לבד, וכל כמה שבועות מזכירה לגבות לקובץ. גיבוי בלחיצת כפתור תמיד זמין כאן. גיבוי של טיול בודד אינו כולל מטבעות ושערים, שהם של המכשיר ולא של הטיול.',
    [
      el('div', { style: 'display:flex; gap:8px' }, [
        el('button', { class: 'btn btn-secondary btn-block', html: `${icon('share')}<span>גבה הכול</span>`,
          onClick: () => runBackup() }),
        el('button', { class: 'btn btn-danger btn-block', html: `${icon('refresh')}<span>שחזור מקובץ</span>`,
          onClick: runRestore }),
      ]),
      trip
        ? el('button', {
            class: 'btn btn-tertiary btn-block', style: 'margin-block-start:8px',
            html: `${icon('download')}<span>גבה רק את "${trip.name}"</span>`,
            onClick: () => runBackup(trip.id),
          })
        : null,
    ],
  ));

  host.append(section('מה אפשר לעשות כאן', INTRO_LEAD, [introPoints()]));

  host.append(await sheetsSection());

  host.append(section(
    'מחיקת כל הנתונים',
    'מוחק את כל הטיולים, ההוצאות והשערים מהמכשיר הזה. הקטלוג נשאר.',
    [el('button', {
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
    })],
  ));
}
