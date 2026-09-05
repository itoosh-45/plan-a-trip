import * as trips from './trips.js';
import * as it from './itinerary.js';
import * as cur from './currencies.js';
import { el, sheet, toast, icon, fmtMoney, fmtDateRange } from './ui.js';
import { refresh, setActiveTrip } from './app.js';
import { openCatalogSheet } from './screens/prep.js';

const STEPS = ['פרטי הטיול', 'יעדים', 'תקציב', 'רשימת הכנה'];

function field(label, node) {
  return el('div', { class: 'field-row' }, [el('label', { class: 'field-label', text: label }), node]);
}

/** בורר טווח תאריכים — 75% מרוחב המסך, ממורכז, בכל מקום שבו הוא מופיע. */
function dateRange(from, to, { min, max } = {}) {
  const start = el('input', { class: 'field', type: 'date', value: from || '', min, max, 'aria-label': 'מתאריך' });
  const end = el('input', { class: 'field', type: 'date', value: to || '', min, max, 'aria-label': 'עד תאריך' });
  return { node: el('div', { class: 'date-row field-row' }, [start, end]), start, end };
}

export function openTripWizard(existing) {
  let trip = existing;
  let step = existing ? 0 : 0;

  const body = el('div');
  const actions = el('div', { style: 'display:flex; gap:8px; width:100%' });
  const s = sheet({
    title: existing ? 'עריכת טיול' : 'טיול חדש',
    body,
    actions: [actions],
  });

  const done = () => { s.close(); refresh(); };

  async function render() {
    body.replaceChildren();
    actions.replaceChildren();

    body.append(el('div', { class: 'sub', style: 'margin-block-end:8px',
      text: `שלב ${step + 1} מתוך ${STEPS.length} · ${STEPS[step]}` }));

    if (step === 0) await stepDetails();
    else if (step === 1) await stepSegments();
    else if (step === 2) await stepBudget();
    else await stepPrep();
  }

  function nav({ nextLabel = 'המשך', onNext, skip = true }) {
    if (step > 0) {
      actions.append(el('button', {
        class: 'btn btn-tertiary', text: 'הקודם', onClick: () => { step--; render(); },
      }));
    }
    if (skip) {
      actions.append(el('button', {
        class: 'btn btn-tertiary btn-block', text: 'דלג', onClick: () => {
          if (step === STEPS.length - 1) done(); else { step++; render(); }
        },
      }));
    }
    actions.append(el('button', { class: 'btn btn-primary btn-block', text: nextLabel, onClick: onNext }));
  }

  // ---- שלב 1: שם, תאריכים, מטבע ראשי ----
  async function stepDetails() {
    const name = el('input', { class: 'field', type: 'text', value: trip?.name || '',
      placeholder: 'לדוגמה: תאילנד 2027' });
    const range = dateRange(trip?.startDate, trip?.endDate);
    // כל המטבעות, לא רק הפעילים: מי שנוסע לפרו לא אמור לעבור דרך ההגדרות
    // כדי למצוא את הסול. בשמירה המטבע שנבחר מופעל אם עדיין אינו פעיל.
    const currency = el('select', { class: 'field' }, Object.keys(cur.NAMES).map(c =>
      el('option', { value: c, selected: (trip?.currency || 'ILS') === c, text: cur.label(c) })));

    body.append(
      field('שם הטיול', name),
      el('label', { class: 'field-label', style: 'margin-block-start:12px', text: 'טווח התאריכים של הטיול' }),
      range.node,
      field('מטבע ראשי', currency),
      el('p', { class: 'sub',
        text: 'התאריכים כאן הם מקור האמת לכל לוח הזמנים. אפשר להשלים אותם אחר כך.' }),
    );

    nav({
      skip: false,
      nextLabel: trip ? 'שמור והמשך' : 'צור והמשך',
      onNext: async () => {
        try {
          const active = await cur.listActive();
          if (!active.includes(currency.value)) await cur.setActive([...active, currency.value]);
          const data = {
            name: name.value,
            startDate: range.start.value || null,
            endDate: range.end.value || null,
            currency: currency.value,
            totalBudget: trip?.totalBudget || 0,
          };
          trip = trip ? await trips.updateTrip({ ...trip, ...data }) : await trips.createTrip(data);
          setActiveTrip(trip.id);
          step++;
          await render();
        } catch (err) { toast(err.message, 'error'); }
      },
    });
  }

  // ---- שלב 2: יעדים ומקטעי זמן ----
  async function stepSegments() {
    const segs = (await it.listSegments(trip.id)).filter(x => x.kind !== 'general');
    const city = el('input', { class: 'field', type: 'text', placeholder: 'לדוגמה: בנגקוק' });
    const range = dateRange(null, null, { min: trip.startDate || undefined, max: trip.endDate || undefined });

    body.append(
      segs.length
        ? el('div', {}, segs.map(seg => el('div', { class: 'row' }, [
            el('div', { class: 'grow' }, [
              el('div', { class: 'row-title', text: seg.city }),
              el('div', { class: 'sub', text: fmtDateRange(seg.startDate, seg.endDate) }),
            ]),
            el('button', {
              class: 'icon-btn', style: 'color:var(--color-danger)', 'aria-label': `מחק את ${seg.city}`,
              html: icon('trash'),
              onClick: async () => { await it.removeSegment(trip.id, seg.id); await render(); },
            }),
          ])))
        : el('p', { class: 'dim', style: 'margin:0', text: 'עוד לא הוספת יעדים.' }),
      el('div', { class: 'hairline', style: 'margin-block-start:12px; padding-block-start:12px' }, [
        field('יעד חדש', city),
        el('label', { class: 'field-label', text: 'טווח התאריכים ביעד' }),
        range.node,
        el('button', {
          class: 'btn btn-secondary btn-block', style: 'margin-block-start:8px',
          html: `${icon('plus')}<span>הוסף יעד</span>`,
          onClick: async () => {
            try {
              await it.saveSegment(trip.id, {
                city: city.value, startDate: range.start.value, endDate: range.end.value,
                currency: trip.currency,
              });
              await render();
            } catch (err) { toast(err.message, 'error'); }
          },
        }),
      ]),
    );

    nav({ onNext: async () => { step++; await render(); } });
  }

  // ---- שלב 3: תקרה והקצאות ----
  async function stepBudget() {
    const segs = (await it.listSegments(trip.id)).filter(x => x.kind !== 'general');
    const ceiling = el('input', {
      class: 'field', type: 'number', inputmode: 'decimal', step: '1', value: trip.totalBudget || '',
    });
    const inputs = new Map();

    body.append(field(`תקרת תקציב כוללת (${trip.currency})`, ceiling));
    if (segs.length) {
      body.append(el('div', { class: 'field-label', style: 'margin-block-start:16px', text: 'הקצאה לכל יעד' }));
      for (const seg of segs) {
        const input = el('input', {
          class: 'field', type: 'number', inputmode: 'decimal', step: '1', value: seg.allocation || '',
          style: 'max-width:140px',
        });
        inputs.set(seg.id, { seg, input });
        body.append(el('div', { class: 'row' }, [
          el('span', { class: 'grow', text: seg.city }),
          input,
        ]));
      }
    }

    nav({
      onNext: async () => {
        try {
          trip = await trips.updateTrip({ ...trip, totalBudget: Number(ceiling.value) || 0 });
          for (const { seg, input } of inputs.values()) {
            await it.saveSegment(trip.id, { ...seg, allocation: Number(input.value) || 0 });
          }
          const b = await trips.budgetSummary(trip.id);
          if (b.over) toast(`ההקצאות חורגות מהתקרה ב-${fmtMoney(-b.unallocated, trip.currency)}`, 'warning');
          step++;
          await render();
        } catch (err) { toast(err.message, 'error'); }
      },
    });
  }

  // ---- שלב 4: מילוי ראשוני של רשימת ההכנה ----
  async function stepPrep() {
    body.append(el('p', { class: 'dim', style: 'margin:0 0 12px',
      text: 'אפשר למלא את רשימת ההכנה מהקטלוג עכשיו, או לדלג ולעשות זאת בכל שלב מהטאב "רשימת הכנה".' }));
    for (const [stage, label] of [['before', 'לפני הטיול'], ['during', 'במהלך השהייה'], ['after', 'בחזרה']]) {
      body.append(el('button', {
        class: 'btn btn-tertiary btn-block', style: 'margin-block-start:8px',
        html: `${icon('plus')}<span>${label} — בחר מהקטלוג</span>`,
        onClick: () => { s.close(); openCatalogSheet(trip.id, stage); },
      }));
    }
    nav({ nextLabel: 'סיום', skip: false, onNext: done });
  }

  render();
}
