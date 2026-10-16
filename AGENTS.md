# AGENTS.md — NiceTrix Migration Constitution

## Mission
Rebuild https://nicetrix.com/ as a production Astro/TypeScript static site, with exact preservation of verified original WordPress content and URLs, safe AdSense continuity, and deploy to GitHub -> Cloudflare Pages Free. Codex owns data migration/architecture/testing; Antigravity owns visual refinements/browser UX QA. Same repository, separate branches and mutually exclusive file ownership during a task.

## Non-negotiable constraints
1. **Preserve first.** Do not alter, rewrite, summarize, translate, regenerate, delete, or fabricate existing published article content. Preserve headings, paragraphs, formatting meaning, links, image positions, captions, alt text, embeds, and tables wherever safely supported.
2. **Source of truth.** The owner's complete WordPress database/export and `wp-content/uploads` backup outrank public crawls. Use the live site for supplementary verification. Do not claim a complete migration from a homepage crawl. Keep raw-source records in a private, non-deployed archive.
3. **URLs.** Preserve every verified public permalink including path, case, trailing slash, category/author paths, pagination and important attachment URLs. Implement documented redirects ONLY if exact preservation is impossible. Canonical and sitemap must use production URLs; drafts must never be public.
4. **Metadata.** Preserve real WP IDs, slugs, timestamps/timezones, authors, category/tag relations, original SEO title/description, robots/canonical, social metadata, and available original view-count/comment data. Never fabricate missing records.
5. **Static architecture.** Astro static output + TypeScript + typed Content Collections, local/build-time content, Pagefind generated AFTER the Astro build, minimal client-side JS. Do not introduce Firebase, a mandatory API, database, persistent Node server, paid hosted CMS, or server-side page render unless a documented and approved feature actually requires one. Static Astro Pages build does not need the Cloudflare server adapter.
6. **No mock production.** No Lorem Ipsum, placeholder articles, fake subscribers, fake metrics, inactive clickable UI, fake success notifications, or copied invented content.
7. **Safe WordPress source.** The live WordPress site is READ-ONLY for agents. No plugin updates, theme changes, database writes, production DNS changes, cache clears or public posts without explicit approval.
8. **No secrets or private exports committed.** `private-backups/`, database SQL, WXR containing private/draft data, `.env*`, auth/session files, API credentials and other confidential material must be excluded from Git and Cloudflare assets. Use an ignored local directory or external secure storage. Preview `noindex` is not authentication.
9. **Migration QA.** Compare every source-published post against a generated destination record: 100% accounting, no unexplained title/body text changes, correct metadata, correct URL/status and all original assets mapped or explicitly blocked. Keep normalization conservative: formatting can change but actual content cannot. Preserve a content fingerprint and actionable diff report.
10. **AdSense and SEO.** Preserve the actual existing publisher ID, ads.txt, real ad slot rules and verification only from authorized sources. Do not insert invented IDs, mimic ads, generate clicks or promise uninterrupted revenue. Avoid accidental production noindex, duplicates, redirect chains, privacy/consent regressions.
11. **Testing.** Run executable tests. Report exactly PASS, FAIL, BLOCKED or NOT RUN. Do not claim tests passed when not executed. Gates must block promotion where critical issues remain.
12. **Scope.** Perform only the requested phase. Inspect existing code before editing; avoid unrelated refactors. Never change article files while doing visual-only work. Leave a phase report with changed files, tested commands/results, remaining risks, and recommendation.

## Required deliverables
`docs/architecture.md`, `docs/source-audit.md`, `docs/feature-parity.md`, `docs/migration-runbook.md`, `docs/cutover-runbook.md`, `docs/rollback.md`; source and route/media inventories, source-vs-destination integrity reports, SEO/ad baseline reports, executable migration tools, CI checks, UI browser QA artifacts, deploy/build acceptance reports.

## Release gates
- G0: Verified backup, original public site baseline, sources and permissions known.
- G1: All source content and routes inventoried (unknowns explicitly reported).
- G2: Working, tested Astro static foundation.
- G3: Every verified source published post/page accounted for; zero unexplained text/data loss, links and media audited.
- G4: UI preserves complete content and functional navigation on mobile/desktop.
- G5: SEO, ads.txt/AdSense integration, performance, security, automated QA pass or owner approves documented non-critical exceptions.
- G6: Staging and rollback tested, final delta export completed, production DNS cutover explicitly approved.

## Repository and branch discipline
- Use `main` only for tested merges, not agent experiments.
- Recommended branches: `audit/source-baseline`, `feat/astro-core`, `feat/content-migration`, `design/antigravity-ui`, `feat/search-seo-ads`, `release/cloudflare`.
- Codex should not edit `design/antigravity-ui` while Antigravity is editing; Antigravity should not change migration scripts/content records unless Codex explicitly reviews the diff.
- Work must be reproducible from a clean clone plus separately supplied authorized private inputs.

## Current owner authorization
The owner's 16 October 2026 direct-development request supersedes intermediate audit-only and per-phase stop requirements for LOCAL implementation. Complete and test the Astro migration and new editorial design locally. Do not publish a repository, deploy, change DNS or modify the existing WordPress site without a separate applicable owner instruction. Read README.md for current commands and documented source exceptions.
