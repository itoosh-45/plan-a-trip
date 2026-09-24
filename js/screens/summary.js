import * as trips from '../trips.js';
import * as money from '../money.js';
import { el, card, icon, fmtMoney, fmtDateRange } from '../ui.js';

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

function statTile(label, value, tone = '') {
  return el('div', {
    style: `flex:1; min-width:0; padding:12px; border-radius:var(--radius-control);
            background:${tone || 'var(--color-surface-2)'}`,
  }, [
    el('div', { class: 'sub', style: 'margin:0', text: label }),
    el('div', { class: 'num stat-value', text: value }),
  ]);
}

export async function mount(host, tripId) {
  if (!tripId) {
    host.append(card([
      el('div', { class: 'empty-title', text: 'אין עדיין טיול' }),
      el('div', { class: 'dim', text: 'פתחו את ההגדרות וצרו טיול כדי לראות סיכום.' }),
    ], 'card-gap'));
    return;
  }

  const [trip, sum, planned] = await Promise.all([
    trips.getTrip(tripId), money.tripTotals(tripId), money.plannedTotal(tripId),
  ]);
  const c = trip.currency;

  host.append(card([
    el('div', { class: 'screen-title', text: trip.name }),
    trip.startDate
      ? el('div', { class: 'sub', text: fmtDateRange(trip.startDate, trip.endDate) })
      : null,
    el('div', { style: 'display:flex; gap:8px; margin-block-start:12px' }, [
      statTile('סך הוצאות', fmtMoney(sum.total, c)),
      statTile(
        sum.overCeiling ? 'חריגה מהתקרה' : 'נותר מהתקרה',
        fmtMoney(Math.abs(sum.remaining), c),
        sum.overCeiling
          ? 'color-mix(in srgb, var(--color-danger) 12%, transparent)'
          : 'color-mix(in srgb, var(--color-success) 12%, transparent)',
      ),
    ]),
    el('div', { style: 'display:flex; gap:8px; margin-block-start:8px' }, [
      statTile('מתוכנן במסלול', fmtMoney(planned, c)),
      statTile('מזומן בארנק', fmtMoney(sum.cashInWallet, c)),
    ]),
  ], 'card-gap'));

  if (sum.byCategory.length) {
    const canvas = el('canvas', { style: 'max-height:220px' });
    host.append(card([
      el('div', { class: 'card-title', text: 'פילוח לפי קטגוריה' }),
      canvas,
      ...sum.byCategory.map(row => el('div', { class: 'row' }, [
        el('span', { class: 'swatch', style: `background:${row.color}` }),
        el('span', { class: 'grow' }, [
          el('span', { style: 'display:block', text: row.name }),
          el('span', { class: 'sub',
            text: `${Math.round((row.amount / (sum.total || 1)) * 100)}% מסך ההוצאות` }),
        ]),
        el('span', { class: 'num money', text: fmtMoney(row.amount, c) }),
      ])),
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
          el('span', { class: 'num', text: fmtMoney(seg.amount, c) }),
          el('span', { class: 'num',
            text: seg.allocation ? `מתוך ${fmtMoney(seg.allocation, c)}` : '' }),
        ]),
      ]);
    }),
  ], 'card-gap'));

  host.append(card([
    el('div', { class: 'card-title', text: 'תקציב' }),
    el('div', { class: 'row' }, [
      el('span', { class: 'grow dim', text: 'תקרה' }),
      el('span', { class: 'num', text: fmtMoney(sum.ceiling, c) }),
    ]),
    el('div', { class: 'row' }, [
      el('span', { class: 'grow dim', text: 'הוקצה ליעדים' }),
      el('span', { class: 'num', text: fmtMoney(sum.allocated, c) }),
    ]),
    el('div', { class: 'row' }, [
      el('span', { class: 'grow dim', text: 'לא הוקצה' }),
      el('span', { class: 'num', text: fmtMoney(sum.unallocated, c) }),
    ]),
    sum.overCeiling
      ? el('div', { class: 'toast error', style: 'margin-block-start:12px' }, [
          el('span', { html: icon('alert') }),
          el('span', { text: ` ההוצאות עברו את התקרה ב-${fmtMoney(-sum.remaining, c)}` }),
        ])
      : null,
  ], 'card-gap'));
}
