"""Verify the precise upload difference and public advertising provenance.
Read original archive bytes only; never execute its SQL/PHP or parse CSV rows.
"""
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

sys.stdout.reconfigure(encoding='utf-8')
root = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('migration', root / 'scripts/migrate.py')
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)
backup = Path(r'F:\Vibe Developments\NiceTrix Backup')
archive = backup / 'nicetrix-com.wpress'
index = migration.index_archive(archive)
uploads = {p: v for p, v in index.items() if p.startswith('uploads/')}
manifest = json.loads((root / 'src/data/media-manifest.json').read_text(encoding='utf-8'))
migrated = {x['path'].removeprefix('/wp-content/'): x for x in manifest}
excluded = {
    'uploads/wpcode/cache/library/snippets.json': 'WPCode library cache; not a content image',
    'uploads/wpcode/cache/library/index.html': 'Empty WPCode directory index',
    'uploads/wpcode/cache/index.html': 'Empty WPCode directory index',
    'uploads/wpcode/cache/docs.json': 'WPCode documentation cache; not a content image',
    'uploads/wpcode/index.html': 'Empty WPCode directory index',
    'uploads/wpcf7_uploads/.htaccess': 'Apache/Contact Form 7 access rule; no Apache/WordPress runtime on Pages',
    'uploads/elementor/css/post-8.css': 'Original Elementor generated theme/template stylesheet; replaced by existing Astro UI CSS',
    'uploads/elementor/css/post-7460.css': 'Original Elementor generated homepage stylesheet; replaced by existing Astro UI CSS',
    'uploads/2026/04/tin_list.csv': 'Separate dated TIN dataset, not an image; kept private, not substituted for missing NBR root datasets',
}
failures = []
def check(condition, message):
    if not condition: failures.append(message)
check(len(uploads) == 1055, 'Archive upload count differs from 1055')
check(len(manifest) == len(migrated) == 1046, 'Migrated media count/uniqueness differs from 1046')
check(set(uploads) - set(migrated) == set(excluded), 'Unexpected upload exclusion')
check(not set(migrated) - set(uploads), 'Migrated file without original archived source')
excluded_evidence = []
with archive.open('rb') as source:
    for name, asset in migrated.items():
        original = migration.get_member(source, uploads[name])
        digest = hashlib.sha256(original).hexdigest()
        destination = root / 'public' / asset['path'].lstrip('/')
        check(digest == asset['sha256'] == hashlib.sha256(destination.read_bytes()).hexdigest(), 'Image bytes differ: ' + name)
    for name, reason in excluded.items():
        data = migration.get_member(source, uploads[name])
        excluded_evidence.append({'path': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(), 'reason': reason, 'originalRetained': True})
    database = migration.get_member(source, index['database.sql'])
    site = json.loads((root / 'src/data/site.json').read_text(encoding='utf-8'))
    ads = {'publisher': site['ads']['publisher'], 'slots': site['ads']['slots']}
    provenance = {v: v.encode() in database for v in [ads['publisher'], *ads['slots'].values()]}
    check(all(provenance.values()), 'AdSense public IDs not all found in original database bytes')
    check(ads['publisher'] == 'ca-pub-6673594317291335', 'Unexpected AdSense publisher')
    del database
hashes = {}
expected = {'nicetrix-com.wpress': '9639a675c3b7d053f1cc4750045661840317fe76ca8d02b95209503fd89a7002', 'nicetrix.WordPress.2026-10-16.xml': 'ff3d5610ce3b56ca42885b7cee51974e3ac7705a2dfd132f24f31136c72567e3'}
for name, digest in expected.items():
    with (backup / name).open('rb') as source:
        hashes[name] = hashlib.file_digest(source, 'sha256').hexdigest()
    check(hashes[name] == digest, 'Original backup changed: ' + name)
report = {'status': 'FAIL' if failures else 'PASS', 'archiveUploads': len(uploads), 'migratedImageFiles': len(migrated), 'excludedNonImages': excluded_evidence, 'unexplainedDifference': sorted((set(uploads) - set(migrated)) - set(excluded)), 'imageBinaryHashComparisons': len(migrated), 'adsense': {**ads, 'idsFoundInOriginalSql': provenance, 'liveServing': 'NOT RUN; disabled by default, account/CMP confirmation required'}, 'nbrAudit': {'originalFunctionalityAvailable': False, 'missingRootDatasets': ['/wp-content/uploads/tin_list.csv', '/wp-content/uploads/bin_list.csv'], 'datedTinRetainedPrivately': True}, 'originalBackupHashes': hashes, 'failures': failures}
(root / 'reports/final-source-verification.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps(report, ensure_ascii=False, indent=2))
if failures: sys.exit(1)
