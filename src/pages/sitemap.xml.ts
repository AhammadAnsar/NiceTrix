import { allContent, allPosts, archives, absolute } from '../lib/content';
const escapeXml = (value: string) => value.replace(/[<>&'\"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]!));
export async function GET() {
  const records = await allContent();
  const archive = archives(await allPosts()).filter(a => !(a.kind === 'latest' && a.base === '/'));
  const urls = [...records.filter(r => r.wpId !== 8581).map(r => ({ url: r.url, modified: r.modifiedGmt.replace(' ', 'T') + 'Z' })), ...archive.map(a => ({ url: absolute(a.path), modified: '' }))];
  return new Response('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + urls.map(r => `<url><loc>${escapeXml(r.url)}</loc>${r.modified ? '<lastmod>' + r.modified + '</lastmod>' : ''}</url>`).join('') + '</urlset>', { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}
