#!/usr/bin/env python3
"""Download the photos and videos of rows written by instaloader_map.py, Instaloader-style.

One folder per target (nasa/, #travel/, %213131048/), files named {date_utc}_UTC like
Instaloader's: 2026-09-10_21-20-24_UTC_1.jpg for the first slide of a carousel, .mp4 for videos,
and the caption in a .txt next to them. Files that already exist are skipped, so a re-run only
fetches what is missing.

Instagram's media URLs are signed and expire, usually within a few days of the run, so download
soon after scraping. Saving media for your own analysis is one thing; republishing it needs the
owner's permission.

Reads JSONL or JSON (this script's input can also be an Apify Console export of the Actor's rows).
Standard library only: no token, no pip install. Python 3.9+.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".mp4", ".mov"}


def read_rows(path: str) -> list[dict]:
    text = Path(path).read_text(encoding="utf-8-sig").strip()
    if not text:
        return []
    if text.startswith("["):
        return json.loads(text)
    return [json.loads(line) for line in text.splitlines() if line.strip()]


def safe(part: str) -> str:
    """A file or folder name that works on Windows, macOS and Linux."""
    s = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "_", part or "").strip().rstrip(".")
    return s or "_"


def date_utc(created_at: str | None) -> str:
    """2026-09-10T21:20:24.000Z -> 2026-09-10_21-20-24 (Instaloader's {date_utc})."""
    m = re.match(r"^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})", created_at or "")
    return f"{m.group(1)}_{m.group(2)}-{m.group(3)}-{m.group(4)}" if m else "unknown-date"


def ext_of(url: str, default: str) -> str:
    suffix = Path(urlparse(url).path).suffix.lower()
    return suffix if suffix in EXTENSIONS else default


def fill(pattern: str, row: dict, profile: str) -> str:
    target = row.get("target") or profile
    return (pattern.replace("{target}", safe(target)).replace("{profile}", safe(profile))
            .replace("{shortcode}", safe(row.get("code") or "")).replace("{date_utc}", date_utc(row.get("createdAt"))))


def jobs_for(row: dict, args) -> list[tuple[str, str]]:
    """(url, path without extension + default extension) for every file of one row."""
    out: list[tuple[str, str]] = []
    kind = row.get("dataType")
    if kind == "profile":
        pic = row.get("hdProfilePicUrl") or row.get("profilePicUrl")
        user = row.get("username") or "profile"
        if pic and not args.no_profile_pic:
            folder = fill(args.dirname_pattern, row, user)
            out.append((pic, f"{folder}/{safe(user)}_profile_pic|.jpg"))
        return out
    if kind not in (None, "post") or not row.get("code"):
        return out
    profile = (row.get("owner") or {}).get("username") or "unknown"
    base = f"{fill(args.dirname_pattern, row, profile)}/{fill(args.filename_pattern, row, profile)}"
    no_thumbs = args.no_video_thumbnails or args.no_pictures
    slides = row.get("carousel") or []
    if slides:
        for i, s in enumerate(slides, start=1):
            if s.get("type") == "video" and s.get("videoUrl"):
                if not args.no_videos:
                    out.append((s["videoUrl"], f"{base}_{i}|.mp4"))
                if s.get("url") and not no_thumbs:
                    out.append((s["url"], f"{base}_{i}|.jpg"))
            elif s.get("url") and not args.no_pictures:
                out.append((s["url"], f"{base}_{i}|.jpg"))
    else:
        video = row.get("video") or {}
        image = (row.get("image") or {}).get("url")
        if video.get("url"):
            if not args.no_videos:
                out.append((video["url"], f"{base}|.mp4"))
            if image and not no_thumbs:
                out.append((image, f"{base}|.jpg"))
        elif image and not args.no_pictures:
            out.append((image, f"{base}|.jpg"))
    return out


def fetch(url: str, path: Path, timeout: int) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (download_media.py)"})
    tmp = path.with_name(path.name + ".part")
    with urllib.request.urlopen(req, timeout=timeout) as resp, tmp.open("wb") as f:
        while True:
            chunk = resp.read(1 << 16)
            if not chunk:
                break
            f.write(chunk)
    tmp.replace(path)


def main() -> None:
    p = argparse.ArgumentParser(
        prog="download_media.py",
        description="Download the photos and videos of rows written by instaloader_map.py, Instaloader-style.",
        epilog="example: python download_media.py nasa.jsonl --dest media --no-videos",
        allow_abbrev=False,
    )
    p.add_argument("files", nargs="+", metavar="ROWS", help=".jsonl from instaloader_map.py (or a JSON/JSONL export of the Actor's rows)")
    p.add_argument("--dest", default=".", metavar="DIR", help="where the target folders go (default: here)")
    p.add_argument("--dirname-pattern", default="{target}", metavar="P", help="folder per post: {target}, {profile} (default {target})")
    p.add_argument("--filename-pattern", default="{date_utc}_UTC", metavar="P", help="file name: {date_utc}, {shortcode}, {profile}, {target} (default {date_utc}_UTC)")
    p.add_argument("--no-pictures", action="store_true", help="skip photos (implies --no-video-thumbnails)")
    p.add_argument("-V", "--no-videos", action="store_true", help="skip videos")
    p.add_argument("--no-video-thumbnails", action="store_true", help="skip the cover image of videos")
    p.add_argument("--no-captions", action="store_true", help="don't write the caption .txt files")
    p.add_argument("--no-profile-pic", action="store_true", help="skip profile pictures of profile rows")
    p.add_argument("--timeout", type=int, default=60, metavar="S", help="seconds per file (default 60)")
    args = p.parse_args()

    rows = [r for f in args.files for r in read_rows(f)]
    dest = Path(args.dest)
    got = skipped = expired = failed = 0
    for row in rows:
        jobs = jobs_for(row, args)
        if row.get("dataType") in (None, "post") and row.get("code") and row.get("caption") and not args.no_captions:
            profile = (row.get("owner") or {}).get("username") or "unknown"
            txt = dest / f"{fill(args.dirname_pattern, row, profile)}/{fill(args.filename_pattern, row, profile)}.txt"
            if not txt.exists():
                txt.parent.mkdir(parents=True, exist_ok=True)
                txt.write_text(row["caption"] + "\n", encoding="utf-8")
        for url, spec in jobs:
            stem, default_ext = spec.split("|")
            path = dest / (stem + ext_of(url, default_ext))
            if not url.startswith("http") or " " in url:
                skipped += 1  # the committed samples have placeholders instead of real media URLs
                continue
            if path.exists() and path.stat().st_size > 0:
                skipped += 1
                continue
            path.parent.mkdir(parents=True, exist_ok=True)
            try:
                fetch(url, path, args.timeout)
                got += 1
                print(f"  {path}", file=sys.stderr)
            except urllib.error.HTTPError as e:
                if e.code in (403, 410):
                    expired += 1
                else:
                    failed += 1
                    print(f"  failed ({e.code}): {path}", file=sys.stderr)
            except Exception as e:  # network errors: report and go on with the next file
                failed += 1
                print(f"  failed ({e.__class__.__name__}): {path}", file=sys.stderr)

    print(f"Downloaded {got} files, skipped {skipped} (already there or no real URL), "
          f"{expired} expired links, {failed} failed.", file=sys.stderr)
    if expired:
        print("Expired links: Instagram's media URLs are signed and stop working after a few days. "
              "Run instaloader_map.py again and download right away.", file=sys.stderr)


if __name__ == "__main__":
    main()
