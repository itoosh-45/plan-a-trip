import * as trips from '../trips.js';
import * as it from '../itinerary.js';
import * as prep from '../prep.js';
import * as catalog from '../catalog.js';
import * as imported from '../imported.js';
import * as rates from '../rates.js';
import { el, card, sheet, toast, confirmDanger, icon, ilsText, fmtMoneyHtml } from '../ui.js';
import { refresh } from '../app.js';
import { noTripCard } from './no-trip.js';

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

function taskRow(tripId, task, segs, currency, rate) {
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
          ? el('span', { class: 'num', html: ` · ${fmtMoneyHtml(task.plannedAmount, currency)}` })
          : null,
        ilsText(task.plannedAmount, currency, rate)
          ? el('span', { class: 'num', text: ` · ${ilsText(task.plannedAmount, currency, rate)}` })
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

const matches = (item, needle) =>
  item.text.toLowerCase().includes(needle) ||
  (item.topic || '').toLowerCase().includes(needle) ||
  (item.section || '').toLowerCase().includes(needle) ||
  (item.group || '').toLowerCase().includes(needle);

/**
 * הקטלוג כולו ברשימה אחת. אין ניווט בין שלב, מדור ונושא: המדורים הם כותרות
 * בולטות, הנושאים כותרות קטנות מתחתן, ושורת צ׳יפס דביקה למעלה קופצת לכל
 * מדור. פריט שכבר ברשימת הטיול אינו מוצג, ומחיקתו מהרשימה מחזירה אותו לכאן.
 */
export function openCatalogSheet(tripId, stage) {
  const selected = new Map();
  const index = el('div', { class: 'catalog-index' });
  const results = el('div');
  const headOf = new Map();     // מפתח מדור -> כותרת שלו ברשימה, לקפיצה
  let sections = [];

  const addSelected = async () => {
    const items = [...selected.values()];
    if (!items.length) { s.close(); return; }
    const added = await prep.addFromCatalog(tripId, items.map(item => ({
      ...item,
      stage: item.phase ? prep.STAGE_BY_PHASE[item.phase] : undefined,
    })), stage);
    toast(added.length === 1 ? 'נוספה משימה אחת' : `נוספו ${added.length} משימות`, 'success');
    s.close();
    refresh();
  };

  // הרשימה ארוכה, ולכן כפתור ההוספה יושב גם בראשה וגם בתחתיתה. שניהם קיימים
  // תמיד — כפתור שמופיע רק אחרי הבחירה הראשונה דוחף את כל הרשימה למטה.
  const addButtons = [];
  function addButton() {
    const button = el('button', {
      class: 'btn btn-primary btn-block', text: 'הוסף נבחרים',
      disabled: true, onClick: addSelected,
    });
    addButtons.push(button);
    return button;
  }

  function syncAddButtons() {
    for (const button of addButtons) {
      button.textContent = selected.size ? `הוסף ${selected.size} לרשימה` : 'הוסף נבחרים';
      button.disabled = !selected.size;
    }
  }

  const search = el('input', {
    class: 'field', type: 'search', placeholder: 'חיפוש בקטלוג',
    onInput: e => renderList(e.target.value),
  });

  const body = el('div', {}, [
    addButton(),
    el('div', { class: 'field-row' }, [search]),
    index,
    results,
  ]);

  const s = sheet({
    title: 'הוספה מהקטלוג',
    body,
    actions: [
      el('button', { class: 'btn btn-tertiary btn-block', text: 'ביטול', onClick: () => s.close() }),
      addButton(),
    ],
  });

  // לחיצה על פריט מעדכנת רק את הפריט שנלחץ. אין בנייה מחדש ואין קפיצת גלילה.
  function catalogRow(item) {
    const mark = el('span', { html: icon(selected.has(item.id) ? 'check' : 'plus') });
    const node = el('button', {
      class: 'chip wrap catalog-item',
      'aria-pressed': String(selected.has(item.id)),
      onClick: () => {
        if (selected.has(item.id)) selected.delete(item.id); else selected.set(item.id, item);
        const on = selected.has(item.id);
        node.setAttribute('aria-pressed', String(on));
        mark.innerHTML = icon(on ? 'check' : 'plus');
        syncAddButtons();
      },
    }, [
      el('span', { style: 'flex:1', text: item.text }),
      mark,
    ]);
    return node;
  }

  function emptyNote(text) {
    return el('div', { class: 'sub', style: 'padding:12px', text });
  }

  function renderIndex() {
    index.replaceChildren(...sections.map(sec => el('button', {
      class: 'chip', 'data-section': sec.key, text: sec.title,
      onClick: () => headOf.get(sec.key)?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
    })));
  }

  /** הצ׳יפ הפעיל הוא המדור האחרון שכותרתו כבר עברה את ראש אזור הגלילה. */
  function syncIndex() {
    const top = s.panel.getBoundingClientRect().top + 72;
    let active = sections[0]?.key;
    for (const sec of sections) {
      const head = headOf.get(sec.key);
      if (head && head.getBoundingClientRect().top <= top) active = sec.key;
    }
    for (const chip of index.children) {
      chip.setAttribute('aria-pressed', String(chip.dataset.section === active));
    }
  }

  function renderList(query = '') {
    const needle = query.trim().toLowerCase();
    index.hidden = Boolean(needle) || sections.length < 2;
    headOf.clear();
    results.replaceChildren();

    if (needle) {
      const hits = sections
        .flatMap(sec => sec.topics.flatMap(t => t.items))
        .filter(item => matches(item, needle));
      results.append(el('div', { class: 'sub', text: `${hits.length} תוצאות` }));
      if (!hits.length) results.append(emptyNote('אין פריטים שמתאימים לחיפוש.'));
      results.append(...hits.slice(0, 200).map(catalogRow));
      return;
    }

    if (!sections.length) {
      results.append(emptyNote('כל הפריטים בקטלוג כבר נמצאים ברשימה.'));
      return;
    }

    const frag = document.createDocumentFragment();
    for (const sec of sections) {
      const head = el('div', { class: 'catalog-section' }, [
        sec.badge ? el('div', { class: 'sub', style: 'margin:0', text: sec.badge }) : null,
        el('div', { class: 'catalog-section-title', text: sec.title }),
      ]);
      headOf.set(sec.key, head);
      frag.append(head);
      for (const topic of sec.topics) {
        if (topic.topic) frag.append(el('div', { class: 'catalog-topic', text: topic.topic }));
        frag.append(...topic.items.map(catalogRow));
      }
    }
    results.append(frag);
    renderIndex();
    syncIndex();
  }

  (async () => {
    const [used, lists] = await Promise.all([prep.usedCatalogIds(tripId), imported.list()]);
    const available = rows => rows.filter(r => !used.has(r.id));

    // רשימה בשם חופשי אינה שייכת לשלב, ולכן כל הקטלוג פתוח בפניה
    const phases = prep.STAGES[stage]
      ? (await catalog.phases()).filter(p => prep.STAGE_BY_PHASE[p] === stage)
      : null;

    const built = (await catalog.outline(phases)).map(sec => ({
      key: sec.section,
      title: sec.section,
      badge: null,
      topics: sec.topics
        .map(t => ({ topic: t.topic, items: available(t.items) }))
        .filter(t => t.items.length),
    }));

    // הרשימות שהמשתמש הביא בעצמו, תמיד אחרונות ותמיד מסומנות ככאלה
    const importedSections = lists.map(entry => ({
      key: `imp-${entry.id}`,
      title: entry.name,
      badge: 'רשימה מיובאת',
      topics: [{ topic: null, items: available(imported.itemsOf(entry)) }].filter(t => t.items.length),
    }));

    sections = [...built, ...importedSections].filter(sec => sec.topics.length);
    renderList();
    s.panel.addEventListener('scroll', () => {
      if (!index.hidden) requestAnimationFrame(syncIndex);
    }, { passive: true });
  })();
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
      class: 'icon-btn', 'aria-label': `הוסף משימה ידנית ל${label}`,
      html: icon('plus'), onClick: () => openTaskSheet(tripId, null, stage),
    }),
    el('button', {
      class: 'icon-btn', 'aria-label': `הוסף ל${label} מהקטלוג`,
      html: icon('search'), onClick: () => openCatalogSheet(tripId, stage),
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
    host.append(noTripCard('שחזרו גיבוי קיים או פתחו טיול חדש כדי להתחיל.', { intro: true }));
    return;
  }

  const [trip, segs, all, lists] = await Promise.all([
    trips.getTrip(tripId), it.listSegments(tripId), prep.listTasks(tripId), prep.listsFor(tripId),
  ]);
  const currency = trip?.currency || 'ILS';
  const rate = (await rates.rateMap([currency]))[currency.toUpperCase()];

  host.append(el('div', { class: 'card-gap filter-row', style: 'display:flex; gap:8px; overflow-x:auto; padding-block:4px' }, [
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
        body.push(el('div', { class: 'sub', style: 'padding:12px', text: 'הרשימה ריקה. אפשר להוסיף משימה ידנית או לבחור מהקטלוג, משני הכפתורים שלמעלה.' }));
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
          ? inGroup.map(t => taskRow(tripId, t, segs, currency, rate))
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
