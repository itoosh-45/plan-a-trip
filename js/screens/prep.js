import * as db from '../db.js';
import * as trips from '../trips.js';
import * as prep from '../prep.js';
import * as catalog from '../catalog.js';
import { el, card, sheet, toast, confirmDanger, icon, fmtMoney, fmtDate } from '../ui.js';
import { refresh } from '../app.js';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function taskRow(tripId, task) {
  const overdue = task.dueDate && !task.done && task.dueDate < todayIso();
  return el('div', {
    class: 'hairline', style: 'display:flex; align-items:flex-start; gap:10px; padding-block:10px',
  }, [
    el('button', {
      class: 'icon-btn', style: `flex-shrink:0; ${task.done ? 'color:var(--color-success)' : ''}`,
      'aria-label': task.done ? 'סמן כלא בוצע' : 'סמן כבוצע',
      html: icon(task.done ? 'check' : 'other'),
      onClick: async () => { await prep.toggleDone(tripId, task.id); refresh(); },
    }),
    el('div', { style: 'flex:1' }, [
      el('div', { style: `${task.done ? 'text-decoration:line-through; color:var(--color-text-dim)' : ''}`, text: task.title }),
      el('div', { class: 'dim', style: 'font-size:12px; display:flex; gap:6px; flex-wrap:wrap; margin-block-start:2px' }, [
        el('span', { text: task.priority }),
        task.plannedAmount ? el('span', { class: 'num', text: fmtMoney(task.plannedAmount, task.currency || 'ILS') }) : null,
        task.dueDate ? el('span', { style: overdue ? 'color:var(--color-warning); font-weight:700' : '', text: fmtDate(task.dueDate) }) : null,
      ]),
    ]),
    el('button', { class: 'icon-btn', 'aria-label': `ערוך ${task.title}`, html: icon('edit'), onClick: () => openTaskSheet(tripId, task) }),
  ]);
}

function openTaskSheet(tripId, existing) {
  const title = el('input', { class: 'field', type: 'text', value: existing?.title || '' });
  const priority = el('select', { class: 'field' }, ['חובה', 'רלוונטי', 'נוחות'].map(p =>
    el('option', { value: p, selected: (existing?.priority || 'רלוונטי') === p, text: p })));
  const due = el('input', { class: 'field', type: 'date', value: existing?.dueDate || '' });
  const amount = el('input', { class: 'field', type: 'number', inputmode: 'decimal', step: '0.01', value: existing?.plannedAmount ?? '' });

  const s = sheet({
    title: existing ? 'עריכת משימה' : 'משימה חדשה',
    body: el('div', {}, [
      el('div', { class: 'field-row' }, [el('label', { class: 'field-label', text: 'כותרת' }), title]),
      el('div', { class: 'field-row' }, [el('label', { class: 'field-label', text: 'עדיפות' }), priority]),
      el('div', { class: 'field-row' }, [el('label', { class: 'field-label', text: 'תאריך יעד' }), due]),
      el('div', { class: 'field-row' }, [el('label', { class: 'field-label', text: 'עלות משוערת' }), amount]),
    ]),
    actions: [
      existing
        ? el('button', { class: 'btn btn-danger btn-block', text: 'מחק', onClick: async () => {
            const ok = await confirmDanger({ title: 'למחוק את המשימה?', body: existing.title, confirmLabel: 'מחק' });
            if (!ok) return;
            await prep.removeTask(tripId, existing.id);
            s.close();
            refresh();
          } })
        : el('button', { class: 'btn btn-tertiary btn-block', text: 'ביטול', onClick: () => s.close() }),
      el('button', { class: 'btn btn-primary btn-block', text: 'שמור', onClick: async () => {
        try {
          await prep.saveTask(tripId, {
            ...existing,
            title: title.value,
            phase: existing?.phase || prep.currentPhase('planned'),
            priority: priority.value,
            dueDate: due.value || undefined,
            plannedAmount: amount.value === '' ? undefined : Number(amount.value),
          });
          toast('המשימה נשמרה', 'success');
          s.close();
          refresh();
        } catch (err) { toast(err.message, 'error'); }
      } }),
    ],
  });
}

async function openCatalogSheet(tripId, phase) {
  const selected = new Map();
  let view = { phase: null, section: null, query: '' };

  const body = el('div');
  const s = sheet({
    title: 'הוספה מהקטלוג',
    body,
    actions: [
      el('button', { class: 'btn btn-tertiary btn-block', text: 'ביטול', onClick: () => s.close() }),
      el('button', { class: 'btn btn-primary btn-block', text: 'הוסף נבחרים', onClick: async () => {
        const items = [...selected.values()];
        if (!items.length) { s.close(); return; }
        const added = await prep.addFromCatalog(tripId, items);
        toast(added.length === 1 ? 'נוספה משימה אחת' : `נוספו ${added.length} משימות`, 'success');
        s.close();
        refresh();
      } }),
    ],
  });

  async function render() {
    body.replaceChildren();
    const searchField = el('input', {
      class: 'field', type: 'search', placeholder: 'חיפוש בקטלוג', value: view.query,
      onInput: async e => { view.query = e.target.value; await render(); },
    });
    body.append(el('div', { class: 'field-row' }, [searchField]));

    if (view.query.trim()) {
      const results = await catalog.search(view.query);
      body.append(...results.map(item => catalogRow(item)));
      return;
    }

    if (!view.phase) {
      const phases = await catalog.phases();
      body.append(...phases.map(p => el('button', {
        class: 'btn btn-tertiary btn-block', style: 'margin-block-start:8px', text: p,
        onClick: async () => { view.phase = p; await render(); },
      })));
      return;
    }

    if (!view.section) {
      body.append(backRow(() => { view.phase = null; render(); }, view.phase));
      const sections = await catalog.sections(view.phase);
      body.append(...sections.map(sec => el('button', {
        class: 'btn btn-tertiary btn-block', style: 'margin-block-start:8px', text: sec,
        onClick: async () => { view.section = sec; await render(); },
      })));
      return;
    }

    body.append(backRow(() => { view.section = null; render(); }, view.section));
    const topics = await catalog.topics(view.phase, view.section);
    for (const topic of topics) {
      const items = await catalog.byTopic(view.phase, view.section, topic);
      body.append(el('div', { style: 'font-weight:700; margin-block-start:12px', text: topic }));
      body.append(...items.map(item => catalogRow(item)));
    }
  }

  function backRow(onClick, label) {
    return el('button', {
      style: 'display:flex; align-items:center; gap:6px; background:none; border:0; padding:8px 0; min-height:44px; cursor:pointer; color:var(--color-accent)',
      onClick,
    }, [el('span', { html: icon('chevronLeft') }), el('span', { text: label })]);
  }

  function catalogRow(item) {
    const isSel = selected.has(item.id);
    const chip = el('button', {
      class: 'chip', style: 'width:100%; justify-content:space-between; margin-block-start:6px; text-align:start',
      'aria-pressed': String(isSel),
      onClick: () => {
        if (selected.has(item.id)) selected.delete(item.id); else selected.set(item.id, item);
        render();
      },
    }, [
      el('span', { style: 'flex:1', text: item.text }),
      el('span', { html: icon(isSel ? 'check' : 'plus') }),
    ]);
    return chip;
  }

  await render();
}

export async function mountPrepCard(host, tripId) {
  const trip = (await trips.listTrips()).find(t => t.id === tripId);
  if (!trip) return;
  const { startDate, endDate } = await trips.tripDates(tripId);
  const phase = prep.currentPhase(trip.status, { startDate, endDate });
  const { done, total } = await prep.progress(tripId, phase);
  const tasks = await prep.listTasks(tripId, phase);
  const pct = total ? Math.round((done / total) * 100) : 0;

  const preview = tasks.slice(0, 4).map(t => taskRow(tripId, t));

  host.append(card([
    el('div', { style: 'display:flex; justify-content:space-between; align-items:center; margin-block-end:8px' }, [
      el('h2', { style: 'font-size:16px; font-weight:700; margin:0', text: `רשימת הכנה · ${phase}` }),
      el('span', { class: 'dim num', style: 'font-size:13px', text: `${done}/${total}` }),
    ]),
    el('div', { class: `bar ${pct >= 100 ? '' : pct >= 50 ? 'warn' : ''}` }, [
      el('span', { style: `width:${pct}%` }),
    ]),
    ...preview,
    el('div', { style: 'display:flex; gap:8px; margin-block-start:12px' }, [
      el('button', { class: 'btn btn-tertiary btn-block', text: 'הוספה ידנית', onClick: () => openTaskSheet(tripId, { phase }) }),
      el('button', { class: 'btn btn-secondary btn-block', text: 'מהקטלוג', onClick: () => openCatalogSheet(tripId, phase) }),
    ]),
  ], 'card-gap'));
}
