import * as db from '../db.js';
import * as trips from '../trips.js';
import * as expenses from '../expenses.js';
import * as wallet from '../wallet.js';
import { el, card, sheet, toast, confirmDanger, icon, fmtMoney, fmtDate } from '../ui.js';
import { refresh } from '../app.js';

let categoryFilter = '';

function openExpenseSheet(tripId, cats) {
  const amount = el('input', { class: 'field', type: 'number', inputmode: 'decimal', step: '0.01' });
  const currency = el('input', { class: 'field', type: 'text', maxlength: '3', style: 'text-transform:uppercase', value: 'ILS' });
  const date = el('input', { class: 'field', type: 'date', value: new Date().toISOString().slice(0, 10) });
  const category = el('select', { class: 'field' }, [
    el('option', { value: '', text: 'ללא קטגוריה' }),
    ...cats.map(c => el('option', { value: c.id, text: c.name })),
  ]);
  const method = el('select', { class: 'field' }, Object.entries(expenses.EXPENSE_METHOD).map(([k, v]) =>
    el('option', { value: k, selected: k === 'cash', text: v })));
  const note = el('input', { class: 'field', type: 'text', placeholder: 'הערה חופשית' });

  const row = (label, node) => el('div', { class: 'field-row' }, [el('label', { class: 'field-label', text: label }), node]);

  const s = sheet({
    title: 'הוצאה חדשה',
    body: el('div', {}, [
      row('סכום', amount), row('מטבע', currency), row('תאריך', date),
      row('קטגוריה', category), row('אמצעי תשלום', method), row('הערה', note),
    ]),
    actions: [
      el('button', { class: 'btn btn-tertiary btn-block', text: 'ביטול', onClick: () => s.close() }),
      el('button', { class: 'btn btn-primary btn-block', text: 'שמור', onClick: async () => {
        try {
          await expenses.saveExpense(tripId, {
            amount: amount.value, currency: currency.value, date: date.value,
            categoryId: category.value || undefined, method: method.value, note: note.value,
          });
          toast('ההוצאה נשמרה', 'success');
          s.close();
          refresh();
        } catch (err) { toast(err.message, 'error'); }
      } }),
    ],
  });
}

function openWalletSheet(tripId, active) {
  if (!active) {
    const currency = el('input', { class: 'field', type: 'text', maxlength: '3', style: 'text-transform:uppercase', value: 'ILS' });
    const s = sheet({
      title: 'פתיחת ארנק מזומן',
      body: el('div', { class: 'field-row' }, [el('label', { class: 'field-label', text: 'מטבע' }), currency]),
      actions: [
        el('button', { class: 'btn btn-tertiary btn-block', text: 'ביטול', onClick: () => s.close() }),
        el('button', { class: 'btn btn-primary btn-block', text: 'פתח ארנק', onClick: async () => {
          try {
            await wallet.open(tripId, currency.value);
            toast('הארנק נפתח', 'success');
            s.close();
            refresh();
          } catch (err) { toast(err.message, 'error'); }
        } }),
      ],
    });
    return;
  }

  const amount = el('input', { class: 'field', type: 'number', inputmode: 'decimal', step: '0.01' });
  const closeAmount = el('input', { class: 'field', type: 'number', inputmode: 'decimal', step: '0.01' });
  const newCurrency = el('input', { class: 'field', type: 'text', maxlength: '3', style: 'text-transform:uppercase' });

  const s = sheet({
    title: `ארנק ${active.currency}`,
    body: el('div', {}, [
      el('div', { class: 'field-row' }, [el('label', { class: 'field-label', text: `הפקדה/הוצאה (${active.currency})` }), amount]),
      el('div', { style: 'display:flex; gap:8px; margin-block-start:8px' }, [
        el('button', { class: 'btn btn-secondary btn-block', text: 'הפקדתי מזומן', onClick: async () => {
          try { await wallet.withdraw(tripId, active.id, amount.value); toast('נוסף לארנק', 'success'); s.close(); refresh(); }
          catch (err) { toast(err.message, 'error'); }
        } }),
        el('button', { class: 'btn btn-tertiary btn-block', text: 'הוצאתי מזומן', onClick: async () => {
          try { await wallet.spend(tripId, active.id, amount.value); toast('נרשם', 'success'); s.close(); refresh(); }
          catch (err) { toast(err.message, 'error'); }
        } }),
      ]),
      el('div', { class: 'hairline', style: 'margin-block-start:16px; padding-block-start:12px' }, [
        el('div', { style: 'font-weight:700; margin-block-end:8px', text: 'סגירת ארנק (מעבר מדינה)' }),
        el('div', { class: 'field-row' }, [el('label', { class: 'field-label', text: 'יתרת סגירה בפועל' }), closeAmount]),
        el('div', { class: 'field-row' }, [el('label', { class: 'field-label', text: 'מטבע הארנק הבא' }), newCurrency]),
        el('button', { class: 'btn btn-primary btn-block', style: 'margin-block-start:8px', text: 'סגור ופתח ארנק חדש', onClick: async () => {
          try {
            await wallet.closeAndOpen(tripId, closeAmount.value, newCurrency.value);
            toast('הארנק נסגר ונפתח ארנק חדש', 'success');
            s.close();
            refresh();
          } catch (err) { toast(err.message, 'error'); }
        } }),
      ]),
    ]),
    actions: [el('button', { class: 'btn btn-tertiary btn-block', text: 'סגירה', onClick: () => s.close() })],
  });
}

export async function mount(host, tripId) {
  if (!tripId) {
    host.append(card([el('div', { class: 'dim', text: 'צרו טיול במסך ההגדרות כדי לעקוב אחרי הוצאות.' })], 'card-gap'));
    return;
  }

  const [cats, active] = await Promise.all([trips.categories(tripId), wallet.activeWallet(tripId)]);
  const balance = active ? await wallet.balance(tripId, active.id) : 0;

  host.append(card([
    el('div', { style: 'display:flex; justify-content:space-between; align-items:center' }, [
      el('div', {}, [
        el('div', { style: 'font-weight:700', text: 'ארנק מזומן' }),
        el('div', { class: 'dim', style: 'font-size:13px',
          text: active ? `יתרה ב-${active.currency}` : 'אין ארנק פתוח' }),
      ]),
      active ? el('span', { class: 'num', style: 'font-size:20px; font-weight:700', text: fmtMoney(balance, active.currency) }) : null,
    ]),
    el('button', {
      class: 'btn btn-secondary btn-block', style: 'margin-block-start:12px',
      html: `${icon('cash')}<span>${active ? 'ניהול ארנק' : 'פתיחת ארנק'}</span>`,
      onClick: () => openWalletSheet(tripId, active),
    }),
  ], 'card-gap'));

  const chips = el('div', { style: 'display:flex; gap:8px; overflow-x:auto; padding-block:4px' }, [
    el('button', {
      class: 'chip', 'aria-pressed': String(!categoryFilter), text: 'הכול',
      onClick: () => { categoryFilter = ''; refresh(); },
    }),
    ...cats.map(c => el('button', {
      class: 'chip', 'aria-pressed': String(categoryFilter === c.id), text: c.name,
      onClick: () => { categoryFilter = categoryFilter === c.id ? '' : c.id; refresh(); },
    })),
  ]);
  host.append(card([chips], 'card-gap'));

  const rows = await expenses.list(tripId, categoryFilter ? { categoryId: categoryFilter } : {});
  if (!rows.length) {
    host.append(card([el('div', { class: 'dim', text: 'אין הוצאות עדיין.' })], 'card-gap'));
  } else {
    host.append(card(rows.map(r => el('div', {
      class: 'hairline', style: 'display:flex; align-items:center; gap:8px; padding-block:10px',
    }, [
      el('div', { style: 'flex:1' }, [
        el('div', { text: r.title }),
        el('div', { class: 'dim', style: 'font-size:13px', text: fmtDate(r.date) }),
      ]),
      el('span', { class: 'num', style: 'font-weight:700', text: fmtMoney(r.amount, r.currency) }),
      r.source === 'expense'
        ? el('button', {
            class: 'icon-btn', style: 'color:var(--color-danger)', 'aria-label': `מחק ${r.title}`, html: icon('trash'),
            onClick: async () => {
              const ok = await confirmDanger({ title: 'למחוק את ההוצאה?', body: r.title, confirmLabel: 'מחק' });
              if (!ok) return;
              await expenses.removeExpense(tripId, r.id);
              toast('ההוצאה נמחקה', 'success');
              refresh();
            },
          })
        : null,
    ])), 'card-gap'));
  }

  host.append(el('button', {
    class: 'btn btn-primary fab', 'aria-label': 'הוסף הוצאה',
    html: `${icon('plus')}<span>הוצאה</span>`,
    onClick: () => openExpenseSheet(tripId, cats),
  }));
}
