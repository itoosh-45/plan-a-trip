import * as trips from '../trips.js';
import * as it from '../itinerary.js';
import * as expenses from '../expenses.js';
import * as money from '../money.js';
import * as cur from '../currencies.js';
import {
  el, card, sheet, toast, confirmDanger, icon, amountField, ilsNote, fmtMoney, fmtDate,
} from '../ui.js';
import { refresh } from '../app.js';

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

function walletCard(trip, balances, cashRows, cats, segs) {
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
      el('span', {
        class: 'num money', style: balances[code] < 0 ? 'color:var(--color-danger)' : null,
        text: fmtMoney(balances[code], code),
      }),
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
        el('span', { class: 'num', text: `−${fmtMoney(r.amount, r.currency)}` }),
      ]));
    }
  }

  return card(body, 'card-gap');
}

// ---------- המסך ----------

export async function mount(host, tripId) {
  if (!tripId) {
    host.append(card([
      el('div', { class: 'empty-title', text: 'אין עדיין טיול' }),
      el('div', { class: 'dim', text: 'פתחו את ההגדרות וצרו טיול כדי לעקוב אחרי הוצאות.' }),
    ], 'card-gap'));
    return;
  }

  const [trip, cats, segs, rows, totals] = await Promise.all([
    trips.getTrip(tripId),
    trips.categories(tripId),
    it.listSegments(tripId),
    expenses.list(tripId),
    money.tripTotals(tripId),
  ]);

  const cashRows = rows.filter(r => r.kind === 'cashSpend');
  host.append(walletCard(trip, totals.balances, cashRows, cats, segs));

  host.append(card([
    el('div', { style: 'display:flex; align-items:baseline; justify-content:space-between' }, [
      el('span', { class: 'dim', text: `סה"כ הוצאות (${rows.filter(r => r.kind !== 'cashSpend').length})` }),
      el('span', { class: 'num money-lg', text: fmtMoney(totals.total, trip.currency) }),
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
        el('span', { class: 'num money', text: fmtMoney(stat.amount, trip.currency) }),
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
            el('div', { class: 'num money', text: fmtMoney(r.amount, r.currency) }),
            ilsNote(r.amount, r.currency, r.rateToILS),
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
