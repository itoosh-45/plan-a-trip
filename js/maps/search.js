export function parseGoogleMapsLink(input) {
  let url;
  try { url = new URL(input); } catch { throw new Error('הקישור אינו תקין'); }
  const hosts = ['google.com', 'www.google.com', 'maps.google.com', 'maps.app.goo.gl', 'goo.gl'];
  if (url.protocol !== 'https:' || !hosts.includes(url.hostname)) throw new Error('הדביקו קישור של Google Maps');
  if (url.hostname === 'maps.app.goo.gl' || url.hostname === 'goo.gl') return { resolveUrl: url.href };
  const explicit = url.searchParams.get('query') || url.searchParams.get('q') || url.searchParams.get('destination');
  const embedded = url.pathname.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  const pair = explicit?.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  const match = pair || embedded;
  if (match) {
    const lat = Number(match[1]), lng = Number(match[2]);
    if (Math.abs(lat) <= 85.05112878 && Math.abs(lng) <= 180) return { coordinates: { lat, lng } };
  }
  const place = url.pathname.match(/\/place\/([^/]+)/);
  return { needsManualSelection: true, query: explicit || (place ? decodeURIComponent(place[1]).replaceAll('+', ' ') : '') };
}
export async function resolveLink(input) {
  let result = parseGoogleMapsLink(input);
  if (result.resolveUrl) {
    const response = await fetch('./api/resolve-map-link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: result.resolveUrl }) });
    if (!response.ok) throw new Error('לא ניתן לפענח את הקישור. חפשו את המקום או בחרו אותו במפה');
    result = parseGoogleMapsLink((await response.json()).url);
  }
  return result;
}
export async function searchPlaces(query, { signal } = {}) {
  if (!navigator.onLine) throw new Error('חיפוש דורש אינטרנט. המקומות ששמרתם זמינים במפה');
  const q = query.trim().slice(0, 160);
  if (q.length < 2) return [];
  const response = await fetch(`./api/map-search?q=${encodeURIComponent(q)}`, { signal });
  if (!response.ok) throw new Error('החיפוש אינו זמין כרגע. אפשר לבחור מיקום על המפה');
  return (await response.json()).places;
}
