"""Read-only WordPress importer. Never executes SQL, PHP, scripts or archive code.

Original backups stay outside the repository. Only published, public fields and
allowlisted image binaries are written. Run again with --verify-only to compare
the generated records against the original WXR and media against the archive.
"""
from __future__ import annotations
import argparse
import hashlib
import html
from html.parser import HTMLParser
import json
from pathlib import Path, PurePosixPath
import re
import sys
import urllib.parse as U
import xml.etree.ElementTree as E
import zlib

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parents[1]
NS = {"wp": "http://wordpress.org/export/1.2/", "content": "http://purl.org/rss/1.0/modules/content/", "excerpt": "http://wordpress.org/export/1.2/excerpt/", "dc": "http://purl.org/dc/elements/1.1/"}
SHA = lambda s: hashlib.sha256(s.encode("utf-8") if isinstance(s, str) else s).hexdigest()

def dump(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

def read_evidence(name):
    baseline = ROOT / 'src/data/source-baseline.json'
    if baseline.exists():
        return json.loads(baseline.read_text(encoding='utf-8'))['files'].get(name, {})
    p = ROOT / "reports/evidence" / name
    return json.loads(p.read_text(encoding="utf-8-sig")) if p.exists() else {}

def index_archive(path):
    entries = {}
    with path.open("rb") as f:
        while header := f.read(4377):
            if len(header) != 4377:
                raise ValueError("Truncated archive header")
            name = header[:255].split(b"\0")[0].decode("utf-8")
            if not name:
                break
            size = int(header[255:269].split(b"\0")[0])
            prefix = header[281:4369].split(b"\0")[0].decode("utf-8")
            member = (prefix.rstrip("/") + "/" + name).removeprefix("./").lstrip("/")
            if ".." in PurePosixPath(member).parts or member in entries:
                raise ValueError("Unsafe or duplicate archive member")
            entries[member] = {"offset": f.tell(), "bytes": size, "crc": header[4369:4377].decode("ascii")}
            f.seek(size, 1)
    return entries

def get_member(f, record):
    f.seek(record["offset"])
    data = f.read(record["bytes"])
    if len(data) != record["bytes"] or f"{zlib.crc32(data):08x}" != record["crc"]:
        raise ValueError("Archive member integrity failure")
    return data

def local_url(value):
    value = html.unescape(value)
    u = U.urlsplit(value)
    path = u.path
    if u.netloc in {"i0.wp.com", "i1.wp.com", "i2.wp.com"} and path.startswith("/nicetrix.com/"):
        path = path[len("/nicetrix.com"):]
        return path
    if u.hostname in {"nicetrix.com", "www.nicetrix.com"}:
        return path + ("?" + u.query if u.query and not path.startswith("/wp-content/uploads/") else "") + ("#" + u.fragment if u.fragment else "")
    return value

class Text(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.skip = 0
    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style"}: self.skip += 1
    def handle_endtag(self, tag):
        if tag in {"script", "style"}: self.skip = max(0, self.skip - 1)
    def handle_data(self, data):
        if not self.skip: self.parts.append(data)

def text(s):
    p = Text(); p.feed(s)
    return " ".join(" ".join(p.parts).split())

def expand_blocks(body):
    def faq(m):
        data = json.loads(m.group(1))
        return '<div class="source-faq">' + "".join(
            '<section><h3 id="' + html.escape(q["id"], quote=True) + '">' + q["title"] + '</h3><div>' + q["content"] + '</div></section>'
            for q in data["questions"] if q.get("visible", True)) + '</div>'
    # Saved Gutenberg FAQ HTML is already complete; only expand dynamic blocks.
    body = re.sub(r'<!--\s*wp:rank-math/faq-block\s+(\{.*?\})\s*/-->', faq, body, flags=re.S)
    def saved_faq(m):
        questions = iter(json.loads(m.group(1))['questions'])
        def anchor(h):
            q = next(questions)
            if re.search(r'\bid=', h.group(1)): return h.group(0)
            return '<h3' + h.group(1) + ' id="' + html.escape(q['id'], quote=True) + '">' + h.group(2) + '</h3>'
        rendered = re.sub(r'<h3([^>]*)>(.*?)</h3>', anchor, m.group(2), flags=re.S)
        # Some original blocks contain more JSON questions than saved/published
        # answers. Preserve that discrepancy: no new answer is made visible.
        # Retain their fragment URLs as aliases to the existing FAQ section.
        aliases = ''.join('<span id="' + html.escape(q['id'], quote=True) + '" class="source-anchor-alias" data-source-question="no-saved-answer" aria-hidden="true"></span>' for q in questions)
        return aliases + rendered
    body = re.sub(r'<!--\s*wp:rank-math/faq-block\s+(\{.*?\})\s*-->(.*?)<!--\s*/wp:rank-math/faq-block\s*-->', saved_faq, body, flags=re.S)
    def saved_howto(m):
        steps = iter(json.loads(m.group(1))['steps'])
        def anchor(h):
            step = next(steps)
            if re.search(r'\bid=', h.group(1)): return h.group(0)
            return '<h3' + h.group(1) + ' id="' + html.escape(step['id'], quote=True) + '">' + h.group(2) + '</h3>'
        return re.sub(r'<h3([^>]*class="rank-math-howto-title"[^>]*)>(.*?)</h3>', anchor, m.group(2), flags=re.S)
    body = re.sub(r'<!--\s*wp:rank-math/howto-block\s+(\{.*?\})\s*-->(.*?)<!--\s*/wp:rank-math/howto-block\s*-->', saved_howto, body, flags=re.S)
    body = re.sub(r'\[caption\b[^\]]*\](.*?)\[/caption\]', r'<figure>\1</figure>', body, flags=re.S)
    def embed(m):
        url = html.unescape(m.group(2).strip())
        u = U.urlsplit(url)
        video = u.path.strip('/') if u.hostname == 'youtu.be' else U.parse_qs(u.query).get('v', [''])[0] if u.hostname in {'youtube.com', 'www.youtube.com'} else ''
        if not re.fullmatch(r'[\w-]{11}', video): return m.group(0)
        return m.group(1) + '<iframe src="https://www.youtube-nocookie.com/embed/' + video + '" title="YouTube video" allowfullscreen></iframe><a href="' + html.escape(url, quote=True) + '">' + m.group(2) + '</a></div>'
    body = re.sub(r'(<div\s+class="wp-block-embed__wrapper"[^>]*>)(\s*https://[^<]+?\s*)</div>', embed, body)
    return body

class PreservedHTML(HTMLParser):
    VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
    def __init__(self, media):
        super().__init__(convert_charrefs=False)
        self.out, self.toc, self.media = [], [], media
        self.skip, self.heading, self.heading_count = 0, None, 0
        self.blocked = []
    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style", "form"}:
            self.skip += 1; self.blocked.append(tag); return
        if self.skip: return
        data = dict(attrs)
        data = {k: v for k, v in data.items() if not k.startswith("on") and k not in {"style", "srcdoc", "formaction"}}
        for key in ("src", "href", "poster"):
            if data.get(key):
                value = local_url(data[key])
                if U.urlsplit(value).scheme.lower() not in {"", "http", "https", "mailto", "tel"}: value = "#"
                data[key] = value
        if "srcset" in data:
            data["srcset"] = ", ".join(local_url(v.strip().rsplit(" ", 1)[0]) + (" " + v.strip().rsplit(" ", 1)[1] if " " in v.strip() else "") for v in data["srcset"].split(",") if v.strip())
        if tag == "img":
            src = data.get("src", "")
            info = self.media.get(U.unquote(U.urlsplit(src).path))
            if info:
                data.update({"width": str(info["width"]), "height": str(info["height"])})
                if info.get("srcset"): data["srcset"] = info["srcset"]
            data.update({"loading": "lazy", "decoding": "async", "sizes": "(max-width: 760px) 100vw, 740px"})
        if tag == "iframe":
            src = data.get("src", "")
            if U.urlsplit(src).hostname not in {"www.youtube.com", "www.youtube-nocookie.com", "www.google.com", "maps.google.com", "player.vimeo.com"}:
                self.blocked.append("iframe:" + src); return
            data.update({"loading": "lazy", "title": data.get("title") or "Embedded content", "referrerpolicy": "strict-origin-when-cross-origin"})
        if tag in {"h2", "h3"}:
            self.heading_count += 1
            data["id"] = data.get("id") or "section-" + str(self.heading_count)
            self.heading = {"id": data["id"], "level": int(tag[1]), "title": ""}
        if data.get("target") == "_blank": data["rel"] = "noopener noreferrer"
        self.out.append("<" + tag + "".join(" " + k + ("" if v is None else '="' + html.escape(v, quote=True) + '"') for k, v in data.items()) + ">")
    def handle_startendtag(self, tag, attrs): self.handle_starttag(tag, attrs)
    def handle_endtag(self, tag):
        if tag in {"script", "style", "form"}:
            self.skip = max(0, self.skip - 1); return
        if self.skip: return
        if self.heading and tag in {"h2", "h3"}:
            self.heading["title"] = html.unescape(self.heading["title"])
            self.toc.append(self.heading); self.heading = None
        if tag not in self.VOID: self.out.append("</" + tag + ">")
    def handle_data(self, data):
        if self.skip: return
        self.out.append(data)
        if self.heading: self.heading["title"] += data
    def handle_entityref(self, name):
        self.handle_data("&" + name + ";")
    def handle_charref(self, name):
        self.handle_data("&#" + name + ";")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--backup-dir", type=Path, default=Path(r"F:\Vibe Developments\NiceTrix Backup"))
    ap.add_argument("--verify-only", action="store_true")
    args = ap.parse_args()
    wxr = args.backup_dir / "nicetrix.WordPress.2026-10-16.xml"
    archive = args.backup_dir / "nicetrix-com.wpress"
    channel = E.parse(wxr).getroot().find("channel")
    def val(el, key): return el.findtext(key, default="", namespaces=NS) or ""
    items = channel.findall("item")
    published = [i for i in items if val(i, "wp:status") == "publish" and val(i, "wp:post_type") in {"post", "page"}]
    assert len(published) == 60 and sum(val(i, "wp:post_type") == "post" for i in published) == 51
    index = index_archive(archive)
    # Whitelist image formats; never extract CSV, code, caches, JSON or form uploads.
    assets = {p: m for p, m in index.items() if p.startswith("uploads/") and Path(p).suffix.lower() in {".jpg", ".jpeg", ".png", ".webp", ".gif"}}
    media_api = read_evidence("media-public.json").get("items", [])
    media_by_id, media_by_url = {}, {}
    for m in media_api:
        if m.get("media_type") != "image": continue
        details = m.get("media_details", {})
        src = '/wp-content/uploads/' + details['file']
        directory = str(PurePosixPath(details['file']).parent)
        # REST source_url often points every size at the same Jetpack proxy URL.
        # The verified metadata file field names the actual archived binary.
        variants = [{"url": '/wp-content/uploads/' + directory + '/' + U.urlsplit(v['file']).path, "width": v["width"], "height": v["height"]} for v in details.get("sizes", {}).values() if v.get("file") and v.get("mime_type", "").startswith("image/")]
        variants.append({"url": src, "width": details.get("width", 0), "height": details.get("height", 0)})
        ratio = details['width'] / details['height']
        widths = {v["width"]: v for v in variants if v["width"] and abs(v['width'] / v['height'] - ratio) < .035 and ("uploads/" + U.unquote(v["url"]).split("/uploads/")[-1]) in assets}
        srcset = ", ".join(f'{v["url"]} {w}w' for w, v in sorted(widths.items()))
        info = {"id": m["id"], "src": src, "width": details.get("width", 0), "height": details.get("height", 0), "alt": m.get("alt_text", ""), "caption": m.get("caption", {}).get("rendered", ""), "srcset": srcset, "url": m["link"]}
        media_by_id[m["id"]] = info
        for v in variants: media_by_url[U.unquote(v["url"])] = {**info, "width": v["width"], "height": v["height"]}
    # Public REST baseline supplements source-only author/taxonomy metadata.
    # Store no account emails, logins, comment IPs, credentials or private records.
    users = read_evidence("users-public.json").get("items", [])
    authors = [{"id": u["id"], "name": u["name"], "slug": u["slug"], "path": U.urlsplit(u["link"]).path, "description": u.get("description", ""), "avatar": local_url(u.get("avatar_urls", {}).get("96", "")) if "nicetrix.com/wp-content/uploads/" in u.get("avatar_urls", {}).get("96", "") else ""} for u in users]
    authors_by_login = {}
    for a in channel.findall("wp:author", NS):
        aid = int(val(a, "wp:author_id"))
        authors_by_login[val(a, "wp:author_login")] = next(x for x in authors if x["id"] == aid)
    taxonomy = {}
    for kind, source in [("categories", "categories-public.json"), ("tags", "tags-public.json")]:
        taxonomy[kind] = [{"id": x["id"], "slug": x["slug"], "name": html.unescape(x["name"]), "path": U.urlsplit(x["link"]).path, "description": x.get("description", "")} for x in read_evidence(source).get("items", [])]
    seo_baseline = {x["id"]: x for x in read_evidence("seo-baseline.json").get("items", [])}
    records, reconciliation, exceptions, legacy_redirects = [], [], [], []
    for item in published:
        pid = int(val(item, "wp:post_id")); kind = val(item, "wp:post_type")
        raw = val(item, "content:encoded")
        expanded = expand_blocks(raw)
        renderer = PreservedHTML(media_by_url); renderer.feed(expanded)
        rendered = "".join(renderer.out)
        if pid == 565:
            rendered = re.sub(r'\[contact-form-7\b[^\]]*\]', '<p class="service-notice" role="note">অনলাইন যোগাযোগ ফরম বর্তমানে চালু নেই। উপরে দেওয়া অফিস ফোনে যোগাযোগ করুন।</p>', rendered)
            exceptions.append({"id": pid, "path": "/get-in-touch/", "feature": "Contact Form 7", "status": "NOT CONFIGURED", "sourceFormId": 8003})
        if pid == 8581:
            exceptions.append({"id": pid, "path": "/nbr-audit/", "feature": "WPCode 8580 + TIN/BIN datasets", "status": "UNAVAILABLE", "sourceSnippetSHA256": "b0b0af4b47ca8ef2fdc1471d246d6cbc98d7bab9d1dca181e4db6ae789c826be", "missing": ["/wp-content/uploads/tin_list.csv", "/wp-content/uploads/bin_list.csv"], "datedTinNotPublished": True})
        if renderer.blocked: exceptions.append({"id": pid, "removedUnsafeElements": renderer.blocked})
        seo = seo_baseline.get(pid, {})
        meta = {m.get("property") or m.get("name"): m.get("content", "") for m in seo.get("metadata", []) if m.get("tag") == "meta" and (m.get("property") or m.get("name"))}
        pm = {val(x, "wp:meta_key"): val(x, "wp:meta_value") for x in item.findall("wp:postmeta", NS)}
        cats = [x["id"] for x in taxonomy["categories"] if any(c.attrib.get("domain") == "category" and c.attrib.get("nicename") == x["slug"] for c in item.findall("category"))]
        tags = [x["id"] for x in taxonomy["tags"] if any(c.attrib.get("domain") == "post_tag" and c.attrib.get("nicename") == x["slug"] for c in item.findall("category"))]
        image = media_by_id.get(int(pm.get("_thumbnail_id") or 0))
        author = authors_by_login[val(item, "dc:creator")]
        url = val(item, "link"); path = U.urlsplit(url).path
        for old in item.findall('wp:postmeta', NS):
            if val(old, 'wp:meta_key') == '_wp_old_slug' and val(old, 'wp:meta_value'):
                old_path = '/' + val(old, 'wp:meta_value') + '/'
                if U.unquote(old_path) != U.unquote(path):
                    legacy_redirects.append({'from': old_path, 'to': path, 'status': 301, 'wpId': pid, 'evidence': 'Original _wp_old_slug postmeta'})
        source_text = text(expanded)
        # Exact source field values are retained even when rendered markup is enhanced.
        record = {"id": str(pid), "wpId": pid, "type": kind, "status": "publish", "title": val(item, "title"), "slug": val(item, "wp:post_name"), "url": url, "path": path, "authorId": author["id"], "categoryIds": cats, "tagIds": tags, "published": val(item, "wp:post_date"), "publishedGmt": val(item, "wp:post_date_gmt"), "modified": val(item, "wp:post_modified"), "modifiedGmt": val(item, "wp:post_modified_gmt"), "excerptOriginal": val(item, "excerpt:encoded"), "originalHtml": raw, "sourceSHA256": SHA(raw), "visibleTextSHA256": SHA(source_text), "html": rendered, "toc": renderer.toc, "readingMinutes": max(1, round(len(source_text.split()) / 180)), "image": image, "seo": {"title": seo.get("title") or val(item, "title") + " - NiceTrix", "description": next(iter(seo.get("description", [])), ""), "canonical": next(iter(seo.get("canonical", [])), url), "robots": next(iter(seo.get("robots", [])), "index, follow"), "social": {k: v for k, v in meta.items() if k.startswith("og:") or k.startswith("twitter:")}, "sourceFields": {k: v for k, v in pm.items() if k.startswith("rank_math_") and not any(term in k for term in ("analytics", "token", "score", "object_id"))}}, "approvedComments": []}
        record['seo']['social'].update({k: v for k, v in meta.items() if k.startswith('article:')})
        for comment in item.findall("wp:comment", NS):
            if val(comment, "wp:comment_approved") == "1" and val(comment, "wp:comment_type") in {"", "comment"}:
                cp = PreservedHTML(media_by_url); cp.feed(val(comment, "wp:comment_content"))
                record["approvedComments"].append({"id": int(val(comment, "wp:comment_id")), "name": val(comment, "wp:comment_author"), "date": val(comment, "wp:comment_date_gmt"), "html": "".join(cp.out)})
        if kind == "post" and text(rendered) != source_text:
            raise ValueError(f"Article {pid}: unexplained visible text difference")
        records.append(record)
        reconciliation.append({"id": pid, "path": path, "type": kind, "sourceSHA256": SHA(raw), "visibleTextSHA256": SHA(source_text), "renderedTextMatches": text(rendered) == source_text, "exception": pid in {565, 8581, 7460}})
    records.sort(key=lambda x: x["wpId"])
    media_manifest = []
    with archive.open("rb") as f:
        for name, entry in sorted(assets.items()):
            data = get_member(f, entry)
            path = ROOT / "public/wp-content" / name
            if args.verify_only:
                assert path.exists() and SHA(path.read_bytes()) == SHA(data), f"Media mismatch {name}"
            else:
                path.parent.mkdir(parents=True, exist_ok=True)
                if not path.exists() or SHA(path.read_bytes()) != SHA(data): path.write_bytes(data)
            media_manifest.append({"path": "/wp-content/" + name, "bytes": len(data), "sha256": SHA(data)})
    site = {"name": "NiceTrix", "url": "https://nicetrix.com", "authors": authors, **taxonomy, "media": list(media_by_id.values()), "ads": {"publisher": "ca-pub-6673594317291335", "slots": {"article": "8698402341", "related": "7200794943", "sidebar": "2956429611"}}, "exceptions": exceptions}
    if args.verify_only:
        assert json.loads((ROOT / "src/data/content.json").read_text(encoding="utf-8")) == records, "Generated content differs from original source or evidence"
        assert json.loads((ROOT / "src/data/site.json").read_text(encoding="utf-8")) == site
    else:
        dump(ROOT / "src/data/content.json", records)
        dump(ROOT / "src/data/site.json", site)
        dump(ROOT / "src/data/media-manifest.json", media_manifest)
        dump(ROOT / 'src/data/legacy-redirects.json', legacy_redirects)
        published_paths = {U.unquote(r['path']) for r in records}
        assert all(U.unquote(r['from']) not in published_paths for r in legacy_redirects), 'Historical redirect collides with published content'
        rules = ['/sitemap_index.xml /sitemap.xml 301', '/post-sitemap.xml /sitemap.xml 301', '/page-sitemap.xml /sitemap.xml 301', '/category-sitemap.xml /sitemap.xml 301', '/author-sitemap.xml /sitemap.xml 301', '/tag-sitemap.xml /sitemap.xml 301', '/feed/ /feed/index.xml 200']
        (ROOT / 'public/_redirects').write_text('\n'.join(rules + [f"{r['from']} {r['to']} 301" for r in legacy_redirects]) + '\n', encoding='utf-8')
        dump(ROOT / "reports/content-reconciliation.json", {"posts": 51, "pages": 9, "sourceWxrSHA256": SHA(wxr.read_bytes()), "records": reconciliation, "exceptions": exceptions, "imagesExtracted": len(media_manifest), "excluded": "CSV, plugin/cache files, executable code, drafts, account data; original backups untouched"})
    print(json.dumps({"status": "PASS", "mode": "verify" if args.verify_only else "import", "posts": 51, "pages": 9, "categories": len(site["categories"]), "tags": len(site["tags"]), "authors": len(authors), "mediaFiles": len(media_manifest), "articleTextDifferences": 0, "exceptions": len(exceptions)}, ensure_ascii=False))

if __name__ == "__main__": main()
