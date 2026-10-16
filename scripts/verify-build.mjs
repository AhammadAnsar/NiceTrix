import { readFile, readdir, stat, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { load } from 'cheerio';

const root = process.cwd();
const dist = path.join(root, 'dist');
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
const records = await readJson('src/data/content.json');
const site = await readJson('src/data/site.json');
const media = await readJson('src/data/media-manifest.json');
const noindexBuild = process.env.SITE_NOINDEX === 'true' || Boolean(process.env.CF_PAGES_BRANCH && process.env.CF_PAGES_BRANCH !== (process.env.PRODUCTION_BRANCH || 'main'));
const sha = s => createHash('sha256').update(s).digest('hex');
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
const normalize = value => value.replace(/\s+/gu, ' ').trim();
function textNodes(node) {
  if (node.type === 'text') return [node.data];
  if (['script', 'style'].includes(node.name)) return [];
  return (node.children || []).flatMap(textNodes);
}
const visible = html => normalize(textNodes(load(html, { xml: { xmlMode: false, decodeEntities: true } }).root()[0]).join(' '));
const outputPath = url => {
  const pathname = decodeURIComponent(new URL(url, site.url).pathname);
  return path.join(dist, pathname, pathname.endsWith('/') ? 'index.html' : '');
};
async function filesIn(folder) {
  const list = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) list.push(...await filesIn(file)); else list.push(file);
  }
  return list;
}
check(records.filter(r => r.type === 'post').length === 51, 'Published posts != 51');
check(records.filter(r => r.type === 'page').length === 9, 'Published pages != 9');
check(site.categories.length === 6 && site.tags.length === 42 && site.authors.length === 3, 'Taxonomy/author counts mismatch');
check(new Set(records.map(r => decodeURIComponent(r.path))).size === records.length, 'Original route collision');
const contentResults = [];
for (const record of records) {
  const file = outputPath(record.url);
  check(existsSync(file), `Missing original route: ${record.path}`);
  if (!existsSync(file)) continue;
  const $ = load(await readFile(file, 'utf8'));
  check($('title').text() === record.seo.title, `SEO title mismatch ${record.wpId}`);
  check($('link[rel=canonical]').attr('href') === record.seo.canonical, `Canonical mismatch ${record.wpId}`);
  if (record.seo.description) check($('meta[name=description]').attr('content') === record.seo.description, `Description mismatch ${record.wpId}`);
  check($('meta[name=robots]').attr('content') === (noindexBuild ? 'noindex, nofollow' : record.wpId === 8581 ? 'noindex, follow' : record.seo.robots), `Robots mismatch ${record.wpId}`);
  for (const [name, value] of Object.entries(record.seo.social)) {
    if (name.startsWith('og:') || name.startsWith('article:') || name.startsWith('twitter:')) {
      const actual = $('meta').toArray().find(n => $(n).attr(name.startsWith('twitter:') ? 'name' : 'property') === name);
      check(actual && $(actual).attr('content') === value, `Social metadata ${name} mismatch ${record.wpId}`);
    }
  }
  if (record.path !== '/') {
    check($('h1').first().text() === record.title, `Original title mismatch ${record.wpId}`);
    check($('article[data-wp-id]').attr('data-wp-id') === String(record.wpId), `Original WP ID missing ${record.wpId}`);
    check($('#article-body').attr('data-source-sha256') === sha(record.originalHtml), `Original body fingerprint mismatch ${record.wpId}`);
    check(visible($('#article-body').html() || '') === visible(record.html), `Rendered body changed ${record.wpId}`);
    check($('.author-line a').first().attr('href') === site.authors.find(a => a.id === record.authorId)?.path, `Author URL mismatch ${record.wpId}`);
    check($('.author-line time').attr('datetime') === record.publishedGmt.replace(' ', 'T') + '+00:00', `Visible publication date mismatch ${record.wpId}`);
    if (record.type === 'post') {
      check(visible(record.originalHtml) === visible(record.html), `Original article text changed ${record.wpId}`);
      const schema = $('script[type="application/ld+json"]').map((_, n) => JSON.parse($(n).html())).get();
      const article = schema.find(s => s['@type'] === 'Article');
      check(article?.datePublished === record.publishedGmt.replace(' ', 'T') + '+00:00', `Publish date mismatch ${record.wpId}`);
      check(article?.dateModified === record.modifiedGmt.replace(' ', 'T') + '+00:00', `Modified date mismatch ${record.wpId}`);
      check(article?.author.name === site.authors.find(a => a.id === record.authorId)?.name, `Author mismatch ${record.wpId}`);
      check(schema.some(s => s['@type'] === 'BreadcrumbList'), `Breadcrumb schema missing ${record.wpId}`);
      check($('#article-body img').length === load(record.originalHtml)('img').length, `Article image count mismatch ${record.wpId}`);
      for (const tag of ['h2', 'h3', 'li', 'table', 'figcaption']) check($('#article-body ' + tag).length === load(record.originalHtml)(tag).length, `Structure ${tag} mismatch ${record.wpId}`);
    }
  }
  contentResults.push({ id: record.wpId, path: record.path, type: record.type, sourceSHA256: sha(record.originalHtml), status: failures.some(f => f.includes(String(record.wpId))) ? 'FAIL' : 'PASS' });
}
for (const asset of media) {
  const file = outputPath(asset.path);
  check(existsSync(file), 'Missing archived media: ' + asset.path);
  if (existsSync(file)) check(sha(await readFile(file)) === asset.sha256, 'Media bytes changed: ' + asset.path);
}
const allFiles = await filesIn(dist);
const htmlFiles = allFiles.filter(f => f.endsWith('.html'));
// Windows existsSync is case-insensitive. Pages builds/serves on Linux, so
// validate references against exact enumerated filenames as well.
const exactFiles = new Set(allFiles.map(file => path.relative(dist, file).replaceAll('\\', '/')));
const exactFileExists = file => exactFiles.has(path.relative(dist, file).replaceAll('\\', '/'));
// Independent route inventory from the published source relations, including
// every archive page and original media page. Unknown generated routes fail.
const normalizeRoute = value => decodeURIComponent(new URL(value, site.url).pathname).normalize('NFC');
const expectedRoutes = new Map();
const register = (url, indexable, kind, canonical = url) => {
  const route = normalizeRoute(url);
  check(!expectedRoutes.has(route), 'Duplicate declared route: ' + route);
  expectedRoutes.set(route, { indexable, kind, canonical: new URL(canonical, site.url).href });
};
for (const record of records) register(record.url, record.wpId !== 8581 && !/noindex/i.test(record.seo.robots), record.type, record.seo.canonical);
for (const [kind, groups] of [['category', site.categories], ['tag', site.tags], ['author', site.authors]]) {
  for (const group of groups) {
    const count = records.filter(r => r.type === 'post' && (kind === 'author' ? r.authorId === group.id : (kind === 'category' ? r.categoryIds : r.tagIds).includes(group.id))).length;
    for (let page = 1; page <= Math.max(1, Math.ceil(count / 10)); page++) register(page === 1 ? group.path : `${group.path}page/${page}/`, true, kind);
  }
}
const totalPages = Math.ceil(records.filter(r => r.type === 'post').length / 10);
for (let page = 1; page <= totalPages; page++) {
  register(page === 1 ? '/latest/' : `/latest/page/${page}/`, true, 'latest');
  if (page > 1) register(`/page/${page}/`, false, 'legacy-pagination-alias', `/latest/page/${page}/`);
}
for (const image of site.media) register(image.url, false, 'attachment');
register('/search/', false, 'search');
register('/404.html', false, '404', '/404/');
check(htmlFiles.length === 280 && expectedRoutes.size === 280, 'Expected 280 unique generated HTML routes');
const indexing = [], generatedRoutes = new Set();
const brokenLinks = [], brokenImages = [], brokenAnchors = [], externalLinks = new Set();
const idsByFile = new Map(await Promise.all(htmlFiles.map(async file => {
  const $ = load(await readFile(file, 'utf8'));
  return [file, new Set($('[id]').toArray().map(n => $(n).attr('id')))];
})));
const redirects = new Map((await readFile('public/_redirects', 'utf8')).split('\n').filter(l => l && !l.startsWith('#')).map(l => { const [from, to] = l.trim().split(/\s+/); return [from, to]; }));
const hasTarget = url => {
  const candidate = outputPath(url);
  if (exactFileExists(candidate)) return true;
  const u = new URL(url, site.url);
  if (redirects.has(u.pathname)) return exactFileExists(outputPath(redirects.get(u.pathname)));
  return !path.extname(candidate) && exactFileExists(path.join(candidate, 'index.html'));
};
for (const file of htmlFiles) {
  const rel = path.relative(dist, file).replaceAll('\\', '/');
  const currentUrl = site.url + '/' + rel.replace(/index\.html$/, '');
  const $ = load(await readFile(file, 'utf8'));
  const route = normalizeRoute(currentUrl);
  check(!generatedRoutes.has(route), 'Duplicate generated route: ' + route);
  generatedRoutes.add(route);
  const policy = expectedRoutes.get(route);
  check(Boolean(policy), 'Unexpected generated HTML route: ' + route);
  const robots = $('meta[name=robots]').attr('content') || '';
  const indexable = !/noindex/i.test(robots);
  if (policy) {
    check(indexable === (policy.indexable && !noindexBuild), 'Unintended indexing policy: ' + route);
    check($('link[rel=canonical]').length === 1 && $('link[rel=canonical]').attr('href') === policy.canonical, 'Invalid canonical on ' + route);
  }
  for (const script of $('script[type="application/ld+json"]').toArray()) {
    try { const data = JSON.parse($(script).html()); check(data['@context'] === 'https://schema.org', 'Invalid schema context on ' + route); }
    catch { check(false, 'Invalid JSON-LD on ' + route); }
  }
  check($('.live-dot,[data-live]').length === 0, 'Misleading live indicator on ' + route);
  indexing.push({ path: route, kind: policy?.kind, indexable, canonical: $('link[rel=canonical]').attr('href') });
  for (const img of $('img').toArray()) {
    const sources = [$(img).attr('src'), ...($(img).attr('srcset') || '').split(',').map(s => s.trim().split(/\s+/)[0])].filter(Boolean);
    for (const source of sources) {
      const url = new URL(source, currentUrl);
      if (url.origin === site.url) { if (!hasTarget(url.href)) brokenImages.push({ page: '/' + rel, src: source }); }
      else if (/wp\.com|nicetrix\.com/.test(url.host)) brokenImages.push({ page: '/' + rel, src: source, reason: 'WordPress runtime image dependency' });
    }
    check($(img).attr('width') && $(img).attr('height'), 'Image dimensions missing on ' + rel);
  }
  for (const a of $('a[href]').toArray()) {
    const href = $(a).attr('href');
    if (!href || /^(mailto:|tel:|javascript:)/.test(href)) continue;
    const url = new URL(href, currentUrl);
    if (url.origin !== site.url) { if (/^https?:/.test(url.protocol)) externalLinks.add(url.href); continue; }
    if (!hasTarget(url.href)) brokenLinks.push({ page: '/' + rel, href });
    else if (url.hash && url.hash !== '#') {
      let destination = outputPath(url.href);
      if (!idsByFile.has(destination) && redirects.has(url.pathname)) destination = outputPath(redirects.get(url.pathname));
      if (!idsByFile.has(destination)) destination = path.join(destination, 'index.html');
      if (idsByFile.has(destination) && !idsByFile.get(destination).has(decodeURIComponent(url.hash.slice(1)))) brokenAnchors.push({ page: '/' + rel, href });
    }
  }
  check($('script[src*="wp-content"]').length === 0, 'WordPress runtime script on ' + rel);
  check($('input[type="password"]').length === 0, 'Unexpected account UI on ' + rel);
}
check(brokenImages.length === 0, 'Broken first-party images: ' + brokenImages.length);
check(brokenLinks.length === 0, 'Broken internal links: ' + brokenLinks.length);
check(brokenAnchors.length === 0, 'Broken same-page anchors: ' + brokenAnchors.length);
for (const route of expectedRoutes.keys()) check(generatedRoutes.has(route), 'Declared route not generated: ' + route);
const sizes = await Promise.all(allFiles.map(async file => ({ file: path.relative(dist, file).replaceAll('\\', '/'), bytes: (await stat(file)).size })));
check(sizes.length <= 20000, 'Cloudflare Free 20,000 file budget exceeded');
check(sizes.every(f => f.bytes <= 25 * 1024 * 1024), 'Cloudflare 25 MiB asset budget exceeded');
check(!sizes.some(f => /\.(wpress|sql|csv|php)$/i.test(f.file) || /(^|\/)(private-backups|reports|\.env|node_modules)(\/|$)/.test(f.file)), 'Private or executable source file in public build');
check(existsSync(path.join(dist, '404.html')), 'Genuine static 404.html missing');
check(existsSync(path.join(dist, 'pagefind/pagefind.js')), 'Pagefind production index missing');
check((await readFile(path.join(dist, 'ads.txt'), 'utf8')).trim() === 'google.com, pub-6673594317291335, DIRECT, f08c47fec0942fa0', 'Verified ads.txt mismatch');
const sitemap = await readFile(path.join(dist, 'sitemap.xml'), 'utf8');
const sitemapUrls = load(sitemap, { xml: true })('loc').toArray().map(n => load(sitemap, { xml: true })(n).text());
const sitemapRoutes = sitemapUrls.map(normalizeRoute);
check(new Set(sitemapRoutes).size === sitemapRoutes.length, 'Duplicate sitemap route');
for (const entry of indexing) check(sitemapRoutes.includes(entry.path) === Boolean(expectedRoutes.get(entry.path)?.indexable), 'Sitemap indexing policy mismatch: ' + entry.path);
for (const route of sitemapRoutes) check(expectedRoutes.get(route)?.indexable, 'Unintended sitemap entry: ' + route);
check(!/Disallow: \/\s*$/.test(await readFile(path.join(dist, 'robots.txt'), 'utf8')) || noindexBuild, 'Production robots blocks entire site');
const duplicateIndexableCanonicals = indexing.filter(e => e.indexable).filter((e, i, all) => all.findIndex(x => x.canonical === e.canonical) !== i);
check(duplicateIndexableCanonicals.length === 0, 'Duplicate indexed canonical URLs');
const report = { status: failures.length ? 'FAIL' : 'PASS', posts: 51, pages: 9, categories: 6, tags: 42, authors: 3, mediaFiles: media.length, htmlPages: htmlFiles.length, files: sizes.length, largestAssetBytes: Math.max(...sizes.map(f => f.bytes)), totalBytes: sizes.reduce((a, f) => a + f.bytes, 0), content: contentResults, indexing: { noindexBuild, indexablePages: indexing.filter(e => e.indexable).length, noindexPages: indexing.filter(e => !e.indexable).length, sitemapUrls: sitemapUrls.length, duplicateIndexableCanonicals, pages: indexing }, brokenImages, brokenLinks, brokenAnchors, externalLinksInventory: [...externalLinks].sort(), externalReachability: 'NOT RUN — original links retained; no external forms submitted', exceptions: site.exceptions, failures };
await mkdir('reports', { recursive: true });
await writeFile('reports/build-verification.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, content: undefined, indexing: { ...report.indexing, pages: undefined }, externalLinksInventory: undefined, brokenImages: brokenImages.slice(0, 8), brokenLinks: brokenLinks.slice(0, 8), brokenAnchors: brokenAnchors.slice(0, 8) }, null, 2));
if (failures.length) process.exitCode = 1;
