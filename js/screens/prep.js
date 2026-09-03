import * as trips from '../trips.js';
import * as it from '../itinerary.js';
import * as prep from '../prep.js';
import * as catalog from '../catalog.js';
import { el, card, sheet, toast, confirmDanger, icon, fmtMoney } from '../ui.js';
import { refresh } from '../app.js';

const ZONES = ['critical', 'important', 'normal'];

// נשמר בין רינדורים כדי שקטגוריה פתוחה לא תיסגר בכל שמירה
const openStages = new Set(['before']);
let urgencyFilter = '';

// ---------- טופס משימה ----------

async function openTaskSheet(tripId, existing, stage) {
  const segs = await it.listSegments(tripId);
  const title = el('input', { class: 'field', type: 'text', value: existing?.title || '' });
  const urgency = el('select', { class: 'field' }, Object.entries(prep.URGENCY).map(([k, v]) =>
    el('option', { value: k, selected: (existing?.urgency || 'normal') === k, text: v })));
  const stageSel = el('select', { class: 'field' }, Object.entries(prep.STAGES).map(([k, v]) =>
    el('option', { value: k, selected: (existing?.stage || stage || 'before') === k, text: v })));
  const segment = el('select', { class: 'field' }, [
    el('option', { value: '', text: 'ללא שיוך ליעד' }),
    ...segs.map(sg => el('option', { value: sg.id, selected: existing?.segmentId === sg.id, text: sg.city })),
  ]);
  const amount = el('input', {
    class: 'field', type: 'number', inputmode: 'decimal', step: '0.01', value: existing?.plannedAmount ?? '',
  });

  const row = (label, node) => el('div', { class: 'field-row' }, [
    el('label', { class: 'field-label', text: label }), node,
  ]);

  const s = sheet({
    title: existing ? 'עריכת משימה' : 'משימה חדשה',
    body: el('div', {}, [
      row('כותרת', title), row('דחיפות', urgency), row('קטגוריה', stageSel),
      row('יעד', segment), row('עלות משוערת', amount),
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
            urgency: urgency.value,
            stage: stageSel.value,
            segmentId: segment.value || null,
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

function openMoveSheet(tripId, task) {
  const others = Object.entries(prep.STAGES).filter(([k]) => k !== task.stage);
  const s = sheet({
    title: `העבר את "${task.title}" ל…`,
    body: el('div', {}, others.map(([key, label]) => el('button', {
      class: 'btn btn-tertiary btn-block', style: 'margin-block-start:8px', text: label,
      onClick: async () => {
        await prep.setStage(tripId, task.id, key);
        toast(`הועבר ל${label}`, 'success');
        s.close();
        refresh();
      },
    }))),
    actions: [el('button', { class: 'btn btn-tertiary btn-block', text: 'ביטול', onClick: () => s.close() })],
  });
}

// ---------- גרירה בין אזורי דחיפות ----------

/**
 * גרירה במגע ובעכבר דרך pointer events. אזור היעד נקבע לפי מה שנמצא מתחת
 * לאצבע ברגע השחרור — לכן זה עובד גם כשהרשימה נגללת תוך כדי.
 */
function enableDrag(node, tripId, task) {
  const grip = node.querySelector('.grip');
  if (!grip) return;

  grip.addEventListener('pointerdown', event => {
    event.preventDefault();
    grip.setPointerCapture(event.pointerId);
    node.classList.add('dragging');
    let target = null;

    const highlight = zone => {
      for (const z of document.querySelectorAll('[data-zone]')) {
        z.style.outline = z === zone ? '2px dashed var(--color-accent)' : '';
      }
    };

    const zoneAt = ev => document
      .elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-zone]') || null;

    const onMove = ev => { target = zoneAt(ev); highlight(target); };

    const onUp = async ev => {
      grip.removeEventListener('pointermove', onMove);
      grip.removeEventListener('pointerup', onUp);
      grip.removeEventListener('pointercancel', onUp);
      node.classList.remove('dragging');
      highlight(null);
      const zone = zoneAt(ev) || target;
      const urgency = zone?.dataset.zone;
      if (urgency && urgency !== task.urgency) {
        await prep.setUrgency(tripId, task.id, urgency);
        refresh();
      }
    };

    grip.addEventListener('pointermove', onMove);
    grip.addEventListener('pointerup', onUp);
    grip.addEventListener('pointercancel', onUp);
  });
}

function taskRow(tripId, task, segs, currency) {
  const seg = segs.find(x => x.id === task.segmentId);
  const node = el('div', {
    class: `task ${task.done ? 'done' : ''}`.trim(),
    'data-urgency': task.urgency || 'normal',
  }, [
    el('button', {
      class: 'tick', 'aria-pressed': String(!!task.done),
      'aria-label': task.done ? `בטל סימון של ${task.title}` : `סמן שבוצע: ${task.title}`,
      html: icon('check'),
      onClick: async () => { await prep.toggleDone(tripId, task.id); refresh(); },
    }),
    el('button', {
      class: 'title', 'aria-label': `ערוך את ${task.title}`,
      onClick: () => openTaskSheet(tripId, task),
    }, [
      el('div', { text: task.title }),
      el('div', { class: 'sub' }, [
        el('span', { text: prep.URGENCY[task.urgency] || 'רגיל' }),
        seg ? el('span', { text: ` · ${seg.city}` }) : null,
        task.plannedAmount
          ? el('span', { class: 'num', text: ` · ${fmtMoney(task.plannedAmount, currency)}` })
          : null,
      ]),
    ]),
    el('button', {
      class: 'icon-btn', 'aria-label': `העבר את ${task.title} לקטגוריה אחרת`,
      html: icon('transfer'), onClick: () => openMoveSheet(tripId, task),
    }),
    el('span', { class: 'grip icon-btn', 'aria-hidden': 'true', html: icon('drag') }),
  ]);
  enableDrag(node, tripId, task);
  return node;
}

// ---------- בורר הקטלוג ----------

export function openCatalogSheet(tripId, stage) {
  const selected = new Map();
  const view = { phase: null, section: null, query: '' };

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

  function catalogRow(item) {
    const isSel = selected.has(item.id);
    return el('button', {
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
  }

  function backRow(onClick, label) {
    return el('button', {
      class: 'group-head', style: 'color:var(--color-accent)', onClick,
    }, [el('span', { html: icon('chevronLeft') }), el('span', { text: label })]);
  }

  async function render() {
    body.replaceChildren();
    body.append(el('div', { class: 'field-row' }, [
      el('input', {
        class: 'field', type: 'search', placeholder: 'חיפוש בקטלוג', value: view.query,
        onInput: async e => { view.query = e.target.value; await render(); },
      }),
    ]));

    if (view.query.trim()) {
      const results = await catalog.search(view.query);
      body.append(el('div', { class: 'sub', text: `${results.length} תוצאות` }));
      body.append(...results.slice(0, 120).map(catalogRow));
      return;
    }

    const allPhases = await catalog.phases();
    const phases = stage ? allPhases.filter(p => prep.STAGE_BY_PHASE[p] === stage) : allPhases;

    if (!view.phase) {
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
    for (const topic of await catalog.topics(view.phase, view.section)) {
      body.append(el('div', { style: 'font-weight:700; margin-block-start:12px', text: topic }));
      body.append(...(await catalog.byTopic(view.phase, view.section, topic)).map(catalogRow));
    }
  }

  render();
}

// ---------- המסך ----------

export async function mount(host, tripId) {
  if (!tripId) {
    host.append(card([
      el('div', { style: 'font-weight:700; margin-block-end:4px', text: 'אין עדיין טיול' }),
      el('div', { class: 'dim', text: 'פתחו את ההגדרות וצרו טיול כדי להתחיל.' }),
    ], 'card-gap'));
    return;
  }

  const [trip, segs, all] = await Promise.all([
    trips.getTrip(tripId), it.listSegments(tripId), prep.listTasks(tripId),
  ]);
  const currency = trip?.currency || 'ILS';

  host.append(el('div', { class: 'card-gap', style: 'display:flex; gap:8px; overflow-x:auto; padding-block:4px' }, [
    el('button', {
      class: 'chip', 'aria-pressed': String(!urgencyFilter), text: 'כל הדחיפויות',
      onClick: () => { urgencyFilter = ''; refresh(); },
    }),
    ...ZONES.map(z => el('button', {
      class: 'chip', 'aria-pressed': String(urgencyFilter === z), text: prep.URGENCY[z],
      onClick: () => { urgencyFilter = urgencyFilter === z ? '' : z; refresh(); },
    })),
  ]));

  for (const [stage, label] of Object.entries(prep.STAGES)) {
    const tasks = all.filter(t => t.stage === stage);
    const isOpen = openStages.has(stage);
    const done = tasks.filter(t => t.done).length;
    const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;

    const head = el('button', {
      class: 'group-head', 'aria-expanded': String(isOpen),
      onClick: () => {
        if (isOpen) openStages.delete(stage); else openStages.add(stage);
        refresh();
      },
    }, [
      el('span', {
        html: icon('chevronDown'),
        style: `color:var(--color-accent); transform:rotate(${isOpen ? 0 : -90}deg)`,
      }),
      el('span', { class: 'grow', style: 'font-weight:700; font-size:16px', text: label }),
      el('span', { class: 'dim num', style: 'font-size:13px', text: `${done}/${tasks.length}` }),
    ]);

    const body = [head, el('div', { class: 'bar', style: 'margin-block-start:8px' }, [
      el('span', { style: `width:${pct}%` }),
    ])];

    if (isOpen) {
      for (const zone of ZONES) {
        if (urgencyFilter && urgencyFilter !== zone) continue;
        const inZone = tasks.filter(t => (t.urgency || 'normal') === zone);
        body.push(el('div', { class: 'zone-label' }, [
          el('span', { style: `color:var(--urgency-${zone})`, text: prep.URGENCY[zone] }),
          el('span', { class: 'dim', style: 'font-weight:400', text: `${inZone.length}` }),
        ]));
        body.push(el('div', {
          'data-zone': zone,
          style: 'min-height:44px; border-radius:var(--radius-control)',
        }, inZone.length
          ? inZone.map(t => taskRow(tripId, t, segs, currency))
          : [el('div', { class: 'sub', style: 'padding:12px', text: 'גררו לכאן פריט' })]));
      }

      body.push(el('div', { style: 'display:flex; gap:8px; margin-block-start:16px' }, [
        el('button', {
          class: 'btn btn-tertiary btn-block', text: 'הוספה ידנית',
          onClick: () => openTaskSheet(tripId, null, stage),
        }),
        el('button', {
          class: 'btn btn-secondary btn-block', text: 'מהקטלוג',
          onClick: () => openCatalogSheet(tripId, stage),
        }),
      ]));
    }

    host.append(card(body, 'card-gap'));
  }
}
