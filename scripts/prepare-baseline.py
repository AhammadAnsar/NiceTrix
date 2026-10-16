"""One-time public metadata projection from the existing read-only crawl.

This public-only supplement is tracked so the importer is reproducible from a
clean checkout plus the two separately supplied private original backups.
"""
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
read = lambda name: json.loads((root / 'reports/evidence' / name).read_text(encoding='utf-8-sig'))
pick = lambda obj, keys: {key: obj[key] for key in keys if key in obj}
files = {}
for name in ['categories-public.json', 'tags-public.json']:
    files[name] = {'items': [pick(x, ['id', 'slug', 'name', 'link', 'description']) for x in read(name)['items']]}
files['users-public.json'] = {'items': [pick(x, ['id', 'name', 'slug', 'link', 'description', 'avatar_urls']) for x in read('users-public.json')['items']]}
files['media-public.json'] = {'items': []}
for x in read('media-public.json')['items']:
    if x['media_type'] != 'image': continue
    m = pick(x, ['id', 'media_type', 'source_url', 'alt_text', 'caption', 'link'])
    d = x['media_details']
    m['media_details'] = {**pick(d, ['width', 'height', 'file']), 'sizes': {key: pick(value, ['file', 'width', 'height', 'mime_type', 'source_url']) for key, value in d.get('sizes', {}).items()}}
    files['media-public.json']['items'].append(m)
files['seo-baseline.json'] = {'items': []}
for x in read('seo-baseline.json')['items']:
    s = pick(x, ['id', 'url', 'title', 'canonical', 'description', 'robots'])
    s['metadata'] = [pick(m, ['tag', 'name', 'property', 'content']) for m in x.get('metadata', []) if m.get('tag') == 'meta' and (m.get('name') or m.get('property'))]
    files['seo-baseline.json']['items'].append(s)
target = root / 'src/data/source-baseline.json'
target.write_text(json.dumps({'provenance': 'Public nicetrix.com REST and HTML read-only baseline, 2026-10-16. Original WXR content remains authoritative.', 'files': files}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('Saved public-only metadata supplement; no SQL, account records, CSV rows or private drafts.')
