import * as budget from '../budget.js';
import * as trips from '../trips.js';
import { el, card, sheet, toast, fmtMoney } from '../ui.js';
import { refresh } from '../app.js';

function openPlannedSheet(tripId, row, homeCurrency) {
  const amount = el('input', { class: 'field', type: 'number', inputmode: 'decimal', step: '0.01', value: row.planned || '' });
  const s = sheet({
    title: `תקציב ל${row.name}`,
    body: el('div', { class: 'field-row' }, [
      el('label', { class: 'field-label', text: `סכום מתוכנן (${homeCurrency})` }),
      amount,
    ]),
    actions: [
      el('button', { class: 'btn btn-tertiary btn-block', text: 'ביטול', onClick: () => s.close() }),
      el('button', { class: 'btn btn-primary btn-block', text: 'שמור', onClick: async () => {
        try {
          await budget.setPlanned(tripId, row.categoryId, amount.value);
          toast('התקציב נשמר', 'success');
          s.close();
          refresh();
        } catch (err) { toast(err.message, 'error'); }
      } }),
    ],
  });
}

export async function mount(host, tripId) {
  if (!tripId) {
    host.append(card([el('div', { class: 'dim', text: 'צרו טיול במסך ההגדרות כדי להגדיר תקציב.' })], 'card-gap'));
    return;
  }

  const [trip] = (await trips.listTrips()).filter(t => t.id === tripId);
  const homeCurrency = trip?.homeCurrency || 'ILS';
  const rows = await budget.rows(tripId);

  const totalPlanned = budget.round2(rows.reduce((s, r) => s + r.planned, 0));
  const totalActual = budget.round2(rows.reduce((s, r) => s + r.actual, 0));

  host.append(card([
    el('div', { style: 'display:flex; justify-content:space-between; font-weight:700', text: '' }, [
      el('span', { text: 'סה"כ מתוכנן מול בפועל' }),
    ]),
    el('div', { style: 'display:flex; justify-content:space-between; margin-block-start:8px' }, [
      el('span', { class: 'num', text: fmtMoney(totalPlanned, homeCurrency) }),
      el('span', { class: 'num', style: 'color:var(--color-text-dim)', text: fmtMoney(totalActual, homeCurrency) }),
    ]),
  ], 'card-gap'));

  for (const row of rows) {
    host.append(card([
      el('button', {
        style: 'width:100%; background:none; border:0; padding:0; text-align:start; cursor:pointer; min-height:44px',
        onClick: () => openPlannedSheet(tripId, row, homeCurrency),
      }, [
        el('div', { style: 'display:flex; align-items:center; gap:8px' }, [
          el('span', { style: `width:12px; height:12px; border-radius:3px; background:${row.color}` }),
          el('span', { style: 'flex:1; font-weight:700', text: row.name }),
          el('span', { class: 'num', text: fmtMoney(row.actual, homeCurrency) }),
        ]),
        el('div', { class: 'bar', style: 'margin-block-start:8px' }, [
          el('span', {
            class: row.barClass,
            style: `width:${Math.min(row.pct ?? (row.actual ? 100 : 0), 100)}%`,
          }),
        ]),
        el('div', { class: 'dim', style: 'font-size:13px; margin-block-start:6px' , text:
          row.pct === null
            ? 'לא הוגדר תקציב לקטגוריה זו'
            : `${row.pct}% · יתרה ${fmtMoney(row.remaining, homeCurrency)}`,
        }),
      ]),
    ], 'card-gap'));
  }
}
