import { getCollection, type CollectionEntry } from 'astro:content';
import site from '../data/site.json';
import sanitizeHtml from 'sanitize-html';

export { site };
export type RecordData = CollectionEntry<'content'>['data'];
export type ImageData = NonNullable<RecordData['image']>;
export const isoDate = (value: string) => value.replace(' ', 'T') + '+00:00';
export const formatDate = (value: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(isoDate(value)));
export const absolute = (path: string) => new URL(path, site.url).href;
export const plainText = (html: string) => sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} });
export const descriptionHtml = (html: string) => sanitizeHtml(html.replaceAll('\\r\\n', '\n'), { allowedTags: ['p', 'br', 'strong', 'em', 'a'], allowedAttributes: { a: ['href'] } });
export const authorOf = (record: RecordData) => site.authors.find(a => a.id === record.authorId)!;
export const categoriesOf = (record: RecordData) => site.categories.filter(c => record.categoryIds.includes(c.id));
export async function allContent() {
  return (await getCollection('content')).map(entry => entry.data).sort((a, b) => b.publishedGmt.localeCompare(a.publishedGmt) || b.wpId - a.wpId);
}
export async function allPosts() { return (await allContent()).filter(x => x.type === 'post'); }
export type Archive = { path: string; title: string; kind: 'category' | 'tag' | 'author' | 'latest'; id: number; description: string; page: number; pages: number; posts: RecordData[]; total: number; base: string };
export function archives(posts: RecordData[]): Archive[] {
  const result: Archive[] = [];
  const groups = [
    ...site.categories.map(c => ({ ...c, kind: 'category' as const })),
    ...site.tags.map(t => ({ ...t, kind: 'tag' as const })),
    ...site.authors.map(a => ({ ...a, kind: 'author' as const })),
    { id: 0, name: 'Latest stories', path: '/latest/', description: '', kind: 'latest' as const },
  ];
  for (const group of groups) {
    const selected = posts.filter(p => group.kind === 'latest' || (group.kind === 'category' ? p.categoryIds.includes(group.id) : group.kind === 'tag' ? p.tagIds.includes(group.id) : p.authorId === group.id));
    const pages = Math.max(1, Math.ceil(selected.length / 10));
    for (let page = 1; page <= pages; page++) result.push({ path: page === 1 ? group.path : `${group.path}page/${page}/`, title: group.name, kind: group.kind, id: group.id, description: group.description, page, pages, posts: selected.slice((page - 1) * 10, page * 10), total: selected.length, base: group.path });
  }
  // Preserve observed WordPress home pagination without competing with the root.
  for (let page = 2; page <= Math.ceil(posts.length / 10); page++) result.push({ path: `/page/${page}/`, title: 'Latest stories', kind: 'latest', id: 0, description: '', page, pages: Math.ceil(posts.length / 10), posts: posts.slice((page - 1) * 10, page * 10), total: posts.length, base: '/' });
  return result;
}
