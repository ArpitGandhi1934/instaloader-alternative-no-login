#!/usr/bin/env python3
"""Instaloader-style Instagram scraping without a login.

Give it the targets you would give Instaloader (a profile, "#hashtag", %location_id or
-- -SHORTCODE) and the Instaloader options that have a logged-out equivalent. It runs the
yugenox/instagram-scraper Actor on Apify and writes one row per post, profile or comment to
JSONL or CSV. download_media.py then saves the photos and videos into one folder per target,
the way Instaloader does.

Instaloader options that only work with a logged-in account (--login, --stories, --highlights,
--tagged, @profile, :feed, :saved ...) stop the script with an explanation instead of being
dropped silently. Options about files and connections are ignored with a note.

Run with --help for every option. Requires Python 3.10+ and `pip install -r requirements.txt`.
APIFY_TOKEN comes from the environment or a .env file next to this script; --from needs no token.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
from collections import Counter
from decimal import Decimal
from pathlib import Path
from urllib.parse import unquote

ACTOR = "yugenox/instagram-scraper"
IG = "https://www.instagram.com/"

EPILOG = """\
targets (Instaloader syntax):
  nasa                  a public profile's posts, newest first
  "#travel"             a hashtag's top posts (about 60; only hashtags with a public page)
  %213131048            a location's top and most recent posts (about 70)
  -- -DRvit9Ejgel       one post by shortcode, written as in Instaloader (the -- is optional here)
  any instagram.com URL a profile, /reels/ tab, post, reel, hashtag, location or audio page
  +args.txt             read targets and options from a file, one per line

not available without a login (the script stops and says why):
  --login --stories --highlights --tagged --post-filter --latest-stamps @profile :feed :stories :saved

price: $1.90 per 1,000 rows (posts, profiles, places, keywords or comments) on Apify's Free and
Starter plans, $1.50 on Scale, $1.10 on Business (in force since 2026-09-26, checked 2026-10-06).
Comments attached with --comments are included. Free plans stop at 100 rows per run.

examples:
  python instaloader_map.py nasa --count 50 --out nasa.csv
  python instaloader_map.py nasa natgeo --no-posts --out profiles.csv
  python instaloader_map.py "#travel" %213131048 -- -DRvit9Ejgel
  python instaloader_map.py nasa --fast-update --out "nasa-$(date +%F).jsonl"
  python download_media.py nasa.jsonl
"""

# Instaloader options that need a logged-in Instagram account, or have no equivalent here.
# They stop the script with this explanation instead of being dropped silently.
_LOGIN = ("This script never signs in to Instagram. Public profiles, posts, hashtags, locations and "
          "comments need no account; private profiles stay out of reach.")
STOP = {
    **dict.fromkeys(["--login", "-l", "--password", "-p", "--sessionfile", "-f",
                     "--load-cookies", "-b", "--cookiefile", "-B"], _LOGIN),
    **dict.fromkeys(["--stories", "-s", "--storyitem-filter", "--storyitem-metadata-txt"],
                    "Stories are only shown to logged-in Instagram accounts, so no logged-out tool can download them."),
    "--highlights": ("The contents of highlights are only shown to logged-in accounts. Highlight titles and "
                     "covers are on profile rows (--profile-rows or --no-posts)."),
    "--tagged": "Posts a profile is tagged in are only shown to logged-in Instagram accounts.",
    **dict.fromkeys(["--post-filter", "--only-if"],
                    "Python filter expressions aren't supported. Use --min-likes, --min-plays, --since, "
                    "--videos-only or --skip-pinned (they run on Apify before billing) or filter the output "
                    "afterwards. MAPPING.md translates the common expressions."),
    "--latest-stamps": ("Use --fast-update. What earlier runs saved is remembered in your Apify account "
                        "(under --monitor-key), not in a local stamps file."),
    "--igtv": ("There is no separate IGTV input: video posts come with the profile's posts, and --reels "
               "adds the profile's reels tab."),
}

# Instaloader options that don't apply to a data export. Ignored with a note: {flag: takes a value}.
FILE_FLAGS = {"--no-pictures": False, "--no-videos": False, "-V": False, "--no-video-thumbnails": False,
              "--no-captions": False, "--no-metadata-json": False, "--no-compress-json": False,
              "--no-profile-pic": False, "--post-metadata-txt": True, "--slide": True,
              "--dirname-pattern": True, "--filename-pattern": True, "--title-pattern": True,
              "--sanitize-paths": False}
NETWORK_FLAGS = {"--user-agent": True, "--max-connection-attempts": True, "--request-timeout": True,
                 "--abort-on": True, "--no-iphone": False, "--resume-prefix": True, "--no-resume": False}

# This script's own options that take a value (so the pre-scan doesn't read the value as a flag).
VALUE_OPTS = {"--count", "-c", "--max-total", "--max-charge", "--monitor-key", "--comments-per-post",
              "--max-comments", "--related-keywords", "--since", "--min-likes", "--min-plays", "--out", "--dataset",
              "--from"}

POST_COLUMNS = [
    "target", "code", "url", "created_at", "type", "caption", "likes", "comments", "plays", "views",
    "video_duration", "owner", "owner_followers", "owner_verified", "is_pinned", "is_paid_partnership",
    "location", "location_lat", "location_lng", "hashtags", "mentions", "tagged_users", "coauthors",
    "audio_title", "audio_artist", "engagement_rate", "carousel_count", "image_url", "video_url",
]
PROFILE_COLUMNS = [
    "target", "username", "full_name", "followers", "following", "biography", "external_url", "bio_links",
    "emails", "phones", "category", "account_type", "is_verified", "is_private", "highlights", "has_reels",
    "threads_username", "instagram_graph_id", "follower_delta", "related_profiles", "profile_pic_url", "url",
]
COMMENT_COLUMNS = ["target", "post_code", "comment_id", "username", "text", "likes", "created_at", "is_post_owner"]
PLACE_COLUMNS = ["target", "id", "name", "category", "lat", "lng", "address", "city", "post_count", "url"]
KEYWORD_COLUMNS = ["target", "keyword", "has_public_posts", "description", "related_keywords", "url"]
# dataType -> (CSV file suffix, columns). The run's main type goes to --out itself.
TABLES = {
    "post": ("posts", POST_COLUMNS),
    "comment": ("comments", COMMENT_COLUMNS),
    "profile": ("profiles", PROFILE_COLUMNS),
    "place": ("places", PLACE_COLUMNS),
    "keyword": ("keywords", KEYWORD_COLUMNS),
}


def stop(msg: str) -> None:
    print(f"instaloader_map.py: {msg}", file=sys.stderr)
    sys.exit(2)


def load_dotenv(path: Path = Path(__file__).with_name(".env")) -> None:
    """Minimal .env reader so the script has no extra dependency."""
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _field(obj, camel: str, snake: str):
    """apify-client v1/v2 return dicts, v3 returns model objects. Support both."""
    if obj is None:
        return None
    return obj.get(camel) if isinstance(obj, dict) else getattr(obj, snake, None)


def preprocess(argv: list[str]) -> tuple[list[str], list[str], list[str]]:
    """Instaloader compatibility before argparse sees the arguments.

    Expands +args.txt files, stops on options that need a login, drops file and network options
    with a note, and splits off Instaloader's -SHORTCODE post targets.
    Returns (arguments for argparse, -SHORTCODE targets, notes)."""
    expanded: list[str] = []
    for a in argv:
        if a.startswith("+") and len(a) > 1:
            p = Path(a[1:])
            if not p.is_file():
                stop(f"{a}: no such file")
            expanded += [s.strip() for s in p.read_text(encoding="utf-8").splitlines() if s.strip()]
        else:
            expanded.append(a)

    opts: list[str] = []
    late: list[str] = []
    notes: list[str] = []
    after = False
    i = 0
    while i < len(expanded):
        a = expanded[i]
        if a == "--":
            after = True
            i += 1
            continue
        # -SHORTCODE: Instaloader wants it after --; a full 11-character code works anywhere here.
        if re.match(r"^-[A-Za-z0-9_][A-Za-z0-9_-]{%d,}$" % (4 if after else 9), a):
            late.append(a)
            i += 1
            continue
        flag = a.split("=", 1)[0] if a.startswith("--") else a
        if flag in STOP:
            stop(f"{flag}: {STOP[flag]}")
        if flag in FILE_FLAGS or flag in NETWORK_FLAGS:
            if flag in FILE_FLAGS:
                takes = FILE_FLAGS[flag]
                notes.append(f"{flag} ignored: it is about saving files; download_media.py does that (see its --help).")
            else:
                takes = NETWORK_FLAGS[flag]
                notes.append(f"{flag} ignored: requests run on Apify, and retries and rate limits are the Actor's job.")
            i += 2 if takes and "=" not in a else 1
            continue
        opts.append(a)
        if flag in VALUE_OPTS and "=" not in a and i + 1 < len(expanded):
            opts.append(expanded[i + 1])
            i += 2
            continue
        i += 1
    return opts, late, notes


def canonical(target: str) -> str:
    """Instaloader target -> an input the Actor understands (an Instagram URL)."""
    t = target.strip()
    if t.startswith("@"):
        stop(f"{t}: @profile means the accounts a profile follows in Instaloader. Follower and following "
             "lists are only shown to logged-in accounts. For the profile itself, drop the @.")
    if t.startswith(":"):
        stop(f"{t}: your feed, stories and saved posts belong to a logged-in account; there is nothing "
             "to read without one.")
    if re.search(r"\.json(\.xz)?$", t, re.I):
        stop(f"{t}: re-downloading from Instaloader's metadata files isn't supported; pass the profile, "
             "hashtag or post instead.")
    if re.match(r"^(https?://)?([a-z0-9-]+\.)?instagram\.com(/|$)", t, re.I):
        return t if re.match(r"^https?://", t, re.I) else "https://" + t
    if re.match(r"^#[^\s#/]+$", t):
        return f"{IG}explore/tags/{t[1:]}/"
    if re.match(r"^%\d+$", t):
        return f"{IG}explore/locations/{t[1:]}/"
    if re.match(r"^-[A-Za-z0-9_-]{5,}$", t):
        return f"{IG}p/{t[1:]}/"
    if re.match(r"^\d{3,20}$", t):
        return t  # a numeric Instagram user id
    if re.match(r"^[A-Za-z0-9._]{1,30}$", t):
        return f"{IG}{t}/"
    stop(f"{t}: not a profile, \"#hashtag\", %location_id, -SHORTCODE or Instagram URL")
    return t


RESERVED = {"explore", "reels", "reel", "p", "tv", "stories", "accounts", "direct", "popular", "about",
            "legal", "developer", "web", "share"}


def target_of(inp: str) -> str:
    """The Actor input a row came from -> the Instaloader-style target (nasa, #travel, %id, -CODE)."""
    m = re.match(r"^https?://(?:[a-z0-9-]+\.)?instagram\.com/([^?#]*)", inp or "", re.I)
    if not m:
        return inp or ""
    parts = [unquote(p) for p in m.group(1).split("/") if p]
    if len(parts) >= 3 and parts[0] == "explore" and parts[1] == "tags":
        return "#" + parts[2]
    if len(parts) >= 3 and parts[0] == "explore" and parts[1] == "locations":
        return "%" + parts[2]
    if len(parts) >= 2 and parts[0] in ("p", "reel", "tv"):
        return "-" + parts[1]
    if len(parts) >= 2 and parts[0] == "reels" and parts[1] != "audio":
        return "-" + parts[1]
    if parts and parts[0].lower() not in RESERVED:
        if len(parts) >= 3 and parts[1] in ("p", "reel"):
            return "-" + parts[2]
        return parts[0]
    return inp


def is_profile_target(t: str) -> bool:
    return bool(re.match(r"^[A-Za-z0-9._]{1,30}$", t)) and not t.isdigit()


def with_target(r: dict) -> dict:
    """Prefix every row with the Instaloader-style target it came from (Instaloader's folder name)."""
    t = r.get("target") or target_of(((r.get("source") or {}).get("input")) or "")
    return {"target": t, **r}


def join(values) -> str:
    return ", ".join(str(v) for v in (values or []) if v is not None)


def post_row(r: dict) -> dict:
    owner = r.get("owner") or {}
    loc = r.get("location") or {}
    video = r.get("video") or {}
    image = r.get("image") or {}
    audio = r.get("audio") or {}
    return {
        "target": r.get("target"),
        "code": r.get("code"),
        "url": r.get("url"),
        "created_at": r.get("createdAt"),
        "type": r.get("mediaType"),
        "caption": r.get("caption"),
        "likes": r.get("likeCount"),
        "comments": r.get("commentCount"),
        "plays": video.get("playCount"),
        "views": video.get("viewCount"),
        "video_duration": video.get("duration"),
        "owner": owner.get("username"),
        "owner_followers": owner.get("followerCount"),
        "owner_verified": owner.get("isVerified"),
        "is_pinned": r.get("isPinned"),
        "is_paid_partnership": r.get("isPaidPartnership"),
        "location": loc.get("name"),
        "location_lat": loc.get("lat"),
        "location_lng": loc.get("lng"),
        "hashtags": join(r.get("hashtags")),
        "mentions": join(r.get("mentions")),
        "tagged_users": join([u.get("username") for u in r.get("taggedUsers") or [] if u]),
        "coauthors": join([u.get("username") for u in r.get("coowners") or [] if u]),
        "audio_title": audio.get("title"),
        "audio_artist": audio.get("artist"),
        "engagement_rate": r.get("engagementRate"),
        "carousel_count": r.get("carouselCount"),
        "image_url": image.get("url"),
        "video_url": video.get("url"),
    }


def profile_row(r: dict) -> dict:
    return {
        "target": r.get("target"),
        "username": r.get("username"),
        "full_name": r.get("fullName"),
        "followers": r.get("followerCount"),
        "following": r.get("followingCount"),
        "biography": r.get("biography"),
        "external_url": r.get("externalUrl"),
        "bio_links": join([link.get("url") for link in r.get("bioLinks") or [] if link]),
        "emails": join(r.get("emails")),
        "phones": join(r.get("phones")),
        "category": r.get("category"),
        "account_type": r.get("accountType"),
        "is_verified": r.get("isVerified"),
        "is_private": r.get("isPrivate"),
        "highlights": r.get("highlightCount"),
        "has_reels": r.get("hasReels"),
        "threads_username": r.get("threadsUsername"),
        "instagram_graph_id": r.get("instagramGraphId"),
        "follower_delta": (r.get("changes") or {}).get("followerDelta"),
        "related_profiles": join([p.get("username") for p in r.get("relatedProfiles") or [] if p]),
        "profile_pic_url": r.get("hdProfilePicUrl") or r.get("profilePicUrl"),
        "url": r.get("url"),
    }


def comment_row(c: dict, post: dict | None = None) -> dict:
    """A comment row, or one of a post's latestComments (then `post` is that post)."""
    owner = c.get("owner") or {}
    if post is None:
        return {
            "target": c.get("target"), "post_code": c.get("postCode"), "comment_id": c.get("id"),
            "username": owner.get("username"), "text": c.get("text"), "likes": c.get("likeCount"),
            "created_at": c.get("createdAt"), "is_post_owner": c.get("isPostOwner"),
        }
    post_owner = (post.get("owner") or {}).get("username")
    mine = None if not owner.get("username") or not post_owner else owner.get("username") == post_owner
    return {
        "target": post.get("target"), "post_code": post.get("code"), "comment_id": c.get("id"),
        "username": owner.get("username"), "text": c.get("text"), "likes": c.get("likeCount"),
        "created_at": c.get("createdAt"), "is_post_owner": mine,
    }


def place_row(r: dict) -> dict:
    return {
        "target": r.get("target"), "id": r.get("id"), "name": r.get("name"), "category": r.get("category"),
        "lat": r.get("lat"), "lng": r.get("lng"), "address": r.get("address"), "city": r.get("city"),
        "post_count": r.get("postCount"), "url": r.get("url"),
    }


def keyword_row(r: dict) -> dict:
    return {
        "target": r.get("target"), "keyword": r.get("keyword"), "has_public_posts": r.get("hasPublicPosts"),
        "description": r.get("description"), "related_keywords": join(r.get("relatedKeywords")),
        "url": r.get("url"),
    }


def js_number(f: float) -> str:
    """Format a float the way JavaScript's String(number) does, so both scripts write the same CSV."""
    if f.is_integer() and abs(f) < 1e21:
        return str(int(f))
    r = repr(f)
    if "e" in r:
        mant, exp = r.split("e")
        e = int(exp)
        if -7 < e < 21:
            return format(Decimal(r), "f")
        return f"{mant}e{'+' if e > 0 else '-'}{abs(e)}"
    return r


def cell(v) -> str:
    """CSV cell. Text that starts with = + - @, a tab or a carriage return gets a leading ' so Excel and
    Google Sheets show it as text instead of running it as a formula (captions are written by strangers)."""
    if v is None:
        return ""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, float):
        return js_number(v)
    if isinstance(v, int):
        return str(v)
    if isinstance(v, (list, dict)):
        return json.dumps(v, ensure_ascii=False, separators=(",", ":"))
    s = str(v)
    return "'" + s if s[:1] in ("=", "+", "-", "@", "\t", "\r") else s


def write_csv(path: Path, columns: list[str], rows: list[dict]) -> None:
    # UTF-8 with a BOM, so Excel shows emoji and accents correctly when it opens the file.
    with path.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(columns)
        for r in rows:
            w.writerow([cell(r.get(c)) for c in columns])


def main_type(rows: list[dict], mode: str | None) -> str:
    if mode:
        return mode
    kinds = {r.get("dataType") for r in rows}
    for k in ("post", "comment", "profile", "place", "keyword"):
        if k in kinds:
            return k
    return "post"


def write_out(out: str, rows: list[dict], mode: str | None) -> list[str]:
    """Write the rows; returns the files written. JSONL keeps every row as the Actor returned it."""
    p = Path(out)
    if out.lower().endswith(".jsonl"):
        with p.open("w", encoding="utf-8") as f:
            for r in rows:
                f.write(json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "\n")
        return [out]

    tables: dict[str, list[dict]] = {k: [] for k in TABLES}
    builders = {"post": post_row, "comment": comment_row, "profile": profile_row, "place": place_row,
                "keyword": keyword_row}
    for r in rows:
        kind = r.get("dataType")
        if kind in builders:
            tables[kind].append(builders[kind](r))
        if kind == "post":
            for c in r.get("latestComments") or []:
                tables["comment"].append(comment_row(c, r))
    main = main_type(rows, mode)
    written = []
    stem = out[:-4]
    for kind, (suffix, columns) in TABLES.items():
        if kind != main and not tables[kind]:
            continue
        path = out if kind == main else f"{stem}.{suffix}.csv"
        write_csv(Path(path), columns, tables[kind])
        written.append(path)
    return written


def read_from_file(path: str) -> list[dict]:
    text = Path(path).read_text(encoding="utf-8-sig").strip()
    if not text:
        return []
    if text.startswith("["):
        return json.loads(text)
    return [json.loads(line) for line in text.splitlines() if line.strip()]


def print_run_report(client, run, quiet: bool) -> None:
    """RUN_REPORT (in the run's key-value store) says what happened to each input: ok, private,
    not_found, login_only, capped ... Optional: the export doesn't depend on it."""
    if quiet:
        return
    try:
        store_id = _field(run, "defaultKeyValueStoreId", "default_key_value_store_id")
        rec = client.key_value_store(store_id).get_record("RUN_REPORT")
        queries = ((rec or {}).get("value") or {}).get("queries")
        for q in queries if isinstance(queries, list) else []:
            note = f" ({q['note']})" if q.get("note") else ""
            rows = q.get("rows", 0)
            print(f"  {q.get('status', '?')}  {target_of(q.get('input', ''))}  {rows} row{'' if rows == 1 else 's'}{note}", file=sys.stderr)
    except Exception:
        pass


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="instaloader_map.py",
        description="Instaloader-style targets and options, run without an Instagram login. "
                    "Writes posts, profiles and comments to JSONL or CSV.",
        epilog=EPILOG,
        formatter_class=argparse.RawDescriptionHelpFormatter,
        allow_abbrev=False,
    )
    p.add_argument("targets", nargs="*", metavar="TARGET", help="profile, \"#hashtag\", %%location_id or Instagram URL; a post by shortcode: -- -SHORTCODE")
    w = p.add_argument_group("what to get")
    w.add_argument("-c", "--count", type=int, metavar="N", help="at most N rows per target (Instaloader: --count)")
    w.add_argument("--reels", action="store_true", help="also each profile's reels tab, with play counts (Instaloader: --reels)")
    w.add_argument("--no-posts", action="store_true", help="profile rows only: bio, links, followers, category ... (Instaloader: --no-posts)")
    w.add_argument("--profile-rows", action="store_true", help="add one row per profile, hashtag and location next to the posts")
    w.add_argument("--similar-accounts", action="store_true", help="add up to 50 related accounts to each profile row (needs --no-posts or --profile-rows)")
    w.add_argument("-C", "--comments", action="store_true", help="attach the newest comments to each post, inside the post's price (Instaloader: --comments)")
    w.add_argument("--comments-per-post", type=int, default=50, metavar="N", help="comments attached by --comments, 1-200 (default 50)")
    w.add_argument("--all-comments", action="store_true", help="instead of posts: every public comment of each post found, one row per comment")
    w.add_argument("--max-comments", type=int, default=100, metavar="N", help="with --all-comments: comments per post (default 100, up to about 4,800)")
    w.add_argument("--related-keywords", type=int, metavar="N", help="hashtags and keyword searches: also the top posts of up to N related keywords (0-100), past the ~60 per hashtag")
    w.add_argument("--video-views", action="store_true", help="add Instagram's 'views' metric next to plays (one small request per video)")
    w.add_argument("-G", "--geotags", action="store_true", help="accepted for Instaloader compatibility: every post row already has its location")
    f = p.add_argument_group("filters (they run on Apify before billing; posts they skip are free)")
    f.add_argument("--since", metavar="WHEN", help='only posts from a date (2026-09-01) or period ("30 days"); profiles stop paging there')
    f.add_argument("--min-likes", type=int, metavar="N", help="only posts with at least N likes")
    f.add_argument("--min-plays", type=int, metavar="N", help="only videos and reels with at least N plays")
    f.add_argument("--videos-only", action="store_true", help="skip photos and carousels")
    f.add_argument("--skip-pinned", action="store_true", help="skip posts pinned to the top of a profile")
    u = p.add_argument_group("only new posts (Instaloader: --fast-update)")
    u.add_argument("-F", "--fast-update", action="store_true", help="return only posts and comments earlier runs with the same --monitor-key did not return; profile rows get follower changes")
    u.add_argument("--monitor-key", default="instaloader", metavar="KEY", help="name of that memory, kept in your Apify account (default instaloader); one per schedule")
    o = p.add_argument_group("output")
    o.add_argument("--out", default="instagram.jsonl", metavar="PATH", help=".jsonl (every field, default instagram.jsonl) or .csv (flat columns; profiles, comments, places and keywords go to PATH-stem.<type>.csv)")
    o.add_argument("--max-total", type=int, default=1000, metavar="N", help="hard cap on rows in the run (default 1000)")
    o.add_argument("--max-charge", type=float, default=2.0, metavar="USD", help="hard cost cap for the run in USD, enforced by Apify (default 2)")
    o.add_argument("-q", "--quiet", action="store_true", help="print errors only")
    r = p.add_argument_group("re-export without a new run")
    r.add_argument("--dataset", metavar="ID", help="export the dataset of a run you already made")
    r.add_argument("--from", dest="from_file", metavar="FILE", help="convert a JSON/JSONL file of the Actor's rows or of this script's .jsonl (no token needed)")
    return p


def main() -> None:
    opts, late, notes = preprocess(sys.argv[1:])
    p = build_parser()
    args = p.parse_intermixed_args(opts)
    targets = list(args.targets) + [t for t in late if t]

    if not re.search(r"\.(jsonl|csv)$", args.out, re.I):
        p.error("--out must end in .jsonl or .csv")
    sources = sum(bool(x) for x in (targets, args.dataset, args.from_file))
    if sources == 0:
        p.error("give targets (nasa, \"#travel\", %213131048, -- -SHORTCODE), --dataset <id> or --from <file>")
    if sources > 1:
        p.error("use one of: targets, --dataset, --from")
    if args.no_posts and args.all_comments:
        p.error("--no-posts and --all-comments are different runs; pick one")
    if args.comments and (args.no_posts or args.all_comments):
        p.error("--comments attaches comments to posts; it doesn't combine with --no-posts or --all-comments")
    if args.similar_accounts and not (args.no_posts or args.profile_rows):
        p.error("--similar-accounts adds to profile rows: use it with --no-posts or --profile-rows")
    if args.related_keywords is not None and not 0 <= args.related_keywords <= 100:
        p.error("--related-keywords is 0 to 100")
    if not 1 <= args.comments_per_post <= 200:
        p.error("--comments-per-post is 1 to 200")

    start_urls: list[str] = []
    for t in targets:  # checked before anything runs: @profile, :feed ... stop here
        url = canonical(t)
        start_urls.append(url)
        name = target_of(url)
        if args.reels and is_profile_target(name):
            start_urls.append(f"{IG}{name}/reels/")
    start_urls = list(dict.fromkeys(start_urls))

    say = (lambda *a: None) if args.quiet else (lambda m: print(m, file=sys.stderr))
    for n in notes:
        say(n)
    if args.geotags:
        say("--geotags: nothing to add, every post row already has its location (name and coordinates when Instagram shows them).")

    mode = "profile" if args.no_posts else "comment" if args.all_comments else None
    if args.from_file:
        items = read_from_file(args.from_file)
    else:
        load_dotenv()
        token = os.environ.get("APIFY_TOKEN")
        if not token:
            sys.exit("Set APIFY_TOKEN (see .env.example), or use --from <file>")
        from apify_client import ApifyClient

        client = ApifyClient(token)
        dataset_id = args.dataset
        if not dataset_id:
            run_input: dict = {
                "startUrls": start_urls,
                "resultsType": "details" if args.no_posts else "comments" if args.all_comments else "posts",
                "maxItems": args.max_total,
            }
            if args.count is not None:
                run_input["maxItemsPerQuery"] = args.count
            if args.profile_rows:
                run_input["includeDetails"] = True
            if args.similar_accounts:
                run_input["includeRelatedProfiles"] = True
            if args.comments:
                run_input["commentsPerPost"] = args.comments_per_post
            if args.all_comments:
                run_input["maxComments"] = args.max_comments
            if args.related_keywords:
                run_input["expandRelatedKeywords"] = args.related_keywords
            if args.video_views:
                run_input["includeVideoViews"] = True
            if args.since:
                run_input["until"] = args.since
            if args.min_likes is not None:
                run_input["minLikes"] = args.min_likes
            if args.min_plays is not None:
                run_input["minPlays"] = args.min_plays
            if args.videos_only:
                run_input["videosOnly"] = True
            if args.skip_pinned:
                run_input["skipPinnedPosts"] = True
            if args.fast_update:
                run_input["monitor"] = True
                run_input["monitorKey"] = args.monitor_key
            say(f"Running {ACTOR} on {len(start_urls)} input(s) ...")
            # max_total_charge_usd caps what this run can cost you (pay-per-event Actors only).
            run = client.actor(ACTOR).call(run_input=run_input, max_total_charge_usd=Decimal(str(args.max_charge)))
            if run is None:
                sys.exit("The run did not finish")
            say(f"Run {_field(run, 'id', 'id')} finished: {_field(run, 'status', 'status')}")
            print_run_report(client, run, args.quiet)
            dataset_id = _field(run, "defaultDatasetId", "default_dataset_id")
        items = list(client.dataset(dataset_id).iterate_items())

    rows = [with_target(it) for it in items]
    files = write_out(args.out, rows, mode)
    counts = Counter(r.get("dataType") or "row" for r in rows)
    summary = ", ".join(f"{n} {k}{'' if n == 1 else 's'}" for k, n in counts.items()) or "no rows"
    say(f"Wrote {summary} to {', '.join(files)}")
    if targets and args.fast_update and not rows:
        say(f"Nothing new since the last run with --monitor-key {args.monitor_key}.")
    if targets and len(items) == 100 and args.max_total > 100:
        say("Exactly 100 rows: Free Apify plans stop at 100 rows per run; a paid plan lifts that.")


if __name__ == "__main__":
    main()
