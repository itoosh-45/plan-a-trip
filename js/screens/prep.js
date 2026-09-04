import * as trips from '../trips.js';
import * as it from '../itinerary.js';
import * as prep from '../prep.js';
import * as catalog from '../catalog.js';
import { el, card, sheet, toast, confirmDanger, icon, fmtMoney } from '../ui.js';
import { refresh } from '../app.js';

const ZONES = ['critical', 'important', 'normal'];

// נשמר בין רינדורים כדי שקבוצה פתוחה לא תיסגר בכל שמירה
const openStages = new Set(['before']);
// קבוצות פתוחות כברירת מחדל. נשמר מה שנסגר, לא מה שנפתח.
const closedGroups = new Set();
let urgencyFilter = '';

const groupKey = (stage, category) => `${stage}|${category}`;

// ---------- טופס משימה ----------

async function openTaskSheet(tripId, existing, stage, category) {
  const [segs, categories, lists] = await Promise.all([
    it.listSegments(tripId),
    prep.categoriesFor(existing?.stage || stage || 'before'),
    prep.listsFor(tripId),
  ]);

  const title = el('input', { class: 'field', type: 'text', value: existing?.title || '' });
  const urgency = el('select', { class: 'field' }, Object.entries(prep.URGENCY).map(([k, v]) =>
    el('option', { value: k, selected: (existing?.urgency || 'normal') === k, text: v })));
  const stageSel = el('select', { class: 'field' }, Object.entries(lists).map(([k, v]) =>
    el('option', { value: k, selected: (existing?.stage || stage || 'before') === k, text: v })));

  const chosenCategory = existing?.category || category || prep.OTHER;
  const categorySel = el('select', { class: 'field' }, categories.map(c =>
    el('option', { value: c, selected: c === chosenCategory, text: c })));

  // החלפת שלב מחליפה את רשימת הקטגוריות — קטגוריה של "לפני" לא שייכת ל"בחזרה"
  stageSel.addEventListener('change', async () => {
    const next = await prep.categoriesFor(stageSel.value);
    categorySel.replaceChildren(...next.map(c =>
      el('option', { value: c, selected: c === prep.OTHER, text: c })));
  });

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
      row('כותרת', title), row('דחיפות', urgency), row('שלב', stageSel),
      row('קטגוריה', categorySel), row('יעד', segment), row('עלות משוערת', amount),
    ]),
    actions: [
      el('button', { class: 'btn btn-tertiary btn-block', text: 'ביטול', onClick: () => s.close() }),
      el('button', { class: 'btn btn-primary btn-block', text: 'שמור', onClick: async () => {
        try {
          await prep.saveTask(tripId, {
            ...existing,
            title: title.value,
            urgency: urgency.value,
            stage: stageSel.value,
            category: categorySel.value,
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

/** הוספה לרשימה: ידנית או מהקטלוג. נפתח מהכפתור שליד כותרת השלב. */
function openAddSheet(tripId, stage, label) {
  const s = sheet({
    title: `הוספה ל${label}`,
    body: el('div', {}, [
      el('button', {
        class: 'btn btn-secondary btn-block', style: 'margin-block-start:8px',
        html: `${icon('search')}<span>בחירה מהקטלוג</span>`,
        onClick: () => { s.close(); openCatalogSheet(tripId, stage); },
      }),
      el('button', {
        class: 'btn btn-tertiary btn-block', style: 'margin-block-start:8px',
        html: `${icon('plus')}<span>הוספה ידנית</span>`,
        onClick: () => { s.close(); openTaskSheet(tripId, null, stage); },
      }),
    ]),
  });
}

async function removeTaskFlow(tripId, task) {
  const ok = await confirmDanger({
    title: 'להסיר את המשימה?',
    body: task.catalogId
      ? `"${task.title}" יוסר מהרשימה ויחזור להיות זמין בקטלוג.`
      : `"${task.title}" יימחק מהרשימה.`,
    confirmLabel: 'הסר',
  });
  if (!ok) return;
  await prep.removeTask(tripId, task.id);
  toast(task.catalogId ? 'הוסר מהרשימה וחזר לקטלוג' : 'הוסר מהרשימה', 'success');
  refresh();
}

// ---------- גרירה: סדר בתוך קבוצה ומעבר בין קבוצות ----------

/**
 * גרירה במגע ובעכבר דרך pointer events. מקום השחרור נקבע לפי מה שנמצא מתחת
 * לאצבע ברגע השחרור, ולכן זה עובד גם כשהרשימה נגללת תוך כדי. הקבוצה כולה
 * נשמרת מחדש עם סדר מפורש — זה הרבה יותר פשוט מלנהל מרווחים בין ערכים.
 */
function enableDrag(node, tripId, task) {
  const grip = node.querySelector('.grip');
  if (!grip) return;

  grip.addEventListener('pointerdown', event => {
    event.preventDefault();
    try { grip.setPointerCapture(event.pointerId); } catch { /* אין לכידה */ }
    node.classList.add('dragging');

    const groupAt = ev => document
      .elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-group]') || null;

    const highlight = group => {
      for (const g of document.querySelectorAll('[data-group]')) {
        g.classList.toggle('drop-target', g === group);
      }
    };

    // מזיז את השורה בתוך ה-DOM תוך כדי גרירה, כדי שמה שרואים הוא מה שיישמר
    const onMove = ev => {
      const group = groupAt(ev);
      highlight(group);
      if (!group) return;
      const siblings = [...group.querySelectorAll('.task')].filter(n => n !== node);
      const after = siblings.find(n => {
        const box = n.getBoundingClientRect();
        return ev.clientY < box.top + box.height / 2;
      });
      if (after) group.insertBefore(node, after);
      else group.append(node);
    };

    const onUp = async ev => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      node.classList.remove('dragging');
      highlight(null);

      const group = node.closest('[data-group]');
      if (!group) { refresh(); return; }
      const [stage, category] = group.dataset.group.split('|');
      const ids = [...group.querySelectorAll('.task')].map(n => n.dataset.id);
      try {
        await prep.reorder(tripId, stage, category, ids);
      } catch (err) { toast(err.message, 'error'); }
      refresh();
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  });
}

function taskRow(tripId, task, segs, currency) {
  const seg = segs.find(x => x.id === task.segmentId);
  const node = el('div', {
    class: `task ${task.done ? 'done' : ''}`.trim(),
    'data-urgency': task.urgency || 'normal',
    'data-id': task.id,
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
        el('span', { class: 'urgency-tag', text: prep.URGENCY[task.urgency || 'normal'] }),
        seg ? el('span', { text: ` · ${seg.city}` }) : null,
        task.plannedAmount
          ? el('span', { class: 'num', text: ` · ${fmtMoney(task.plannedAmount, currency)}` })
          : null,
      ]),
    ]),
    el('button', {
      class: 'icon-btn', style: 'color:var(--color-text-dim)',
      'aria-label': `הסר את ${task.title} מהרשימה`,
      html: icon('trash'), onClick: () => removeTaskFlow(tripId, task),
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
  let used = new Set();

  const body = el('div');

  const addSelected = async () => {
    const items = [...selected.values()];
    if (!items.length) { s.close(); return; }
    const added = await prep.addFromCatalog(tripId, items, stage);
    toast(added.length === 1 ? 'נוספה משימה אחת' : `נוספו ${added.length} משימות`, 'success');
    s.close();
    refresh();
  };

  // הקטלוג ארוך, ולכן כפתור ההוספה יושב גם בראש הרשימה וגם בתחתיתה
  const addButton = () => el('button', {
    class: 'btn btn-primary btn-block',
    text: selected.size ? `הוסף ${selected.size} לרשימה` : 'הוסף נבחרים',
    onClick: addSelected,
  });

  const s = sheet({
    title: 'הוספה מהקטלוג',
    body,
    actions: [
      el('button', { class: 'btn btn-tertiary btn-block', text: 'ביטול', onClick: () => s.close() }),
      addButton(),
    ],
  });

  // פריט שכבר ברשימה של הטיול הזה אינו מוצג. מחיקתו מהרשימה מחזירה אותו לכאן.
  const available = rows => rows.filter(r => !used.has(r.id));

  function catalogRow(item) {
    const isSel = selected.has(item.id);
    return el('button', {
      class: 'chip wrap', style: 'width:100%; justify-content:space-between; margin-block-start:6px; text-align:start',
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

  function emptyNote(text) {
    return el('div', { class: 'sub', style: 'padding:12px', text });
  }

  async function render() {
    used = await prep.usedCatalogIds(tripId);
    body.replaceChildren();
    if (selected.size) body.append(addButton());
    body.append(el('div', { class: 'field-row' }, [
      el('input', {
        class: 'field', type: 'search', placeholder: 'חיפוש בקטלוג', value: view.query,
        onInput: async e => { view.query = e.target.value; await render(); },
      }),
    ]));

    if (view.query.trim()) {
      const results = available(await catalog.search(view.query));
      body.append(el('div', { class: 'sub', text: `${results.length} תוצאות` }));
      body.append(...results.slice(0, 120).map(catalogRow));
      return;
    }

    const allPhases = await catalog.phases();
    // רשימה בשם חופשי אינה שייכת לשלב, ולכן כל הקטלוג פתוח בפניה
    const phases = prep.STAGES[stage]
      ? allPhases.filter(p => prep.STAGE_BY_PHASE[p] === stage)
      : allPhases;

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
    let shown = 0;
    for (const topic of await catalog.topics(view.phase, view.section)) {
      const rows = available(await catalog.byTopic(view.phase, view.section, topic));
      if (!rows.length) continue;
      shown += rows.length;
      body.append(el('div', { class: 'card-title', style: 'margin-block-start:12px', text: topic }));
      body.append(...rows.map(catalogRow));
    }
    if (!shown) body.append(emptyNote('כל הפריטים במדור הזה כבר ברשימה.'));
  }

  render();
}

// ---------- המסך ----------

function stageHeader(stage, label, tasks, isOpen, tripId) {
  const done = tasks.filter(t => t.done).length;
  const isCustom = !prep.STAGES[stage];
  return el('div', { style: 'display:flex; align-items:center; gap:4px' }, [
    el('button', {
      class: 'group-head', 'aria-expanded': String(isOpen),
      onClick: () => {
        if (isOpen) openStages.delete(stage); else openStages.add(stage);
        refresh();
      },
    }, [
      el('span', {
        html: icon('chevronDown'),
        style: `color:var(--color-accent); transform:rotate(${isOpen ? 0 : 90}deg)`,
      }),
      el('span', { class: 'grow card-title', text: label }),
      el('span', { class: 'sub num', text: `${done}/${tasks.length}` }),
    ]),
    el('button', {
      class: 'icon-btn', 'aria-label': `הוסף פריט ל${label}`,
      html: icon('plus'), onClick: () => openAddSheet(tripId, stage, label),
    }),
    isCustom
      ? el('button', {
          class: 'icon-btn', style: 'color:var(--color-text-dim)',
          'aria-label': `מחק את הרשימה ${label}`,
          html: icon('trash'), onClick: () => removeListFlow(tripId, stage, label, tasks.length),
        })
      : null,
  ]);
}

async function removeListFlow(tripId, listId, label, count) {
  const ok = await confirmDanger({
    title: `למחוק את "${label}"?`,
    body: count
      ? `${count} פריטים ברשימה יימחקו יחד איתה. פריטים שהגיעו מהקטלוג יחזרו להיות זמינים בו.`
      : 'הרשימה ריקה ותימחק.',
    confirmLabel: 'מחק רשימה',
  });
  if (!ok) return;
  await prep.removeList(tripId, listId);
  toast('הרשימה נמחקה', 'success');
  refresh();
}

function openNewListSheet(tripId) {
  const name = el('input', { class: 'field', type: 'text', placeholder: 'למשל: ציוד סקי לחרמון' });
  const s = sheet({
    title: 'רשימה חדשה',
    body: el('div', {}, [
      el('div', { class: 'field-row' }, [
        el('label', { class: 'field-label', text: 'שם הרשימה' }), name,
      ]),
      el('p', { class: 'sub', text: 'הרשימה נוספת לצד לפני הטיול, במהלך השהייה ובחזרה, ואפשר למלא אותה ידנית או מכל הקטלוג.' }),
    ]),
    actions: [
      el('button', { class: 'btn btn-tertiary btn-block', text: 'ביטול', onClick: () => s.close() }),
      el('button', { class: 'btn btn-primary btn-block', text: 'צור', onClick: async () => {
        try {
          const list = await prep.addList(tripId, name.value);
          openStages.add(list.id);
          toast('הרשימה נוצרה', 'success');
          s.close();
          refresh();
        } catch (err) { toast(err.message, 'error'); }
      } }),
    ],
  });
}

export async function mount(host, tripId) {
  if (!tripId) {
    host.append(card([
      el('div', { class: 'empty-title', text: 'אין עדיין טיול' }),
      el('div', { class: 'dim', text: 'פתחו את ההגדרות וצרו טיול כדי להתחיל.' }),
    ], 'card-gap'));
    return;
  }

  const [trip, segs, all, lists] = await Promise.all([
    trips.getTrip(tripId), it.listSegments(tripId), prep.listTasks(tripId), prep.listsFor(tripId),
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

  for (const [stage, label] of Object.entries(lists)) {
    const stageTasks = all.filter(t => t.stage === stage);
    const isOpen = openStages.has(stage);
    const pct = stageTasks.length
      ? Math.round((stageTasks.filter(t => t.done).length / stageTasks.length) * 100)
      : 0;

    const body = [
      stageHeader(stage, label, stageTasks, isOpen, tripId),
      el('div', { class: 'bar', style: 'margin-block-start:8px' }, [
        el('span', { style: `width:${pct}%` }),
      ]),
    ];

    if (isOpen) {
      const visible = urgencyFilter
        ? stageTasks.filter(t => (t.urgency || 'normal') === urgencyFilter)
        : stageTasks;

      // רק קטגוריות שיש בהן משהו. קטגוריה ריקה היא רעש, לא מידע.
      const order = await prep.categoriesFor(stage);
      const present = order.filter(c => visible.some(t => t.category === c));
      for (const c of new Set(visible.map(t => t.category))) {
        if (!present.includes(c)) present.push(c);
      }

      if (!present.length) {
        body.push(el('div', { class: 'sub', style: 'padding:12px', text: 'הרשימה ריקה. הוסיפו פריט מהכפתור שלמעלה.' }));
      }

      for (const category of present) {
        const inGroup = visible.filter(t => t.category === category);
        const key = groupKey(stage, category);
        const groupOpen = !closedGroups.has(key);

        body.push(el('button', {
          class: 'group-head cat-head', 'aria-expanded': String(groupOpen),
          onClick: () => {
            if (closedGroups.has(key)) closedGroups.delete(key); else closedGroups.add(key);
            refresh();
          },
        }, [
          el('span', {
            html: icon('chevronDown'),
            style: `color:var(--color-accent); transform:rotate(${groupOpen ? 0 : 90}deg)`,
          }),
          el('span', { class: 'grow', text: category }),
          el('span', { class: 'sub num', text: `${inGroup.filter(t => t.done).length}/${inGroup.length}` }),
        ]));

        body.push(el('div', {
          'data-group': key,
          class: 'drop-zone',
        }, groupOpen
          ? inGroup.map(t => taskRow(tripId, t, segs, currency))
          : []));
      }
    }

    host.append(card(body, 'card-gap'));
  }

  host.append(el('button', {
    class: 'btn btn-tertiary btn-block card-gap',
    html: `${icon('plus')}<span>רשימה חדשה</span>`,
    onClick: () => openNewListSheet(tripId),
  }));
}
