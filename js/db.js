export const DB_NAME = 'trip-planner';
export const DB_VERSION = 1;

export const STORES = {
  trips: 'trips',
  segments: 'segments',
  items: 'items',
  expenses: 'expenses',
  wallets: 'wallets',
  walletTx: 'walletTx',
  prepTasks: 'prepTasks',
  categories: 'categories',
  budgets: 'budgets',
  fxRates: 'fxRates',
  settings: 'settings',
};

export const TRIP_SCOPED = [
  'segments', 'items', 'expenses', 'wallets', 'walletTx', 'prepTasks', 'categories', 'budgets',
];

const SCHEMA = {
  trips:      { keyPath: 'id',   indexes: [] },
  segments:   { keyPath: 'id',   indexes: ['tripId', 'startDate'] },
  items:      { keyPath: 'id',   indexes: ['tripId', 'date', 'segmentId'] },
  expenses:   { keyPath: 'id',   indexes: ['tripId', 'date'] },
  wallets:    { keyPath: 'id',   indexes: ['tripId', 'currency'] },
  walletTx:   { keyPath: 'id',   indexes: ['tripId', 'walletId'] },
  prepTasks:  { keyPath: 'id',   indexes: ['tripId', 'phase', 'catalogId'] },
  categories: { keyPath: 'id',   indexes: ['tripId'] },
  budgets:    { keyPath: 'id',   indexes: ['tripId', 'categoryId'] },
  fxRates:    { keyPath: 'pair', indexes: [] },
  settings:   { keyPath: 'key',  indexes: [] },
};

let dbName = DB_NAME;
let handle = null;

/** מעביר את המודול למסד בדיקות. לשימוש tests/ בלבד. */
export async function useTestDatabase() {
  if (handle) { handle.close(); handle = null; }
  dbName = `${DB_NAME}-test`;
  await open();
}

export function open() {
  if (handle) return Promise.resolve(handle);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, DB_VERSION);
    req.onupgradeneeded = () => {
      const idb = req.result;
      for (const [name, def] of Object.entries(SCHEMA)) {
        const store = idb.objectStoreNames.contains(name)
          ? req.transaction.objectStore(name)
          : idb.createObjectStore(name, { keyPath: def.keyPath });
        for (const ix of def.indexes) {
          if (!store.indexNames.contains(ix)) store.createIndex(ix, ix, { unique: false });
        }
      }
    };
    req.onsuccess = () => {
      handle = req.result;
      handle.onversionchange = () => { handle.close(); handle = null; };
      resolve(handle);
    };
    req.onerror = () => reject(new Error('לא ניתן לפתוח את מסד הנתונים המקומי'));
  });
}

function tx(stores, mode) {
  return open().then(idb => idb.transaction([].concat(stores), mode));
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('פעולת אחסון נכשלה'));
  });
}

function done(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror =
      () => reject(transaction.error || new Error('הפעולה בוטלה ולא נשמרה'));
  });
}

function emit(store, op, id) {
  document.dispatchEvent(new CustomEvent('data:changed', { detail: { store, op, id } }));
}

function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function assertStore(store) {
  if (!SCHEMA[store]) throw new Error(`אין טבלה בשם "${store}"`);
}

function prepare(store, record, now) {
  assertStore(store);
  const def = SCHEMA[store];
  const out = { ...record };

  if (def.keyPath === 'id' && !out.id) out.id = newId();
  if (def.keyPath !== 'id' && !out[def.keyPath]) {
    throw new Error(`רשומה בטבלה "${store}" חייבת לכלול ${def.keyPath}`);
  }
  if (TRIP_SCOPED.includes(store) && !out.tripId) {
    throw new Error(`רשומה בטבלה "${store}" חייבת להיות משויכת לטיול`);
  }
  if (!out.createdAt) out.createdAt = now;
  out.updatedAt = now;
  return out;
}

export async function put(store, record) {
  const now = new Date().toISOString();
  const row = prepare(store, record, now);
  if (row.createdAt === now && record?.id) {
    const existing = await get(store, record.id);
    if (existing?.createdAt) row.createdAt = existing.createdAt;
  }
  const t = await tx(store, 'readwrite');
  t.objectStore(store).put(row);
  await done(t);
  emit(store, 'put', row[SCHEMA[store].keyPath]);
  return row;
}

export async function bulkPut(store, records) {
  if (!records.length) return [];
  const now = new Date().toISOString();
  const rows = records.map(r => prepare(store, r, now));
  const t = await tx(store, 'readwrite');
  const os = t.objectStore(store);
  for (const row of rows) os.put(row);
  await done(t);
  emit(store, 'bulkPut', null);
  return rows;
}

export async function get(store, id) {
  assertStore(store);
  const t = await tx(store, 'readonly');
  return wrap(t.objectStore(store).get(id));
}

export async function all(store, tripId) {
  assertStore(store);
  const t = await tx(store, 'readonly');
  const os = t.objectStore(store);
  if (tripId && os.indexNames.contains('tripId')) {
    return wrap(os.index('tripId').getAll(tripId));
  }
  return wrap(os.getAll());
}

export async function remove(store, id) {
  assertStore(store);
  const t = await tx(store, 'readwrite');
  t.objectStore(store).delete(id);
  await done(t);
  emit(store, 'remove', id);
}

export async function removeWhere(store, tripId) {
  assertStore(store);
  const rows = await all(store, tripId);
  if (!rows.length) return 0;
  const key = SCHEMA[store].keyPath;
  const t = await tx(store, 'readwrite');
  const os = t.objectStore(store);
  for (const row of rows) os.delete(row[key]);
  await done(t);
  return rows.length;
}

export async function deleteTrip(tripId) {
  if (!tripId) throw new Error('לא צוין טיול למחיקה');
  const stores = [...TRIP_SCOPED, 'trips'];
  const t = await tx(stores, 'readwrite');
  for (const store of TRIP_SCOPED) {
    const os = t.objectStore(store);
    const req = os.index('tripId').getAllKeys(tripId);
    req.onsuccess = () => { for (const k of req.result) os.delete(k); };
  }
  t.objectStore('trips').delete(tripId);
  await done(t);
  emit('trips', 'deleteTrip', tripId);
}

export async function getSetting(key, fallback = null) {
  const row = await get(STORES.settings, key);
  return row === undefined ? fallback : row.value;
}

export async function setSetting(key, value) {
  await put(STORES.settings, { key, value });
}

export async function exportAll() {
  const stores = {};
  for (const name of Object.keys(SCHEMA)) stores[name] = await all(name);
  return { schema: DB_VERSION, exportedAt: new Date().toISOString(), stores };
}

export async function importAll(payload, mode = 'replace') {
  if (!payload || typeof payload !== 'object') {
    throw new Error('קובץ הייבוא ריק או אינו בפורמט הנכון');
  }
  if (!payload.stores || typeof payload.stores !== 'object' || Array.isArray(payload.stores)) {
    throw new Error('קובץ הייבוא חסר את המקטע "stores"');
  }
  const unknown = Object.keys(payload.stores).filter(k => !SCHEMA[k]);
  if (unknown.length) {
    throw new Error(`קובץ הייבוא מכיל טבלאות שאינן מוכרות: ${unknown.join(', ')}`);
  }
  for (const [name, rows] of Object.entries(payload.stores)) {
    if (!Array.isArray(rows)) throw new Error(`המקטע "${name}" בקובץ הייבוא אינו רשימה`);
    const key = SCHEMA[name].keyPath;
    const missing = rows.findIndex(r => !r || typeof r !== 'object' || !r[key]);
    if (missing !== -1) throw new Error(`בטבלה "${name}", רשומה ${missing + 1} חסרה שדה ${key}`);
  }

  if (mode === 'replace') await wipe(true);

  const counts = {};
  const names = Object.keys(payload.stores);
  const t = await tx(names, 'readwrite');
  for (const name of names) {
    const os = t.objectStore(name);
    for (const row of payload.stores[name]) os.put(row);
    counts[name] = payload.stores[name].length;
  }
  await done(t);
  emit('*', 'import', null);
  return { counts };
}

export async function wipe(silent = false) {
  const names = Object.keys(SCHEMA);
  const t = await tx(names, 'readwrite');
  for (const name of names) t.objectStore(name).clear();
  await done(t);
  if (!silent) emit('*', 'wipe', null);
}
