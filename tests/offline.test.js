import { suite, assertEqual, assertTrue } from './harness.js';

async function text(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.text();
}

export default async function () {
  const s = suite('אופליין והתקנה');

  s.test('בדיקת השפיות של המנגנון: נתיב שאינו קיים אכן מחזיר כישלון', async () => {
    const res = await fetch('../js/definitely-not-here.js');
    assertEqual(res.ok, false, 'קובץ שלא קיים החזיר 200 — הבדיקות הבאות חסרות ערך');
  });

  s.test('כל קובץ ברשימת המטמון של ה-Service Worker קיים בפועל', async () => {
    const src = await text('../sw.js');
    const list = src.match(/const SHELL = \[([\s\S]*?)\];/)[1];
    const urls = [...list.matchAll(/'([^']+)'/g)].map(m => m[1]).filter(u => u !== './');
    const missing = [];
    for (const url of urls) {
      const res = await fetch(url.replace('./', '../'));
      if (!res.ok) missing.push(url);
    }
    assertEqual(missing, [], 'קבצים שנרשמו למטמון אך אינם קיימים');
  });

  // רשימה קשיחה של מודולים לא תופסת מודול חדש שנשכח במטמון, ולכן הבדיקה
  // הזו הולכת בעקבות ה-import-ים עצמם, מ-index.html והלאה.
  s.test('כל מודול שהאפליקציה מייבאת בפועל נמצא ברשימת המטמון', async () => {
    const [sw, index] = await Promise.all([text('../sw.js'), text('../index.html')]);
    const root = new URL('../', location.href).href;
    const specs = src => [...src.matchAll(/from\s+'([^']+\.js)'/g)].map(m => m[1]);

    const seen = new Set();
    const queue = specs(index).map(spec => new URL(spec, `${root}index.html`).href);
    while (queue.length) {
      const url = queue.pop();
      if (seen.has(url) || !url.startsWith(root)) continue;
      seen.add(url);
      for (const spec of specs(await text(url))) queue.push(new URL(spec, url).href);
    }

    assertTrue(seen.size >= 20, `נמצאו רק ${seen.size} מודולים — המעקב אחרי ה-import-ים נשבר`);
    const missing = [...seen]
      .map(url => `./${url.slice(root.length)}`)
      .filter(rel => !sw.includes(`'${rel}'`))
      .sort();
    assertEqual(missing, [], 'מודולים שאינם נשמרים למטמון ולכן ישברו אופליין');
    assertTrue(index.includes("navigator.serviceWorker.register('./sw.js')"), 'ה-Service Worker אינו נרשם');
  });

  s.test('index.html אינו טוען דבר מהאינטרנט', async () => {
    const html = await text('../index.html');
    const external = [...html.matchAll(/(?:src|href)="(https?:)?\/\/[^"]+"/g)].map(m => m[0]);
    assertEqual(external, [], 'נשארה תלות חיצונית שתישבר אופליין');
  });

  s.test('manifest.json תקין, בעברית, ועם שלושה אייקונים', async () => {
    const manifest = JSON.parse(await text('../manifest.json'));
    assertEqual([manifest.lang, manifest.dir, manifest.display], ['he', 'rtl', 'standalone']);
    assertEqual(manifest.icons.length, 3);
    for (const ic of manifest.icons) {
      const res = await fetch(ic.src.replace('./', '../'));
      assertTrue(res.ok, `האייקון ${ic.src} חסר`);
    }
  });

  s.test('ה-Service Worker אינו מגיש שערי מטבע מהמטמון', async () => {
    const src = await text('../sw.js');
    assertTrue(
      src.includes('url.origin !== self.location.origin'),
      'בקשות חיצוניות אינן מוחרגות — שער ישן עלול להיות מוגש כאילו הוא טרי'
    );
  });

  await s.done();
}
