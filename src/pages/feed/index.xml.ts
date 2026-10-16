import { allPosts, site } from '../../lib/content';
const esc = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
export async function GET() {
  const posts = await allPosts();
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>NiceTrix</title><link>${site.url}/</link><description>NiceTrix articles</description><language>bn</language><atom:link href="${site.url}/feed/" rel="self" type="application/rss+xml"/>${posts.map(p => `<item><title>${esc(p.title)}</title><link>${esc(p.url)}</link><guid isPermaLink="true">${esc(p.url)}</guid><pubDate>${new Date(p.publishedGmt.replace(' ', 'T') + 'Z').toUTCString()}</pubDate><description>${esc(p.seo.description)}</description></item>`).join('')}</channel></rss>`, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } });
}
