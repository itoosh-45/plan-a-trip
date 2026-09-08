import * as trips from '../trips.js';
import * as it from '../itinerary.js';
import * as expenses from '../expenses.js';
import * as money from '../money.js';
import * as budgets from '../budgets.js';
import * as cur from '../currencies.js';
import * as rates from '../rates.js';
import {
  el, card, sheet, toast, confirmDanger, icon, amountField, ilsNote, ilsText, ilsPairNote,
  fmtMoney, fmtMoneyHtml, fmtDate,
} from '../ui.js';
import { refresh } from '../app.js';
import { noTripCard } from './no-trip.js';

let segmentFilter = '';
let walletOpen = false;

const KIND_LABEL = expenses.KINDS;

function catOf(cats, id) {
  return cats.find(c => c.id === id) || { name: 'ללא קטגוריה', color: '#8B95A1', icon: 'other' };
}

// ---------- טופס רשומה ----------

async function openExpenseSheet(trip, existing, kind = 'expense') {
  const [cats, segs, currencies] = await Promise.all([
    trips.categories(trip.id), it.listSegments(trip.id), cur.listActive(),
  ]);
  const defaultSegment = existing?.segmentId || await it.defaultSegmentId(trip.id);

  const amount = amountField({
    amount: existing?.amount,
    currency: existing?.currency || trip.currency,
    currencies,
  });
  const segment = el('select', { class: 'field' }, segs.map(s =>
    el('option', { value: s.id, selected: s.id === defaultSegment, text: s.city })));
  const category = el('select', { class: 'field' }, [
    el('option', { value: '', text: 'ללא קטגוריה' }),
    ...cats.map(c => el('option', { value: c.id, selected: existing?.categoryId === c.id, text: c.name })),
  ]);
  const note = el('input', {
    class: 'field', type: 'text', value: existing?.note || '', placeholder: 'פירוט קצר',
  });

  const row = (label, node) => el('div', { class: 'field-row' }, [
    el('label', { class: 'field-label', text: label }), node,
  ]);

  const titles = {
    expense: existing ? 'עריכת הוצאה' : 'הוצאה חדשה',
    withdraw: 'משיכת מזומן מכספומט',
    cashSpend: 'הוצאה במזומן',
  };
  const hints = {
    expense: 'נספרת במלואה בסך ההוצאות של הטיול.',
    withdraw: 'המשיכה היא ההוצאה: היא נספרת במלואה ונכנסת לארנק המזומן.',
    cashSpend: 'מקטינה את יתרת הארנק ואינה נספרת שוב — הכסף כבר נספר במשיכה.',
  };
  const activeKind = existing?.kind || kind;

  const s = sheet({
    title: titles[activeKind],
    body: el('div', {}, [
      row('סכום', amount.node),
      row('יעד או מקטע', segment),
      activeKind === 'withdraw' ? null : row('קטגוריה', category),
      row('פירוט', note),
      el('p', { class: 'sub', text: hints[activeKind] }),
    ]),
    actions: [
      existing
        ? el('button', { class: 'btn btn-danger btn-block', text: 'מחק', onClick: async () => {
            const ok = await confirmDanger({
              title: 'למחוק את הרשומה?', body: existing.note || KIND_LABEL[existing.kind], confirmLabel: 'מחק',
            });
            if (!ok) return;
            await expenses.removeExpense(trip.id, existing.id);
            toast('נמחק', 'success');
            s.close();
            refresh();
          } })
        : el('button', { class: 'btn btn-tertiary btn-block', text: 'ביטול', onClick: () => s.close() }),
      el('button', { class: 'btn btn-primary btn-block', text: 'שמור', onClick: async () => {
        try {
          const value = amount.read();
          const saved = await expenses.saveExpense(trip.id, {
            ...existing,
            kind: activeKind,
            amount: value.amount ?? 0,
            currency: value.currency,
            segmentId: segment.value,
            categoryId: activeKind === 'withdraw' ? undefined : (category.value || undefined),
            note: note.value || undefined,
          });
          if (saved.overdrawn) toast('שימו לב: ההוצאה גדולה מיתרת המזומן בארנק', 'warning');
          else toast('נשמר', 'success');
          s.close();
          refresh();
        } catch (err) { toast(err.message, 'error'); }
      } }),
    ],
  });
}

// ---------- ווידג׳ט ארנק ----------

function walletCard(trip, balances, cashRows, cats, segs, fx) {
  const codes = Object.keys(balances);
  const body = [
    el('div', { style: 'display:flex; align-items:center; gap:8px' }, [
      el('span', { class: 'cat-icon', html: icon('wallet'),
        style: 'background:var(--color-surface-2); color:var(--color-accent)' }),
      el('div', { class: 'grow' }, [
        el('div', { class: 'row-title', text: 'ארנק מזומן' }),
        el('div', { class: 'sub', text: codes.length ? 'יתרה לכל מטבע' : 'עדיין לא נמשך מזומן' }),
      ]),
      el('button', {
        class: 'btn btn-quiet', 'aria-label': 'הוצאה במזומן', html: icon('plus'),
        onClick: () => openExpenseSheet(trip, null, 'cashSpend'),
      }),
    ]),
  ];

  for (const code of codes) {
    body.push(el('div', { class: 'row' }, [
      el('span', { class: 'grow', text: code }),
      el('span', { style: 'text-align:end' }, [
        el('div', {
          class: 'num money', style: balances[code] < 0 ? 'color:var(--color-danger)' : null,
          html: fmtMoneyHtml(balances[code], code),
        }),
        ilsNote(balances[code], code, fx[code]),
      ]),
    ]));
  }

  body.push(el('div', { style: 'display:flex; gap:8px; margin-block-start:12px' }, [
    el('button', {
      class: 'btn btn-secondary btn-block', html: `${icon('cash')}<span>משיכת מזומן</span>`,
      onClick: () => openExpenseSheet(trip, null, 'withdraw'),
    }),
    cashRows.length
      ? el('button', {
          class: 'btn btn-tertiary', text: walletOpen ? 'הסתר פירוט' : `פירוט (${cashRows.length})`,
          onClick: () => { walletOpen = !walletOpen; refresh(); },
        })
      : null,
  ]));

  if (walletOpen) {
    for (const r of cashRows) {
      const c = catOf(cats, r.categoryId);
      body.push(el('button', {
        class: 'row', style: 'width:100%; background:none; border:0; text-align:start; cursor:pointer; font:inherit; color:inherit',
        onClick: () => openExpenseSheet(trip, r),
      }, [
        el('span', { class: 'cat-icon', html: icon(c.icon || 'other'),
          style: `background:color-mix(in srgb, ${c.color} 14%, transparent); color:${c.color}` }),
        el('span', { class: 'grow' }, [
          el('span', { style: 'display:block', text: r.note || 'הוצאה במזומן' }),
          el('span', { class: 'sub',
            text: `${c.name} · ${segs.find(sg => sg.id === r.segmentId)?.city || 'כללי'} · ${fmtDate(r.date)}` }),
        ]),
        el('span', { style: 'text-align:end' }, [
          el('div', { class: 'num', html: `−${fmtMoneyHtml(r.amount, r.currency)}` }),
          ilsNote(r.amount, r.currency, r.rateToILS || fx[r.currency]),
        ]),
      ]));
    }
  }

  return card(body, 'card-gap');
}

// ---------- תכנון תקציב לפי קטגוריה ----------

/**
 * הזנת תקציב לקטגוריה. סך התקציבים אינו רשאי לעבור בשקט את תקציב הטיול:
 * חריגה שואלת אם להגדיל אותו, ואם מסרבים — התקציב נשמר בכל זאת ומסומן.
 */
async function openBudgetSheet(trip, summary, row) {
  const amount = el('input', {
    class: 'field', type: 'number', inputmode: 'decimal', step: '1',
    value: row.budget || '', 'aria-label': 'סכום התקציב',
  });

  const s = sheet({
    title: `תקציב ל${row.name}`,
    body: el('div', {}, [
      el('div', { class: 'field-row' }, [
        el('label', { class: 'field-label', text: `סכום (${cur.symbol(trip.currency)})` }),
        amount,
      ]),
      el('p', { class: 'sub',
        text: `שולם עד כה ${fmtMoney(row.spent || 0, trip.currency)}${
          row.planned ? ` · מתוכנן במסלול ${fmtMoney(row.planned, trip.currency)}` : ''}` }),
      el('p', { class: 'sub', text: 'סכום ריק או אפס מסיר את התקציב, והקטגוריה נשארת.' }),
    ]),
    actions: [
      row.budget > 0 && row.id
        ? el('button', { class: 'btn btn-danger btn-block', text: 'הסר קטגוריה', onClick: async () => {
            const ok = await confirmDanger({
              title: `להסיר את ${row.name} מהטיול?`,
              body: 'הקטגוריה תימחק מהטיול הזה יחד עם התקציב שלה. אפשר להחזיר אותה מ"הוסף תקציב".',
              confirmLabel: 'הסר',
            });
            if (!ok) return;
            try {
              await trips.removeCategory(trip.id, row.id);
              toast('הקטגוריה הוסרה', 'success');
              s.close();
              refresh();
            } catch (err) { toast(err.message, 'error'); }
          } })
        : el('button', { class: 'btn btn-tertiary btn-block', text: 'ביטול', onClick: () => s.close() }),
      el('button', { class: 'btn btn-primary btn-block', text: 'שמור', onClick: async () => {
        try {
          const value = amount.value === '' ? 0 : Number(amount.value);
          const others = (summary.budgeted || 0) - (row.budget || 0);
          const projected = Math.round((others + value) * 100) / 100;

          await budgets.setBudget(trip.id, row.id, value, trip.currency);

          if (summary.ceiling > 0 && projected > summary.ceiling) {
            const raise = await confirmDanger({
              title: 'סך התקציבים עובר את תקציב הטיול',
              body: `סך התקציבים לקטגוריות הוא ${fmtMoney(projected, trip.currency)}, ותקציב הטיול הוא `
                + `${fmtMoney(summary.ceiling, trip.currency)}. להגדיל את תקציב הטיול ל-${fmtMoney(projected, trip.currency)}?`,
              confirmLabel: 'הגדל תקציב',
              confirmClass: 'btn-primary',
            });
            if (raise) await trips.updateTrip({ ...trip, totalBudget: projected });
            else toast('התקציב נשמר, וסך התקציבים עובר את תקציב הטיול', 'warning');
          } else {
            toast('התקציב נשמר', 'success');
          }
          s.close();
          refresh();
        } catch (err) { toast(err.message, 'error'); }
      } }),
    ],
  });
}

/** בחירת קטגוריה לתקציב חדש: קיימות, דיפולט שהוסרו, או קטגוריה בשם חופשי. */
async function openAddBudgetSheet(trip, summary) {
  const taken = new Set(summary.rows.map(r => r.id));
  const [cats, missing] = await Promise.all([
    trips.categories(trip.id),
    trips.missingDefaultCategories(trip.id),
  ]);
  const free = cats.filter(c => !taken.has(c.id));
  const name = el('input', { class: 'field', type: 'text', placeholder: 'למשל: ביטוח' });

  const pick = row => { s.close(); openBudgetSheet(trip, summary, row); };

  const s = sheet({
    title: 'הוספת תקציב',
    body: el('div', {}, [
      free.length
        ? el('div', {}, free.map(c => el('button', {
            class: 'row', style: 'width:100%; background:none; border:0; text-align:start; cursor:pointer; font:inherit; color:inherit',
            onClick: () => pick({ id: c.id, name: c.name, budget: 0, spent: 0, planned: 0 }),
          }, [
            el('span', { class: 'cat-icon', html: icon(c.icon || 'other'),
              style: `background:color-mix(in srgb, ${c.color} 14%, transparent); color:${c.color}` }),
            el('span', { class: 'grow', text: c.name }),
            el('span', { html: icon('plus'), style: 'color:var(--color-accent)' }),
          ])))
        : el('div', { class: 'sub', text: 'לכל הקטגוריות בטיול כבר יש תקציב.' }),

      missing.length
        ? el('div', {}, [
            el('div', { class: 'cat-head', style: 'display:flex', text: 'קטגוריות שהוסרו' }),
            ...missing.map(d => el('button', {
              class: 'row', style: 'width:100%; background:none; border:0; text-align:start; cursor:pointer; font:inherit; color:inherit',
              onClick: async () => {
                try {
                  const restored = await trips.restoreDefaultCategory(trip.id, d.key);
                  toast(`${d.name} הוחזרה`, 'success');
                  pick({ id: restored.id, name: restored.name, budget: 0, spent: 0, planned: 0 });
                } catch (err) { toast(err.message, 'error'); }
              },
            }, [
              el('span', { class: 'cat-icon', html: icon(d.icon),
                style: `background:color-mix(in srgb, ${d.color} 14%, transparent); color:${d.color}` }),
              el('span', { class: 'grow', text: d.name }),
              el('span', { class: 'sub', text: 'החזר' }),
            ])),
          ])
        : null,

      el('div', { class: 'cat-head', style: 'display:flex', text: 'קטגוריה חדשה' }),
      el('div', { style: 'display:flex; gap:8px' }, [
        name,
        el('button', { class: 'btn btn-secondary', text: 'צור', onClick: async () => {
          try {
            const created = await trips.addCategory(trip.id, name.value);
            toast('הקטגוריה נוצרה', 'success');
            pick({ id: created.id, name: created.name, budget: 0, spent: 0, planned: 0 });
          } catch (err) { toast(err.message, 'error'); }
        } }),
      ]),
    ]),
    actions: [
      el('button', { class: 'btn btn-tertiary btn-block', text: 'סגור', onClick: () => s.close() }),
    ],
  });
}

function budgetCard(trip, summary, rate) {
  const c = trip.currency;
  const pct = summary.ceiling
    ? Math.min(Math.round((summary.budgeted / summary.ceiling) * 100), 100)
    : 0;

  const body = [
    el('div', { style: 'display:flex; align-items:baseline; gap:8px' }, [
      el('span', { class: 'grow card-title', style: 'margin:0', text: 'תכנון תקציב' }),
      el('span', { style: 'text-align:end' }, [
        el('div', { class: 'sub', style: 'margin:0' }, summary.ceiling
          ? [
              el('span', { class: 'num', html: fmtMoneyHtml(summary.budgeted, c) }),
              ' מתוך ',
              el('span', { class: 'num', html: fmtMoneyHtml(summary.ceiling, c) }),
            ]
          : [el('span', { class: 'num', html: fmtMoneyHtml(summary.budgeted, c) })]),
        ilsPairNote(summary.budgeted, summary.ceiling, c, rate),
      ]),
    ]),
    summary.ceiling
      ? el('div', { class: 'bar', style: 'margin-block-start:8px' }, [
          el('span', { class: summary.over ? 'over' : '', style: `width:${summary.over ? 100 : pct}%` }),
        ])
      : null,
    summary.over
      ? el('div', { class: 'toast warning', style: 'margin-block-start:12px',
          text: `סך התקציבים עובר את תקציב הטיול ב-${fmtMoney(summary.overBy, c)}.` })
      : null,
  ];

  for (const r of summary.rows) {
    const rowPct = r.budget ? Math.min(Math.round((r.spent / r.budget) * 100), 100) : 0;
    body.push(el('div', { style: 'padding-block-start:10px' }, [
      el('button', {
        class: 'row', style: 'width:100%; background:none; border:0; text-align:start; cursor:pointer; font:inherit; color:inherit',
        onClick: () => openBudgetSheet(trip, summary, r),
      }, [
        el('span', { class: 'cat-icon', html: icon(r.icon || 'other'),
          style: `background:color-mix(in srgb, ${r.color} 14%, transparent); color:${r.color}` }),
        el('span', { class: 'grow' }, [
          el('span', { style: 'display:block', text: r.name }),
          el('span', { class: 'sub', html: `שולם ${fmtMoneyHtml(r.spent, c)}${
            r.planned ? ` · מתוכנן במסלול ${fmtMoneyHtml(r.planned, c)}` : ''}${
            ilsText(r.spent, c, rate) ? ` · ${ilsText(r.spent, c, rate)}` : ''}` }),
        ]),
        el('span', { style: 'text-align:end' }, [
          el('div', { class: 'num money', html: fmtMoneyHtml(r.budget, c) }),
          ilsNote(r.budget, c, rate),
          el('div', { class: `pill ${r.over ? 'over' : 'ok'}`,
            text: r.over ? `חריגה של ${fmtMoney(-r.remaining, c)}` : `נותרו ${fmtMoney(r.remaining, c)}` }),
        ]),
      ]),
      el('div', { class: 'bar' }, [
        el('span', { class: r.over ? 'over' : '', style: `width:${r.over ? 100 : rowPct}%` }),
      ]),
    ]));
  }

  if (!summary.rows.length) {
    body.push(el('div', { class: 'sub', style: 'padding-block:10px',
      text: 'עדיין לא תוכנן תקציב. אפשר להזין תקציב לכל קטגוריה ולעקוב מולו לאורך הטיול.' }));
  }

  body.push(el('button', {
    class: 'btn btn-secondary btn-block', style: 'margin-block-start:12px',
    html: `${icon('plus')}<span>הוסף תקציב</span>`,
    onClick: () => openAddBudgetSheet(trip, summary),
  }));

  if (summary.cashInWallet) {
    body.push(el('div', { class: 'sub', style: 'margin-block-start:8px',
      text: 'מזומן שנמשך ועדיין לא הוצא אינו משויך לקטגוריה, ולכן הוא אינו נספר בשורות שלמעלה.' }));
  }

  return card(body, 'card-gap');
}

// ---------- המסך ----------

export async function mount(host, tripId) {
  if (!tripId) {
    host.append(noTripCard('שחזרו גיבוי קיים או פתחו טיול חדש כדי לעקוב אחרי הוצאות.'));
    return;
  }

  const [trip, cats, segs, rows, totals, budgetSummary] = await Promise.all([
    trips.getTrip(tripId),
    trips.categories(tripId),
    it.listSegments(tripId),
    expenses.list(tripId),
    money.tripTotals(tripId),
    money.budgetByCategory(tripId),
  ]);

  // שערי התצוגה: מטבע הטיול, מטבעות הארנק, ומטבע של כל רשומה שאין לה שער צרוב
  const fx = await rates.rateMap([
    trip.currency, ...Object.keys(totals.balances), ...rows.map(r => r.currency),
  ]);
  const tripRate = fx[(trip.currency || 'ILS').toUpperCase()];

  const cashRows = rows.filter(r => r.kind === 'cashSpend');
  host.append(walletCard(trip, totals.balances, cashRows, cats, segs, fx));
  host.append(budgetCard(trip, budgetSummary, tripRate));

  host.append(card([
    el('div', { style: 'display:flex; align-items:baseline; justify-content:space-between' }, [
      el('span', { class: 'dim', text: `סה"כ הוצאות (${rows.filter(r => r.kind !== 'cashSpend').length})` }),
      el('span', { style: 'text-align:end' }, [
        el('div', { class: 'num money-lg', html: fmtMoneyHtml(totals.total, trip.currency) }),
        ilsNote(totals.total, trip.currency, tripRate),
      ]),
    ]),
  ], 'card-gap'));

  host.append(el('div', { class: 'card-gap', style: 'display:flex; gap:8px; overflow-x:auto; padding-block:4px' }, [
    el('button', {
      class: 'chip', 'aria-pressed': String(!segmentFilter), text: 'כל היעדים',
      onClick: () => { segmentFilter = ''; refresh(); },
    }),
    ...segs.map(sg => el('button', {
      class: 'chip', 'aria-pressed': String(segmentFilter === sg.id), text: sg.city,
      onClick: () => { segmentFilter = segmentFilter === sg.id ? '' : sg.id; refresh(); },
    })),
  ]));

  const visible = segs.filter(sg => !segmentFilter || sg.id === segmentFilter);
  let shown = 0;

  for (const seg of visible) {
    const group = rows.filter(r => r.segmentId === seg.id && r.kind !== 'cashSpend');
    if (!group.length) continue;
    shown += group.length;
    const stat = totals.bySegment.find(x => x.id === seg.id) || { amount: 0, allocation: 0, over: false };

    host.append(card([
      el('div', { style: 'display:flex; align-items:center; gap:8px; margin-block-end:4px' }, [
        el('span', { class: 'grow row-title', text: seg.city }),
        el('span', { style: 'text-align:end' }, [
          el('div', { class: 'num money', html: fmtMoneyHtml(stat.amount, trip.currency) }),
          ilsNote(stat.amount, trip.currency, tripRate),
        ]),
      ]),
      stat.allocation
        ? el('div', { class: 'sub' }, [
            el('span', { class: `pill ${stat.over ? 'over' : 'ok'}`,
              text: stat.over
                ? `חריגה של ${fmtMoney(-stat.remaining, trip.currency)}`
                : `נותרו ${fmtMoney(stat.remaining, trip.currency)}` }),
          ])
        : null,
      ...group.map(r => {
        const c = catOf(cats, r.categoryId);
        return el('button', {
          class: 'row', style: 'width:100%; background:none; border:0; text-align:start; cursor:pointer; font:inherit; color:inherit',
          onClick: () => openExpenseSheet(trip, r),
        }, [
          el('span', {
            class: 'cat-icon', html: icon(r.kind === 'withdraw' ? 'cash' : (c.icon || 'other')),
            style: `background:color-mix(in srgb, ${c.color} 14%, transparent); color:${c.color}`,
          }),
          el('span', { class: 'grow' }, [
            el('span', { style: 'display:block', text: r.note || KIND_LABEL[r.kind] }),
            el('span', { class: 'sub',
              text: `${r.kind === 'withdraw' ? KIND_LABEL.withdraw : c.name} · ${fmtDate(r.date)}` }),
          ]),
          el('span', { style: 'text-align:end' }, [
            el('div', { class: 'num money', html: fmtMoneyHtml(r.amount, r.currency) }),
            ilsNote(r.amount, r.currency, r.rateToILS || fx[r.currency]),
          ]),
        ]);
      }),
    ], 'card-gap'));
  }

  if (!shown) {
    host.append(card([el('div', { class: 'dim', text: 'אין עדיין הוצאות להצגה.' })], 'card-gap'));
  }

  host.append(el('button', {
    class: 'btn btn-primary fab', 'aria-label': 'הוסף הוצאה',
    html: `${icon('plus')}<span>הוצאה</span>`,
    onClick: () => openExpenseSheet(trip, null, 'expense'),
  }));
}
