import { chromium } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { serve } from './serve.mjs';

const records = JSON.parse(await readFile('src/data/content.json', 'utf8'));
const site = JSON.parse(await readFile('src/data/site.json', 'utf8'));
const media = JSON.parse(await readFile('src/data/media-manifest.json', 'utf8'));
const redirects = JSON.parse(await readFile('src/data/legacy-redirects.json', 'utf8'));
const generated = JSON.parse(await readFile('reports/build-verification.json', 'utf8')).indexing.pages;
const base = 'http://127.0.0.1:4322';
const failures = [], errors = [], shots = [], checks = [];
const check = (ok, label) => { checks.push({ label, status: ok ? 'PASS' : 'FAIL' }); if (!ok) failures.push(label); };
const server = await serve(4322);
const browser = await chromium.launch({ headless: true });
await mkdir('reports/browser', { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(12000);
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === base) await route.continue();
    else await route.fulfill({ status: 200, contentType: 'text/html', body: '' });
  });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  for (const route of generated) {
    const response = await page.request.get(base + route.path);
    check(response.status() === 200, 'Generated HTML URL HTTP 200: ' + route.path);
  }
  for (let start = 0; start < media.length; start += 30) {
    await Promise.all(media.slice(start, start + 30).map(async m => {
      const response = await page.request.head(base + m.path);
      check(response.status() === 200 && response.headers()['content-type'].startsWith('image/'), 'Media HTTP 200: ' + m.path);
    }));
  }
  for (const r of redirects) {
    const response = await page.request.get(base + r.from, { maxRedirects: 0 });
    check(response.status() === 301 && response.headers().location === r.to, 'Source old slug 301: ' + r.from);
  }
  check((await page.request.get(base + '/missing-nicetrix-test-page/')).status() === 404, 'Genuine unknown route HTTP 404');
  check((await page.request.get(base + '/feed/')).status() === 200, 'Original RSS endpoint');
  await page.goto(base + '/nbr-audit/');
  check(await page.locator('.service-notice').isVisible(), 'NBR explicitly reports unavailable original functionality');
  check(await page.locator('main input,main form').count() === 0, 'NBR has no simulated checker controls');
  check(await page.locator('meta[name=robots]').getAttribute('content') === 'noindex, follow', 'Unavailable NBR page is not indexed');
  const posts = records.filter(r => r.type === 'post');
  const representative = [...posts].sort((a, b) => b.originalHtml.length - a.originalHtml.length).slice(0, 5);
  for (const item of posts.filter(r => /<table|wp-block-embed__wrapper|<figcaption/.test(r.originalHtml))) {
    if (!representative.some(r => r.wpId === item.wpId)) representative.push(item);
    if (representative.length >= 10) break;
  }
  const paths = ['/', ...representative.map(r => r.path), ...site.categories.map(c => c.path), ...site.authors.map(a => a.path), '/tag/ai-tech/page/2/', '/latest/page/2/', ...records.filter(r => r.type === 'page' && r.path !== '/').map(r => r.path)];
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const pathname of paths) {
      const response = await page.goto(base + pathname, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      check(response.status() === 200, `${width}px route loaded ${pathname}`);
      const metrics = await page.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth, overflowing: [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > innerWidth + 1 && getComputedStyle(e).position !== 'fixed' && !e.closest('.wp-block-table,.table-scroll,.toc nav'); }).slice(0, 3).map(e => e.tagName + '.' + e.className) }));
      check(metrics.width <= metrics.viewport + 1, `${width}px no horizontal overflow ${pathname} ${JSON.stringify(metrics)}`);
      if (pathname === '/' || pathname === representative[0].path) {
        const name = pathname === '/' ? 'home' : 'article';
        const screenshot = `reports/browser/${name}-${width}.png`;
        if (pathname === '/') {
          // Trigger native lazy loading through actual scrolling before capture.
          const height = await page.evaluate(() => document.documentElement.scrollHeight);
          for (let y = 0; y < height; y += 800) { await page.evaluate(y => scrollTo(0, y), y); await page.waitForTimeout(70); }
          await page.evaluate(() => scrollTo(0, 0));
          await page.waitForLoadState('networkidle');
          check(await page.locator('img').evaluateAll(images => images.filter(image => image.getClientRects().length > 0).every(image => image.complete && image.naturalWidth > 0)), `${width}px all visible home images load after scrolling`);
        }
        await page.screenshot({ path: screenshot, fullPage: pathname === '/', animations: 'disabled' });
        if (pathname === '/') await page.screenshot({ path: `reports/browser/home-top-${width}.png`, animations: 'disabled' });
        shots.push(screenshot);
      }
    }
    console.log(`Responsive browser checks completed: ${width}px`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + '/');
  const menu = page.locator('.menu-toggle');
  check(await menu.isVisible(), 'Mobile menu button visible');
  await menu.click();
  check(await menu.getAttribute('aria-expanded') === 'true', 'Mobile menu opens');
  check(await page.locator('#site-navigation').isVisible(), 'Mobile navigation exposed');
  await page.keyboard.press('Escape');
  check(await menu.getAttribute('aria-expanded') === 'false', 'Escape closes mobile menu');
  await menu.click();
  await page.locator('#site-navigation').getByRole('link', { name: 'AI Tech', exact: true }).click();
  check(new URL(page.url()).pathname === '/ai-tech/', 'Mobile category navigation works');
  await page.goto(base + '/');
  await page.keyboard.press('Tab');
  check(await page.locator('.skip-link').evaluate(e => e === document.activeElement), 'Keyboard skip link is first focus target');
  console.log('Mobile navigation and keyboard checks completed');
  await page.goto(base + '/search/');
  const input = page.locator('.pagefind-ui__search-input');
  await input.waitFor();
  await page.locator('.search-chip[data-query="ChatGPT"]').click();
  await page.locator('.pagefind-ui__result-link[href="/a-z-guide-to-use-chatgpt-5/"]').first().waitFor({ timeout: 15000 });
  check(new URL(page.url()).searchParams.get('q') === 'ChatGPT', 'Actual search suggestion chip updates results and URL');
  for (const [query, expected] of [['আয়ারল্যান্ড', '/apply-for-ireland-work-permit-in-just-7-simple-steps/'], ['ChatGPT', '/a-z-guide-to-use-chatgpt-5/']]) {
    await input.fill(query);
    await page.locator(`.pagefind-ui__result-link[href="${expected}"]`).first().waitFor({ timeout: 15000 });
    check(true, 'Real Pagefind result: ' + query);
    console.log('Pagefind result verified: ' + query);
  }
  // Avoid a real indexed prefix ("nicetrix"); Pagefind may match word prefixes.
  await input.fill('qzxvkjmwbpytfghru');
  await page.locator('.pagefind-ui__message').filter({ hasText: 'কোনো লেখা পাওয়া যায়নি' }).waitFor({ timeout: 15000 });
  check((await page.locator('.pagefind-ui__result').count()) === 0, 'Search has truthful empty state');
  await input.fill('আয়ারল্যান্ড');
  const result = page.locator('.pagefind-ui__result-link[href="/apply-for-ireland-work-permit-in-just-7-simple-steps/"]').first();
  await result.waitFor(); await result.click();
  check(new URL(page.url()).pathname === '/apply-for-ireland-work-permit-in-just-7-simple-steps/', 'Search result opens original article URL');
  const canonical = await page.locator('link[rel=canonical]').getAttribute('href');
  check(new URL(await page.getByRole('link', { name: 'Share on Facebook' }).getAttribute('href')).searchParams.get('u') === canonical, 'Facebook share contains original canonical URL');
  check(new URL(await page.getByRole('link', { name: 'Share on WhatsApp' }).getAttribute('href')).searchParams.get('text').includes(canonical), 'WhatsApp share contains original canonical URL');
  const tocLink = page.locator('.toc a').first();
  const target = await tocLink.getAttribute('href');
  await tocLink.click();
  check(decodeURIComponent(new URL(page.url()).hash) === target, 'Table of contents navigates to actual heading');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.locator('.copy-link').click();
  await page.getByRole('status').filter({ hasText: 'Link copied' }).waitFor();
  check((await page.evaluate(() => navigator.clipboard.readText())).startsWith('https://nicetrix.com/'), 'Copy share uses original canonical production URL');
  await page.goto(base + '/?s=ChatGPT');
  await page.waitForURL('**/search/?q=ChatGPT');
  check(true, 'Original WordPress ?s= search bookmark');
  await page.locator('.pagefind-ui__search-input').waitFor();
  await page.locator('.pagefind-ui__result').first().waitFor({ timeout: 15000 });
  await page.screenshot({ path: 'reports/browser/search-390.png', fullPage: true });
  shots.push('reports/browser/search-390.png');
  check(errors.length === 0, 'No browser console/page errors');
} catch (error) { failures.push(error.stack || String(error)); }
finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  const report = { status: failures.length ? 'FAIL' : 'PASS', engine: 'Playwright Chromium', widths: [360, 390, 768, 1024, 1440], checks: checks.length, failedChecks: failures, consoleErrors: errors, screenshots: shots, results: checks, thirdPartyEmbedsAndAds: 'NOT RUN — external requests stubbed; no ads requested or clicked', cloudflareHostedSmoke: 'NOT RUN — no deployment or DNS change' };
  await writeFile('reports/browser-verification.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ...report, results: undefined }, null, 2));
  if (failures.length) process.exitCode = 1;
}
