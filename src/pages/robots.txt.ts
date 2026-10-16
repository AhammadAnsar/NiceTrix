export function GET() {
  const noindex = import.meta.env.SITE_NOINDEX === 'true' || import.meta.env.CF_PAGES_BRANCH && import.meta.env.CF_PAGES_BRANCH !== (import.meta.env.PRODUCTION_BRANCH || 'main');
  return new Response(noindex ? 'User-agent: *\nDisallow: /\n' : 'User-agent: *\nAllow: /\nDisallow: /search/\nSitemap: https://nicetrix.com/sitemap.xml\n', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
