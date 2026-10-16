import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { file } from 'astro/loaders';

const image = z.object({
  id: z.number(), src: z.string(), width: z.number(), height: z.number(),
  alt: z.string(), caption: z.string(), srcset: z.string(), url: z.string(),
});
const content = defineCollection({
  loader: file('src/data/content.json'),
  schema: z.object({
    wpId: z.number(), type: z.enum(['post', 'page']), status: z.literal('publish'),
    title: z.string(), slug: z.string(), url: z.url(), path: z.string(),
    authorId: z.number(), categoryIds: z.array(z.number()), tagIds: z.array(z.number()),
    published: z.string(), publishedGmt: z.string(), modified: z.string(), modifiedGmt: z.string(),
    excerptOriginal: z.string(), originalHtml: z.string(), sourceSHA256: z.string(),
    visibleTextSHA256: z.string(), html: z.string(), readingMinutes: z.number(),
    toc: z.array(z.object({ id: z.string(), level: z.number(), title: z.string() })),
    image: image.nullable(),
    seo: z.object({
      title: z.string(), description: z.string(), canonical: z.string(), robots: z.string(),
      social: z.record(z.string(), z.string()), sourceFields: z.record(z.string(), z.string()),
    }),
    approvedComments: z.array(z.object({ id: z.number(), name: z.string(), date: z.string(), html: z.string() })),
  }),
});
export const collections = { content };
