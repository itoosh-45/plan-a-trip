// Deliberately separate from db.js: no map record can enter a trip backup.
let name = 'trip-planner-maps';
let opening;
export function open() {
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('places', { keyPath: 'id' }).createIndex('tripId', 'tripId');
      db.createObjectStore('packages', { keyPath: 'id' });
      db.createObjectStore('chunks', { keyPath: ['packageId', 'index'] }).createIndex('packageId', 'packageId');
    };
    request.onerror = () => { opening = null; reject(request.error); };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); opening = null; };
      resolve(db);
    };
  });
  return opening;
}
export async function useTestDatabase() {
  if (opening) (await opening).close();
  name = 'trip-planner-maps-test'; opening = null;
}
async function transaction(store, mode, operation) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = tx.onabort = () => reject(tx.error || new Error('שמירת המפה נכשלה'));
    try {
      const request = operation(tx.objectStore(store));
      if (request) request.onsuccess = () => { result = request.result; };
    } catch (error) { tx.abort(); reject(error); }
  });
}
const read = (store, id) => transaction(store, 'readonly', s => s.get(id));
const write = (store, value) => transaction(store, 'readwrite', s => s.put(value));
const all = store => transaction(store, 'readonly', s => s.getAll());
const remove = (store, id) => transaction(store, 'readwrite', s => s.delete(id));

export async function savePlace(place) {
  const title = String(place.title || '').trim();
  const lat = Number(place.lat), lng = Number(place.lng);
  if (!place.tripId || !title) throw new Error('בחרו טיול והזינו שם למקום');
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 85.05112878 || Math.abs(lng) > 180) {
    throw new Error('המיקום אינו תקין');
  }
  const row = { ...place, id: place.id || crypto.randomUUID(), title, lat, lng, updatedAt: Date.now() };
  await write('places', row);
  return row;
}
export async function listPlaces(tripId) {
  const rows = await transaction('places', 'readonly', s => s.index('tripId').getAll(tripId));
  return rows.sort((a,b) => String(a.date || '').localeCompare(String(b.date || '')) || (a.order || 0) - (b.order || 0));
}
export const deletePlace = id => remove('places', id);
export const clearPlaces = () => transaction('places', 'readwrite', s => s.clear());
export async function deleteTripPlaces(tripId) {
  await transaction('places', 'readwrite', s => {
    const request = s.index('tripId').openCursor(IDBKeyRange.only(tripId));
    request.onsuccess = () => { const cursor = request.result; if (cursor) { cursor.delete(); cursor.continue(); } };
  });
}
export const putPackage = row => write('packages', row);
export const getPackage = id => read('packages', id);
export const listPackages = () => all('packages');
export const putChunk = (packageId, index, blob) => write('chunks', { packageId, index, blob });
export async function getChunk(packageId, index) { return (await read('chunks', [packageId, index]))?.blob; }
export async function deletePackage(id) {
  // Metadata is removed first, so an interrupted removal never advertises a ready map.
  await remove('packages', id);
  await transaction('chunks', 'readwrite', s => {
    const request = s.index('packageId').openCursor(IDBKeyRange.only(id));
    request.onsuccess = () => { const cursor = request.result; if (cursor) { cursor.delete(); cursor.continue(); } };
  });
}
