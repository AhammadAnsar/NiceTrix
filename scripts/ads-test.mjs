// Test build/hostname boundaries without requesting or clicking live ads.
// Google's published CMP, consent decisions and ad serving remain Google-owned.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { load } from 'cheerio';

const records = JSON.parse(await readFile('src/data/content.json', 'utf8'));
const site = JSON.parse(await readFile('src/data/site.json', 'utf8'));
const post = records.find(r => r.type === 'post');
const pkg = JSON.parse(await readFile('node_modules/astro/package.json', 'utf8'));
const bin = path.resolve('node_modules/astro', typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.astro);
const directory = 'reports/ads-verification';
await mkdir(directory, { recursive: true });
const cases = [
  { name: 'production', flag: 'true', branch: 'main', noindex: 'false', enabled: true },
  { name: 'disabled', flag: 'false', branch: 'main', noindex: 'false', enabled: false },
  { name: 'preview-branch', flag: 'true', branch: 'preview-check', noindex: 'false', enabled: false },
  { name: 'explicit-noindex', flag: 'true', branch: 'main', noindex: 'true', enabled: false },
];
const results = [], errors = [];
const browser = await chromium.launch({ headless: true });
try {
  for (const item of cases) {
    const output = path.resolve(directory, item.name);
    const built = spawnSync(process.execPath, [bin, 'build', '--outDir', output], {
      env: { ...process.env, PUBLIC_ENABLE_ADS: item.flag, SITE_NOINDEX: item.noindex, CF_PAGES_BRANCH: item.branch, PRODUCTION_BRANCH: 'main' },
      encoding: 'utf8', timeout: 120000,
    });
    await writeFile(path.join(directory, item.name + '.log'), built.stdout + built.stderr);
    assert.equal(built.status, 0, `${item.name} build failed`);
    // All original records are checked, including NBR and the contact page.
    for (const record of records) {
      const html = await readFile(path.join(output, decodeURIComponent(record.path), 'index.html'), 'utf8');
      const $ = load(html);
      assert.equal($('ins.adsbygoogle').length, item.enabled && record.type === 'post' ? 2 : 0, `${item.name} slots ${record.path}`);
      assert.equal($('.consent-panel,[data-consent]').length, 0, 'Uncertified local consent must not stand in for the Google CMP');
      $('ins.adsbygoogle').each((_, node) => {
        assert.equal($(node).attr('data-ad-client'), site.ads.publisher);
        assert.ok(Object.values(site.ads.slots).includes($(node).attr('data-ad-slot')));
      });
    }
    const hosts = item.enabled ? ['https://nicetrix.com', 'https://verification.nicetrix.pages.dev', 'http://127.0.0.1:4321'] : ['https://nicetrix.com'];
    for (const host of hosts) {
      const page = await browser.newPage();
      page.on('pageerror', error => errors.push(error.message));
      let loads = 0;
      await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin === host) {
          const file = path.resolve(output, '.' + decodeURIComponent(url.pathname), url.pathname.endsWith('/') ? 'index.html' : '');
          if (!file.startsWith(output + path.sep)) return route.abort();
          try { return await route.fulfill({ path: file }); } catch { return route.abort(); }
        }
        if (url.origin === 'https://pagead2.googlesyndication.com' && url.pathname === '/pagead/js/adsbygoogle.js') {
          loads++;
          assert.equal(url.searchParams.get('client'), site.ads.publisher);
          return route.fulfill({ contentType: 'application/javascript', body: 'window.__adQueueCount=0;window.adsbygoogle={push:()=>{window.__adQueueCount++}};' });
        }
        return route.abort();
      });
      for (const pathname of [post.path, '/', '/nbr-audit/', '/get-in-touch/']) {
        loads = 0;
        await page.goto(host + pathname, { waitUntil: 'networkidle' });
        const eligible = item.enabled && host === 'https://nicetrix.com' && pathname === post.path;
        assert.equal(loads, eligible ? 1 : 0, `${item.name} loader ${host}${pathname}`);
        assert.equal(await page.evaluate(() => window.__adQueueCount || 0), eligible ? 2 : 0, 'Only the original two article placements may be queued');
        assert.equal(await page.evaluate(() => localStorage.getItem('nicetrix-ad-consent')), null, 'No fabricated local TCF consent');
      }
      await page.close();
    }
    results.push({ name: item.name, status: 'PASS', originalRecords: records.length, adsEnabled: item.enabled, testedHosts: hosts });
    console.log(`${item.name}: PASS`);
  }
  assert.equal(errors.length, 0, 'Unexpected browser errors');
} finally {
  await browser.close();
  await writeFile(path.join(directory, 'results.json'), JSON.stringify({ status: results.length === cases.length && !errors.length ? 'PASS' : 'FAIL', cases: results, errors, liveAdRequests: 'NOT RUN; SDK mocked and all other third-party requests aborted', cmp: 'Existing published Google CMP verified in AdSense; no consent or serving guarantee is simulated by these tests' }, null, 2) + '\n');
}
