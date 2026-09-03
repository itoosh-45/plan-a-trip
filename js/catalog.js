let cache = null;

/** טוען את קטלוג ההכנה (519 פריטים, קריאה בלבד) פעם אחת ומטמין בזיכרון. */
export async function load() {
  if (cache) return cache;
  const res = await fetch('./data/prep-catalog.json');
  if (!res.ok) throw new Error('לא ניתן לטעון את קטלוג ההכנה');
  cache = await res.json();
  return cache;
}

const PHASE_ORDER = ['לפני', 'בדרך', 'בשהות', 'בחזרה'];

function uniqueInOrder(values) {
  const seen = new Set();
  const out = [];
  for (const v of values) {
    if (!seen.has(v)) { seen.add(v); out.push(v); }
  }
  return out;
}

export async function phases() {
  const cat = await load();
  const present = new Set(cat.map(x => x.phase));
  return PHASE_ORDER.filter(p => present.has(p));
}

export async function sections(phase) {
  const cat = await load();
  return uniqueInOrder(cat.filter(x => x.phase === phase).map(x => x.section));
}

export async function topics(phase, section) {
  const cat = await load();
  return uniqueInOrder(cat.filter(x => x.phase === phase && x.section === section).map(x => x.topic));
}

export async function byTopic(phase, section, topic) {
  const cat = await load();
  return cat.filter(x => x.phase === phase && x.section === section && x.topic === topic);
}

export async function search(q) {
  const cat = await load();
  const needle = (q || '').trim().toLowerCase();
  if (!needle) return [];
  return cat.filter(x =>
    x.text.toLowerCase().includes(needle) ||
    x.topic.toLowerCase().includes(needle) ||
    x.section.toLowerCase().includes(needle) ||
    (x.group || '').toLowerCase().includes(needle)
  );
}
