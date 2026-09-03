import * as trips from '../trips.js';
import * as money from '../money.js';
import { el, card, toast, fmtMoney, fmtDate } from '../ui.js';

let chartInstance = null;

function renderPie(canvas, rows) {
  if (!window.Chart) return;
  if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
  chartInstance = new window.Chart(canvas, {
    type: 'pie',
    data: {
      labels: rows.map(r => r.name),
      datasets: [{ data: rows.map(r => r.amount), backgroundColor: rows.map(r => r.color) }],
    },
    options: {
      plugins: { legend: { position: 'bottom', labels: { color: '#000' } } },
      responsive: true,
    },
  });
}

export async function mount(host, tripId) {
  if (!tripId) {
    host.append(card([el('div', { class: 'dim', text: 'צרו טיול כדי לראות סיכום.' })], 'card-gap'));
    return;
  }

  const migrated = await money.migrateMissingRates(tripId);
  if (migrated.fixed) {
    toast(`הושלם שער עבור ${migrated.fixed} פריטים ישנים`, 'success');
  }

  const [trip] = (await trips.listTrips()).filter(t => t.id === tripId);
  const homeCurrency = trip?.homeCurrency || 'ILS';
  const sum = await money.summary(tripId);

  host.append(card([
    el('div', { style: 'font-weight:700; margin-block-end:8px', text: 'סיכום כספי' }),
    el('div', { style: 'display:flex; justify-content:space-between' }, [
      el('span', { class: 'dim', text: 'מתוכנן' }),
      el('span', { class: 'num', text: fmtMoney(sum.totalPlanned, homeCurrency) }),
    ]),
    el('div', { style: 'display:flex; justify-content:space-between; margin-block-start:4px' }, [
      el('span', { class: 'dim', text: 'שולם בפועל' }),
      el('span', { class: 'num', text: fmtMoney(sum.totalPaid, homeCurrency) }),
    ]),
    el('div', { style: 'display:flex; justify-content:space-between; margin-block-start:4px; font-weight:700' }, [
      el('span', { text: 'יתרה מהתקציב' }),
      el('span', {
        class: 'num',
        style: sum.balance < 0 ? 'color:var(--color-danger)' : '',
        text: fmtMoney(sum.balance, homeCurrency),
      }),
    ]),
  ], 'card-gap'));

  if (sum.byCategory.length) {
    const canvas = el('canvas', { style: 'max-height:260px' });
    host.append(card([
      el('div', { style: 'font-weight:700; margin-block-end:8px', text: 'חלוקה לפי קטגוריה' }),
      canvas,
    ], 'card-gap'));
    renderPie(canvas, sum.byCategory);
  }

  if (sum.byMethod.length) {
    const labels = { cash: 'מזומן', credit: 'אשראי', transfer: 'העברה' };
    host.append(card([
      el('div', { style: 'font-weight:700; margin-block-end:8px', text: 'מזומן מול אשראי' }),
      ...sum.byMethod.map(m => el('div', {
        class: 'hairline', style: 'display:flex; justify-content:space-between; padding-block:8px',
      }, [
        el('span', { text: labels[m.method] || m.method }),
        el('span', { class: 'num', text: fmtMoney(m.amount, homeCurrency) }),
      ])),
    ], 'card-gap'));
  }

  if (sum.bigTransactions.length) {
    host.append(card([
      el('div', { style: 'font-weight:700; margin-block-end:8px', text: 'העסקאות הגדולות' }),
      ...sum.bigTransactions.map(tx => el('div', {
        class: 'hairline', style: 'display:flex; justify-content:space-between; padding-block:8px',
      }, [
        el('span', { style: 'flex:1; overflow-wrap:anywhere' }, [
          el('div', { text: tx.title }),
          el('div', { class: 'dim', style: 'font-size:13px', text: fmtDate(tx.date) }),
        ]),
        el('span', { class: 'num', style: 'font-weight:700', text: fmtMoney(tx.amount, homeCurrency) }),
      ])),
    ], 'card-gap'));
  }

  if (!sum.byCategory.length && !sum.bigTransactions.length) {
    host.append(card([el('div', { class: 'dim', text: 'אין עדיין הוצאות לסיכום.' })], 'card-gap'));
  }
}
