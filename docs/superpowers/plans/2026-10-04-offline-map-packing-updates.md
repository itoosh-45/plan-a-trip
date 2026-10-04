# Offline Map, Packing Quantities and Updates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Inline execution is the default proposal; do not dispatch subagents without the user's explicit selection.

**Goal:** Add a trip planning map with complete downloaded-region viewing offline, packing quantities and safe application updates, then provide a separate phone-accessible preview before any main merge.

**Architecture:** Keep the existing static ES-module application and its main IndexedDB schema. A separate map database stores personal map planning and chunked archives, while vendored MapLibre and PMTiles render local archives. A separate Cloudflare preview worker serves the static shell, a map search/link resolver and a package manifest; map package generation is a separate explicit preparation job, not runtime work inside the browser or Worker.

**Tech Stack:** Existing HTML/CSS/JavaScript modules, IndexedDB, Service Worker, MapLibre GL JS, PMTiles JS and extraction CLI, Cloudflare Worker static assets and R2 for prepared archives.

**Spec:** [Approved design](../specs/2026-10-04-offline-map-packing-updates-design.md)

## Global Constraints

- iPhone first; Android supported. Existing Hebrew RTL, token palette and SVG icon system remain.
- No geolocation, tracking, recording or turn-by-turn routing.
- Viewing all downloaded map content and saved place details requires no network. Search can require network.
- No map data in any local backup, including points, coordinates, routes, downloaded packages or package metadata.
- Packing checkbox completes the full quantity. Counts refer to distinct rows, as approved.
- No new recommendations, start-packing flow or category sorting.
- No main push/merge and no replacement of the production deployment before user review of a separate preview and explicit approval.
- No paid resource provisioning without approval. Do not claim country coverage before real package generation, integrity verification and phone testing.

## Task 1: Establish a branch, preview hosting and real archive source

**Files:** Create `wrangler.preview.jsonc`, `worker/index.js`, `scripts/maps/build-package.ps1`, `data/map-packages.json`, `docs/map-operations.md`. Do not modify production deployment settings.

**Interfaces:** `GET /api/map-packages` returns `{ version: 1, packages: MapPackage[] }`; `MapPackage` has `{ id, name, kind, bounds, minZoom, maxZoom, version, bytes, chunkBytes, chunks: [{ index, bytes, sha256 }], url, attribution }`. `kind` is `city`, `region` or `country`. `url` points to an immutable archive.

- [ ] Inspect installed `node`, `python`, `gh`, `wrangler` and Cloudflare login status without printing credentials. Confirm how the existing production site is deployed and whether a preview URL and an R2 bucket can be created with available permissions. Record concrete account/project identifiers and required scopes in operations documentation, without secret values.
- [ ] Create branch `codex/offline-map-packing-updates`. Stage only task files, never the existing untracked `graphify-out/` folder.
- [ ] Configure a distinct Worker named `plan-a-trip-preview`, with static assets and R2 binding `MAP_PACKAGES`. Use `run_worker_first` only for `/api/*`; static shell paths remain relative to the deployment root. A preview R2 namespace must not contain personal trip data.
- [ ] Pin MapLibre, PMTiles and archive-generation binaries to released versions after checking their official documentation and licenses. Download vendored runtime files and license notices into `vendor/`. Do not leave CDN dependencies in the final shell.
- [ ] Prepare the extraction command and publish only verified outputs. The operations command accepts an explicit source archive, approved polygon/bounds, package identity and kind:

```powershell
param(
  [Parameter(Mandatory)][string]$SourceArchive,
  [Parameter(Mandatory)][string]$OutputArchive,
  [Parameter(Mandatory)][string]$RegionGeoJson
)
pmtiles extract $SourceArchive $OutputArchive --region=$RegionGeoJson --maxzoom=15
if ($LASTEXITCODE -ne 0) { throw 'Map extraction failed' }
pmtiles verify $OutputArchive
if ($LASTEXITCODE -ne 0) { throw 'Map verification failed' }
```

- [ ] Use a licensed Protomaps basemap release copied to project-controlled storage, or a provider that explicitly permits archive redistribution and offline use. Serve archives with CORS and Range support; never proxy tile.openstreetmap.org into a downloader. Compute actual archive length and SHA-256 for each 4 MiB chunk; generate manifest from these outputs, not guessed sizes.
- [ ] Prepare one real city, region and country package for preview. Prefer destinations already present in the user's trip data when available. If no destination is available, use Jerusalem city, Jerusalem district and Israel as the explicit preview coverage; document this as initial coverage rather than worldwide availability. A country must use its complete licensed polygon and include all declared zoom levels.
- [ ] If credentials or allowed storage cannot support publishing archives, record the precise unavailable capability and ask for it while continuing packing, updates and local rendering work. Do not publish fake downloads or reduce the agreed functionality silently.

**Validation:** Read manifest, compare each `bytes` sum with real file size and download an archive from the preview origin. Verify a Range request returns the requested bytes. Do not announce a preview ready until the rendering and offline acceptance tasks pass.

## Task 2: Quantities and packing summary

**Files:** Modify `js/prep.js`, `js/screens/prep.js`, `css/app.css`, `tests/prep.test.js`.

**Interfaces:** `saveTask(tripId, task)` accepts `quantity`; `listTasks` normalizes absent legacy quantities to 1. Existing `progress` continues counting rows. `done` remains boolean.

- [ ] Add quantity validation and normalization without rewriting every old record at startup:

```js
export function readQuantity(value) {
  if (value == null || value === '') return 1;
  const quantity = Number(value);
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new Error('הכמות חייבת להיות מספר שלם וחיובי');
  }
  return quantity;
}
```

- [ ] Extend the browser suite with real save, reload and checkbox behavior:

```js
s.test('quantity is saved and one checkbox completes the whole row', async () => {
  const trip = await freshTrip();
  const task = await prep.saveTask(trip.id, { title: 'חולצות', quantity: 5 });
  await prep.toggleDone(trip.id, task.id);
  const rows = await prep.listTasks(trip.id);
  assertEqual(rows[0].quantity, 5);
  assertEqual(rows[0].done, true);
  assertEqual(await prep.progress(trip.id), { done: 1, total: 1 });
});
```

- [ ] Add a number field to the existing task sheet (`min=1`, `step=1`, `inputmode=numeric`), show ×N on rows and retain the existing trash action and confirmation. Add counters to existing list headings; use packed/remaining for gear and completed/remaining for preparation tasks. Do not add a new sorting control or duplicate existing drag behavior.
- [ ] Run the existing browser tests from `test.html`, then visually inspect 390 px and 360 px widths. Verify negative, zero and decimal quantities fail without writing changes; legacy rows render ×1 and quantity survives backup/restore.
- [ ] Commit the independently verified packing change on the feature branch.

## Task 3: Isolated map storage and backup boundary

**Files:** Create `js/maps/store.js`, `tests/maps-store.test.js`. Modify `js/trips.js`, `js/backup.js`, `test.html`.

**Interfaces:** `useTestDatabase()`, `savePlace(place)`, `listPlaces(tripId)`, `deletePlace(id)`, `deleteTripPlaces(tripId)`, `clearPlaces()`, `putPackage(packageInfo)`, `listPackages()`, `putChunk(packageId, index, blob)`, `getChunk(packageId, index)`, `deletePackage(packageId)`.

`Place = { id, tripId, itemId: string|null, role: 'departure'|'arrival'|null, type, title, address, notes, date, order, lat, lng }`. Validate finite coordinates (`lat` -85.05112878 through 85.05112878 for the chosen map projection, `lng` -180 through 180), non-empty title and trip identity before writing. Validate the referenced itinerary item belongs to the same trip. Display missing/deleted item links as unlinked places.

- [ ] Build IndexedDB database `trip-planner-maps`, version 1, with `places` (tripId index), `packages` and `chunks` (compound packageId/index key). Test database name must end in `-test`; never touch the real database from tests. Every write awaits transaction completion before resolving.
- [ ] Test exclusion by saving a unique sentinel place and archive chunk, exporting full and trip backups and checking for the sentinel and coordinates. Do not add the map stores or settings to the main schema or `TRIP_SCOPED`.

```js
const sentinel = 'map-only-sentinel-20261004';
await maps.savePlace({ tripId: trip.id, title: sentinel, lat: 31.78, lng: 35.22 });
const full = await backup.buildBackup();
const single = await backup.buildBackup(trip.id);
assertTrue(!full.json.includes(sentinel));
assertTrue(!single.json.includes(sentinel));
```

- [ ] On trip deletion, remove associated places while retaining shared archives. On full replacement restore, clear map planning before replacing main trip identities; retain packages. On trip-copy restore, leave copied trip without map records. Add explicit feedback if cleanup fails rather than pretending the operation fully succeeded.
- [ ] Test storage errors propagate, package deletion removes only its chunks, and another trip's places and archive remain intact.
- [ ] Commit after browser suite passes.

## Task 4: Download manager and local PMTiles reader

**Files:** Create `js/maps/packages.js`, `js/maps/source.js`, `tests/maps-packages.test.js`. Consume Task 1 manifest and Task 3 store.

**Interfaces:** `downloadPackage(metadata, { signal, onProgress })`, `getPackageStatus(id)`, `removePackage(id)`, `getLocalSource(id)` returning a PMTiles `Source` implementation with `getKey()` and `getBytes(offset, length, signal)`.

- [ ] Download 4 MiB chunks with Range requests, verify SHA-256 using Web Crypto and compare server version/ETag before recording them. If the server returns 200 to a partial request, reject for large archives instead of buffering the entire country file. Compute received bytes from completed, verified chunks.
- [ ] Compare manifest bytes with storage estimate if available and still catch QuotaExceededError. Mark status `downloading`, `partial`, `ready` or `failed`. Ready requires every chunk plus the local renderer dependencies; interruption and abort cannot leave ready status. Permit retry of verified chunks only when the manifest version matches.
- [ ] Implement cross-chunk range reads without loading entire archives:

```js
// For each chunk overlapping [offset, offset + length):
const localStart = Math.max(0, offset - chunkStart);
const localEnd = Math.min(blob.size, offset + length - chunkStart);
const part = new Uint8Array(await blob.slice(localStart, localEnd).arrayBuffer());
// Copy parts into one Uint8Array(length); return { data: result.buffer }.
```

- [ ] Test ranges within one chunk, across two chunks and at EOF; reject missing bytes. Test interruption, digest mismatch, changing ETag and insufficient storage using small fixed binary fixtures and a mock fetch boundary. Store real chunks through the map test database.
- [ ] Ensure overlapping regions can both be registered, with more detailed packages preferred in their declared coverage and no silent network requests when offline. Provide a visible out-of-coverage message for unsupported area/zoom.
- [ ] Commit after deterministic tests and real archive rendering pass.

## Task 5: Map display, points and full screen

**Files:** Create `js/maps/render.js`, `js/maps/places.js`, `js/screens/map.js`, `css/map.css`. Modify `js/app.js`, `js/icons.js`, `index.html`, `sw.js`.

**Interfaces:** `createMap(container, { packages, places, onPick })` returns `{ updatePlaces(places), fitPlaces(), resize(), destroy() }`; `mount(host, tripId)` registers as screen `map`.

- [ ] Add a sixth tab with a map SVG and keep each touch target at least 44 px. Load local MapLibre runtime/CSS and local style, glyphs and sprites. Test the library's Hebrew text behavior; vendor any necessary RTL dependency locally. Point map sources to local archive readers when ready.
- [ ] Keep map creation after its host is connected to the document; add lifecycle cleanup to app mounting to prevent WebGL context and observer leaks when switching tabs or refreshing data. Prevent refresh from recreating an open form or discarding a typed place.
- [ ] Render numbered markers with type icons and safe text nodes. Filter by selected date or all dates; sort by date and order. Build GeoJSON `LineString` only for two or more locations and label it as planned order rather than a driving route.

```js
const route = {
  type: 'Feature', properties: {},
  geometry: { type: 'LineString', coordinates: places.map(p => [p.lng, p.lat]) }
};
```

- [ ] Build the existing-style sheet for title, address, notes, date, type, item linkage and role. Support two separate flight points. Long-press picking cancels on movement to avoid creating places during panning; desktop offers an explicit pick mode.
- [ ] Full-screen mode uses a fixed overlay with `100dvh`, safe-area padding, explicit exit and Escape/back handling. Call map resize after transitions and orientation changes; use ResizeObserver and disconnect it on destroy. Native fullscreen is optional, never the only path.
- [ ] Inspect rendering at phone widths, keyboard open, device rotation, tab switches and 30 repeated map openings. Check no geolocation permission is requested, no arbitrary HTML executes in marker labels and unsaved form input remains until saved/cancelled.
- [ ] Commit after tests and visual verification.

## Task 6: Online search and Google Maps links

**Files:** Create `js/maps/search.js`, `tests/maps-search.test.js`. Extend `worker/index.js` and map sheet.

**Interfaces:** `searchPlaces(query, { signal }) -> Promise<PlaceCandidate[]>`; `parseGoogleMapsLink(url) -> { coordinates } | { resolveUrl } | { needsManualSelection: true }`; `POST /api/resolve-map-link` and `GET /api/map-search?q=...`.

- [ ] Use a project-hosted Photon index or an explicitly permitted Photon service for preview. Confirm provider policy before selecting a public demo endpoint; do not assume unlimited usage. If a service is unavailable, surface it honestly and retain manual coordinate/map entry.
- [ ] Proxy search with a short cache, rate limit, maximum query length and bounded timeout. Return only name/address/coordinates required by planning. Debounce input 350 ms, cancel previous queries and ignore stale responses. Show offline search-unavailable state while saved-place viewing remains functional.
- [ ] Parse only known Google Maps hosts. Recognize unambiguous `query=lat,lng` and destination-coordinate formats; do not interpret `@lat,lng` viewport center as a selected place. Ambiguous location strings must be searched and confirmed.

```js
assertEqual(parseGoogleMapsLink('https://www.google.com/maps?query=31.78,35.22'),
  { coordinates: { lat: 31.78, lng: 35.22 } });
assertEqual(parseGoogleMapsLink('https://www.google.com/maps/@31.78,35.22,12z'),
  { needsManualSelection: true });
```

- [ ] Resolve short links only through the Worker: validate every redirect hop, require HTTPS, allow only exact Google Maps/short-link hosts, limit hops and response size, and reject local/private destinations. Never expose a general URL fetch proxy.
- [ ] Test malformed URLs, wrong hosts, redirect abuse, offline, timeout and outdated result races. Persist confirmed candidate content in the map database so display never repeats the search offline.
- [ ] Commit after provider confirmation and endpoint tests.

## Task 7: Safe updates and storage status

**Files:** Create `js/updates.js`, `tests/updates.test.js`. Modify `sw.js`, `index.html`, `js/screens/settings.js`, `tests/offline.test.js`.

**Interfaces:** `checkForUpdate() -> Promise<{ state: 'current'|'available'|'offline' }>`; `applyUpdate() -> Promise<void>`; `getStorageStatus() -> Promise<{ persisted: boolean|null, usage: number|null, quota: number|null }>`.

- [ ] Service Worker caches all required shell assets including map resources. Replace partial install acceptance with atomic `cache.addAll`; use a new shell cache name and delete the failed install cache on failure. A previously active shell stays usable when installation fails.
- [ ] Remove automatic skipWaiting on updates; use a validated message only after the user chooses to install:

```js
self.addEventListener('message', event => {
  if (event.data?.type === 'APPLY_UPDATE') self.skipWaiting();
});
// During activate:
for (const key of await caches.keys()) {
  if (key.startsWith('trip-planner-shell-') && key !== CACHE) await caches.delete(key);
}
```

- [ ] Handle the legacy cache prefix deliberately: remove only known application shell names, never unrelated origin caches. Keep map archives in their separate DB, and test a sentinel unrelated cache survives.
- [ ] Register once and implement settings update states with double-click prevention. Wait for installing worker state transitions; controllerchange refreshes once only after user-requested apply. Do not refresh during open unsaved forms, database writes or map download; expose a clear finish-current-action prompt.
- [ ] Read the actual persist result and estimate in settings. Handle unsupported Storage API as unknown, not a successful persistence guarantee. Continue surfacing real save failure through the existing toast path.
- [ ] Test two successive versions, install failure, offline check and unchanged worker. After update, verify the saved trip, quantities, map sentinel place and complete archive remain readable.
- [ ] Commit after tests pass.

## Task 8: Verification, separate preview and correction cycle

**Files:** Update `docs/map-operations.md`; add `docs/preview-testing.md`. Do not change main or production configuration.

- [ ] Run all existing and new browser suites and record actual pass/fail totals. Check git diff and perform code review for download/storage safety, backup boundaries, render lifecycle and update atomicity. Fix failures before preview handoff.
- [ ] Deploy only `plan-a-trip-preview` and verify the real HTTPS URL. If creating a draft PR, attach it to the chat. Never enable auto-merge.
- [ ] In an isolated browser profile, prepare a trip and places, download each real package type, enter offline mode, close/reopen the app and inspect labels, roads, markers and notes. Verify no online dependency is necessary for downloaded-area viewing. Record tested archive sizes, bounds and zoom levels.
- [ ] Deliver the preview link with short iPhone steps: open, add to Home Screen, download region, wait for ready, switch to airplane mode, reopen map. Clearly distinguish automated checks from on-device checks awaiting the user's phone.
- [ ] Keep preview URL stable through corrections. User findings are addressed on the feature branch and preview deployment.
- [ ] Only after explicit user acceptance: propose main integration. This checkbox cannot be marked complete based on spec or plan approval.

## Review and execution status

Spec coverage: point planning, all four input paths, airport roles, date/order, full-window mode, city/region/country downloads, real sizes, deletion, complete local render dependencies, backup exclusion, quantity semantics, storage errors, atomic updates and separate preview are covered by Tasks 1–8.

The initial geographic coverage proposal is Jerusalem city/district and Israel if existing trip destinations cannot be determined. Costs and account availability are checked before provisioning. Wider coverage uses the same package preparation pipeline; the UI must display only actually prepared packages.

The user approved this plan and inline execution. During implementation the user selected Thailand and its regions, Israel and Georgia as the first real package coverage. These replaced the initial Jerusalem/Israel proposal.

## Execution report — 2026-10-04

- Packing quantities, counters, isolated map planning, bounded/chunked archive download, full-window map, place search/link resolution, safe update and storage status were implemented.
- All eight requested country/region/city archives were prepared from the verified 2026-10-03 data release, verified, chunked and hashed. Their generated files remain outside Git and are served through the preview-only asset server.
- 246 browser tests passed. Separate browser smoke tests passed for real downloaded Bangkok viewing after offline reload and for preservation of data across a successful and failed Service Worker update.
- Permanent Cloudflare account credentials were not available, and the local GitHub CLI token was invalid. A verified temporary HTTPS preview tunnel was used instead of provisioning a paid resource or changing production. `docs/map-operations.md` records the hosting limitation and permanent-preview configuration.
- On-device iPhone/Android testing and the user's correction cycle remain the next review stage. Main integration is explicitly pending user approval after that stage.
