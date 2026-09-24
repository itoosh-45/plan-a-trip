// מריץ בדיקות מינימלי לדפדפן. אין תלות חיצונית.
const out = () => document.getElementById('results');

export function assertEqual(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg || 'assertEqual'}: קיבלנו ${a}, ציפינו ${e}`);
}

export function assertClose(actual, expected, epsilon, msg) {
  if (Math.abs(actual - expected) > epsilon)
    throw new Error(`${msg || 'assertClose'}: קיבלנו ${actual}, ציפינו ${expected} ±${epsilon}`);
}

export function assertTrue(cond, msg) {
  if (!cond) throw new Error(msg || 'assertTrue נכשל');
}

export async function assertThrows(fn, msg) {
  try { await fn(); } catch { return; }
  throw new Error(msg || 'assertThrows: לא נזרקה שגיאה');
}

export function suite(name) {
  const box = document.createElement('section');
  const h = document.createElement('h2');
  h.textContent = name;
  box.appendChild(h);
  out().appendChild(box);
  const queue = [];
  let pass = 0, fail = 0;

  return {
    test(label, fn) { queue.push([label, fn]); },
    async done() {
      for (const [label, fn] of queue) {
        const row = document.createElement('div');
        try {
          await fn();
          pass++;
          row.className = 'ok';
          row.textContent = `PASS · ${label}`;
        } catch (err) {
          fail++;
          row.className = 'bad';
          row.textContent = `FAIL · ${label} — ${err.message}`;
        }
        box.appendChild(row);
      }
      const sum = document.createElement('div');
      sum.className = fail ? 'bad total' : 'ok total';
      sum.textContent = `${name}: ${pass} עברו, ${fail} נכשלו`;
      box.appendChild(sum);
      window.__testTotals = window.__testTotals || { pass: 0, fail: 0 };
      window.__testTotals.pass += pass;
      window.__testTotals.fail += fail;
      return { pass, fail };
    }
  };
}
