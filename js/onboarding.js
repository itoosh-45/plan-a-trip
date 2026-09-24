import * as trips from './trips.js';
import * as it from './itinerary.js';
import * as cur from './currencies.js';
import * as prep from './prep.js';
import * as rates from './rates.js';
import {
  el, sheet, toast, icon, fieldRow, requiredNote, flashRequired, amountField,
  fmtMoney, fmtDateRange,
} from './ui.js';
import { dateRangeField } from './daterange.js';
import { refresh, setActiveTrip } from './app.js';
import { openCatalogSheet } from './screens/prep.js';
import { ensureTripCovers } from './screens/plan.js';

/**
 * ארבעת השלבים. optional אינו קישוט: שלב שאפשר לדלג עליו אומר זאת כבר
 * בשורת הכותרת שלו, ולא רק בכפתור "דלג" שבתחתית.
 */
const STEPS = [
  { label: 'פרטי הטיול' },
  { label: 'יעדים', optional: true },
  { label: 'תקציב', optional: true },
  { label: 'רשימת הכנה', optional: true },
];

/** הערה שמופיעה בשלב שאין בו אף שדה חובה — הכוכבית לא מופיעה סתם. */
const optionalNote = text => el('p', { class: 'sub', style: 'margin:0 0 12px', text });

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

    const { label, optional } = STEPS[step];
    body.append(el('div', { class: 'sub', style: 'margin-block-end:8px',
      text: `שלב ${step + 1} מתוך ${STEPS.length} · ${label}${optional ? ' · אפשר לדלג' : ''}` }));

    if (step === 0) await stepDetails();
    else if (step === 1) await stepSegments();
    else if (step === 2) await stepBudget();
    else await stepPrep();
  }

  function nav({ nextLabel = 'המשך ←', onNext, skip = true }) {
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
    const range = dateRangeField({
      startDate: trip?.startDate, endDate: trip?.endDate, label: 'טווח התאריכים של הטיול',
    });
    // כל המטבעות, לא רק הפעילים: מי שנוסע לפרו לא אמור לעבור דרך ההגדרות
    // כדי למצוא את הסול. בשמירה המטבע שנבחר מופעל אם עדיין אינו פעיל.
    const currency = el('select', { class: 'field' }, Object.keys(cur.NAMES).map(c =>
      el('option', { value: c, selected: (trip?.currency || 'ILS') === c, text: cur.label(c) })));

    body.append(
      requiredNote('חובה למלא רק שדה שמסומן בכוכבית — כאן שם הטיול בלבד. לחצו כאן כדי לסמן אותו.'),
      fieldRow('שם הטיול', name, { required: true }),
      fieldRow('טווח התאריכים של הטיול', range.node),
      fieldRow('מטבע ראשי', currency),
      el('p', { class: 'sub',
        text: 'התאריכים כאן הם מקור האמת לכל לוח הזמנים, ואפשר להשלים אותם אחר כך. גם המטבע והתקציב ניתנים לשינוי בכל רגע.' }),
    );

    nav({
      skip: false,
      nextLabel: trip ? 'שמור והמשך' : 'צור והמשך',
      onNext: async () => {
        try {
          const active = await cur.listActive();
          if (!active.includes(currency.value)) await cur.setActive([...active, currency.value]);
          const picked = range.read();
          const data = {
            name: name.value,
            startDate: picked.startDate || null,
            endDate: picked.endDate || null,
            currency: currency.value,
            totalBudget: trip?.totalBudget || 0,
          };
          trip = trip ? await trips.updateTrip({ ...trip, ...data }) : await trips.createTrip(data);
          setActiveTrip(trip.id);
          step++;
          await render();
        } catch (err) {
          toast(err.message, 'error');
          flashRequired(body, { onlyEmpty: true });
        }
      },
    });
  }

  // ---- שלב 2: יעדים ומקטעי זמן ----
  async function stepSegments() {
    const segs = (await it.listSegments(trip.id)).filter(x => x.kind !== 'general');
    const city = el('input', { class: 'field', type: 'text', placeholder: 'לדוגמה: בנגקוק' });
    const prefill = it.defaultRange(trip, segs);
    const range = dateRangeField({ ...prefill, label: 'טווח התאריכים ביעד' });

    body.append(
      requiredNote('אפשר לדלג על השלב הזה. מי שמוסיף יעד — שם היעד והתאריכים הם חובה. לחצו כאן כדי לסמן אותם.'),
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
        fieldRow('יעד חדש', city, { required: true }),
        fieldRow('טווח התאריכים ביעד', range.node, { required: true }),
        el('button', {
          class: 'btn btn-secondary btn-block', style: 'margin-block-start:8px',
          html: `${icon('plus')}<span>הוסף יעד</span>`,
          onClick: async () => {
            try {
              const picked = range.read();
              const covering = await ensureTripCovers(trip, picked.startDate, picked.endDate);
              if (!covering) return;
              trip = covering;
              await it.saveSegment(trip.id, {
                city: city.value, startDate: picked.startDate, endDate: picked.endDate,
                currency: trip.currency,
              });
              await render();
            } catch (err) {
              toast(err.message, 'error');
              flashRequired(body, { onlyEmpty: true });
            }
          },
        }),
      ]),
    );

    nav({ onNext: async () => { step++; await render(); } });
  }

  // ---- שלב 3: תקרה והקצאות ----
  async function stepBudget() {
    const segs = (await it.listSegments(trip.id)).filter(x => x.kind !== 'general');
    // התקרה וההקצאות נשמרות כמספרים במטבע הטיול, ולכן סכום שהוזן בשקלים
    // (או בכל מטבע פעיל אחר) מומר כאן לפי השער השמור.
    const currencies = await cur.listActive();
    const fx = await rates.rateMap([...currencies, trip.currency]);
    const field = amount => amountField({
      amount: amount || '', currency: trip.currency, currencies, convertTo: trip.currency, fx,
    });

    const ceiling = field(trip.totalBudget);
    const inputs = new Map();

    body.append(
      optionalNote('אין בשלב הזה שדות חובה. תקציב שלא נקבע עכשיו לא חוסם דבר, ואפשר להזין אותו מאוחר יותר.'),
      fieldRow('תקרת תקציב כוללת', ceiling.node),
      el('p', { class: 'sub', style: 'margin:6px 0 0',
        text: `התקרה וההקצאות נשמרות במטבע הטיול (${cur.symbol(trip.currency)}). אפשר להזין בשקלים או בכל מטבע פעיל, והסכום יומר לפי השער השמור.` }),
    );
    if (segs.length) {
      body.append(el('div', { class: 'field-label', style: 'margin-block-start:16px', text: 'הקצאה לכל יעד' }));
      for (const seg of segs) {
        const input = field(seg.allocation);
        inputs.set(seg.id, { seg, input });
        body.append(el('div', { class: 'field-row' }, [
          el('label', { class: 'field-label', text: seg.city }),
          input.node,
        ]));
      }
    }

    const inTrip = (money, label) => {
      const value = money.readIn(trip.currency);
      if (value === null) {
        throw new Error(`אין שער המרה ל-${money.read().currency}, ולכן ${label} אינו ניתן להמרה למטבע הטיול`);
      }
      return value || 0;
    };

    nav({
      onNext: async () => {
        try {
          trip = await trips.updateTrip({ ...trip, totalBudget: inTrip(ceiling, 'התקציב') });
          for (const { seg, input } of inputs.values()) {
            await it.saveSegment(trip.id, { ...seg, allocation: inTrip(input, `התקציב של ${seg.city}`) });
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
    body.append(optionalNote(
      'גם כאן אין חובה: אפשר למלא את רשימת ההכנה מהקטלוג עכשיו, או לסיים ולעשות זאת בכל שלב מהטאב "הכנה".'));
    // הרשימות הקבועות מגיעות מ-prep.STAGES, ולכן רשימה חדשה שנוספת שם
    // מופיעה כאן מעצמה ולא נשכחת באשף
    for (const [stage, label] of Object.entries(prep.STAGES)) {
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
