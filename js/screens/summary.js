import * as trips from '../trips.js';
import * as money from '../money.js';
import * as rates from '../rates.js';
import { el, card, icon, ilsNote, ilsText, ilsPairNote, fmtMoney, fmtMoneyHtml, fmtDateRange } from '../ui.js';
import { noTripCard } from './no-trip.js';

let chartInstance = null;

function renderPie(canvas, rows) {
  if (!window.Chart) return;
  if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
  chartInstance = new window.Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: rows.map(r => r.name),
      datasets: [{ data: rows.map(r => r.amount), backgroundColor: rows.map(r => r.color), borderWidth: 0 }],
    },
    options: {
      cutout: '58%',
      plugins: { legend: { display: false } },
      responsive: true,
    },
  });
}

function statTile(label, value, tone = '', note = '') {
  return el('div', {
    style: `flex:1; min-width:0; padding:12px; border-radius:var(--radius-control);
            background:${tone || 'var(--color-surface-2)'}`,
  }, [
    el('div', { class: 'sub', style: 'margin:0', text: label }),
    el('div', { class: 'num stat-value', html: value }),
    note ? el('div', { class: 'sub num ils', text: note }) : null,
  ]);
}

export async function mount(host, tripId) {
  if (!tripId) {
    host.append(noTripCard('שחזרו גיבוי קיים או פתחו טיול חדש כדי לראות סיכום.'));
    return;
  }

  const [trip, sum, planned, budgetSummary] = await Promise.all([
    trips.getTrip(tripId), money.tripTotals(tripId), money.plannedTotal(tripId),
    money.budgetByCategory(tripId),
  ]);
  // תכנון התקציב נערך במסך ההוצאות. כאן הוא מוצג בלבד, לצד מה שבפועל.
  const budgetOf = new Map(budgetSummary.rows.map(r => [r.id, r]));
  const c = trip.currency;
  // כל הסכומים במסך הזה כבר מומרים למטבע הטיול, ולכן די בשער אחד
  const rate = (await rates.rateMap([c]))[(c || 'ILS').toUpperCase()];
  const ils = amount => ilsText(amount, c, rate);

  host.append(card([
    el('div', { class: 'screen-title', text: trip.name }),
    trip.startDate
      ? el('div', { class: 'sub', text: fmtDateRange(trip.startDate, trip.endDate) })
      : null,
    el('div', { style: 'display:flex; gap:8px; margin-block-start:12px' }, [
      statTile('סך הוצאות', fmtMoneyHtml(sum.total, c), '', ils(sum.total)),
      statTile(
        sum.overCeiling ? 'חריגה מהתקרה' : 'נותר מהתקרה',
        fmtMoneyHtml(Math.abs(sum.remaining), c),
        sum.overCeiling
          ? 'color-mix(in srgb, var(--color-danger) 12%, transparent)'
          : 'color-mix(in srgb, var(--color-success) 12%, transparent)',
        ils(Math.abs(sum.remaining)),
      ),
    ]),
    el('div', { style: 'display:flex; gap:8px; margin-block-start:8px' }, [
      statTile('מתוכנן במסלול', fmtMoneyHtml(planned, c), '', ils(planned)),
      statTile('מזומן בארנק', fmtMoneyHtml(sum.cashInWallet, c), '', ils(sum.cashInWallet)),
    ]),
  ], 'card-gap'));

  if (sum.byCategory.length) {
    const canvas = el('canvas', { style: 'max-height:220px' });
    host.append(card([
      el('div', { class: 'card-title', text: 'פילוח לפי קטגוריה' }),
      canvas,
      ...sum.byCategory.map(row => {
        const plan = budgetOf.get(row.id);
        return el('div', { class: 'row' }, [
          el('span', { class: 'swatch', style: `background:${row.color}` }),
          el('span', { class: 'grow' }, [
            el('span', { style: 'display:block', text: row.name }),
            el('span', { class: 'sub',
              text: `${Math.round((row.amount / (sum.total || 1)) * 100)}% מסך ההוצאות` }),
          ]),
          el('span', { style: 'text-align:end' }, [
            el('div', { class: 'num money', html: fmtMoneyHtml(row.amount, c) }),
            plan
              ? el('div', { class: 'sub' }, ['מתוך ', el('span', { class: 'num', html: fmtMoneyHtml(plan.budget, c) })])
              : null,
            ilsNote(row.amount, c, rate),
            plan && plan.over
              ? el('div', { class: 'pill over', text: `חריגה של ${fmtMoney(-plan.remaining, c)}` })
              : null,
          ]),
        ]);
      }),
      el('div', { class: 'sub', style: 'margin-block-start:8px',
        text: 'משיכות המזומן מתפרקות כאן לפי ההוצאות במזומן שנרשמו בפועל. מה שטרם הוצא מופיע כ"מזומן בארנק".' }),
    ], 'card-gap'));
    renderPie(canvas, sum.byCategory);
  }

  host.append(card([
    el('div', { class: 'card-title', text: 'הוצאות לפי יעד' }),
    ...sum.bySegment.map(seg => {
      const pct = seg.allocation ? Math.min(Math.round((seg.amount / seg.allocation) * 100), 100) : 0;
      return el('div', { style: 'padding-block:12px; border-block-start:1px solid var(--color-hairline)' }, [
        el('div', { style: 'display:flex; align-items:center; gap:8px' }, [
          el('span', { class: 'grow row-title', text: seg.city }),
          seg.allocation
            ? el('span', { class: `pill ${seg.over ? 'over' : 'ok'}`,
                text: seg.over ? 'חריגה' : 'בתקציב' })
            : el('span', { class: 'sub', text: 'ללא הקצאה' }),
        ]),
        el('div', { class: 'bar', style: 'margin-block-start:8px' }, [
          el('span', { class: seg.over ? 'over' : '', style: `width:${seg.over ? 100 : pct}%` }),
        ]),
        el('div', { class: 'sub', style: 'display:flex; justify-content:space-between; margin-block-start:6px' }, [
          el('span', { class: 'num', html: fmtMoneyHtml(seg.amount, c) }),
          seg.allocation
            ? el('span', {}, ['מתוך ', el('span', { class: 'num', html: fmtMoneyHtml(seg.allocation, c) })])
            : el('span', {}),
        ]),
        ilsPairNote(seg.amount, seg.allocation, c, rate),
      ]);
    }),
  ], 'card-gap'));

  host.append(card([
    el('div', { class: 'card-title', text: 'תקציב' }),
    el('div', { class: 'row' }, [
      el('span', { class: 'grow dim', text: 'תקרה' }),
      el('span', { style: 'text-align:end' }, [
        el('div', { class: 'num', html: fmtMoneyHtml(sum.ceiling, c) }),
        ilsNote(sum.ceiling, c, rate),
      ]),
    ]),
    el('div', { class: 'row' }, [
      el('span', { class: 'grow dim', text: 'הוקצה ליעדים' }),
      el('span', { style: 'text-align:end' }, [
        el('div', { class: 'num', html: fmtMoneyHtml(sum.allocated, c) }),
        ilsNote(sum.allocated, c, rate),
      ]),
    ]),
    el('div', { class: 'row' }, [
      el('span', { class: 'grow dim', text: 'לא הוקצה' }),
      el('span', { style: 'text-align:end' }, [
        el('div', { class: 'num', html: fmtMoneyHtml(sum.unallocated, c) }),
        ilsNote(sum.unallocated, c, rate),
      ]),
    ]),
    budgetSummary.budgeted
      ? el('div', { class: 'row' }, [
          el('span', { class: 'grow dim', text: 'מתוקצב לפי קטגוריות' }),
          el('span', { style: 'text-align:end' }, [
            el('div', { class: `num ${budgetSummary.over ? 'pill over' : ''}`.trim(),
              html: fmtMoneyHtml(budgetSummary.budgeted, c) }),
            ilsNote(budgetSummary.budgeted, c, rate),
          ]),
        ])
      : null,
    sum.overCeiling
      ? el('div', { class: 'toast error', style: 'margin-block-start:12px' }, [
          el('span', { html: icon('alert') }),
          el('span', { text: ` ההוצאות עברו את התקרה ב-${fmtMoney(-sum.remaining, c)}` }),
        ])
      : null,
  ], 'card-gap'));
}
