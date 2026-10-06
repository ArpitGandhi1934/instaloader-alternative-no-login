#!/usr/bin/env node
// Instaloader-style Instagram scraping without a login.
//
// Give it the targets you would give Instaloader (a profile, "#hashtag", %location_id or
// -- -SHORTCODE) and the Instaloader options that have a logged-out equivalent. It runs the
// yugenox/instagram-scraper Actor on Apify and writes one row per post, profile or comment to
// JSONL or CSV. download-media.mjs then saves the photos and videos into one folder per target,
// the way Instaloader does.
//
// Instaloader options that only work with a logged-in account (--login, --stories, --highlights,
// --tagged, @profile, :feed, :saved ...) stop the script with an explanation instead of being
// dropped silently. Options about files and connections are ignored with a note.
//
// Same options and the same output files as instaloader_map.py. Requires Node 20.6+; APIFY_TOKEN
// in the environment (or in .env, loaded with `node --env-file=.env`) for new runs and --dataset.

import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';

const ACTOR = 'yugenox/instagram-scraper';
const IG = 'https://www.instagram.com/';

const HELP = `Instaloader-style targets and options, run without an Instagram login.
Writes posts, profiles and comments to JSONL or CSV.

Usage:
  node --env-file=.env instaloader-map.mjs [options] TARGET... [-- -SHORTCODE...]
  node --env-file=.env instaloader-map.mjs --dataset <datasetId> --out posts.csv
  node instaloader-map.mjs --from rows.jsonl --out posts.csv

Targets (Instaloader syntax)
  nasa                    a public profile's posts, newest first
  "#travel"               a hashtag's top posts (about 60; only hashtags with a public page)
  %213131048              a location's top and most recent posts (about 70)
  -- -DRvit9Ejgel         one post by shortcode, written as in Instaloader (the -- is optional here)
  any instagram.com URL   a profile, /reels/ tab, post, reel, hashtag, location or audio page
  +args.txt               read targets and options from a file, one per line

What to get
  -c, --count <n>         At most n rows per target (Instaloader: --count).
  --reels                 Also each profile's reels tab, with play counts (Instaloader: --reels).
  --no-posts              Profile rows only: bio, links, followers, category ... (Instaloader: --no-posts).
  --profile-rows          Add one row per profile, hashtag and location next to the posts.
  --similar-accounts      Add up to 50 related accounts to each profile row (needs --no-posts
                          or --profile-rows).
  -C, --comments          Attach the newest comments to each post, inside the post's price
                          (Instaloader: --comments).
  --comments-per-post <n> Comments attached by --comments, 1-200 (default 50).
  --all-comments          Instead of posts: every public comment of each post found, one row
                          per comment.
  --max-comments <n>      With --all-comments: comments per post (default 100, up to about 4,800).
  --related-keywords <n>  Hashtags and keyword searches: also the top posts of up to n related
                          keywords (0-100), past the ~60 per hashtag.
  --video-views           Add Instagram's 'views' metric next to plays (one small request per video).
  -G, --geotags           Accepted for Instaloader compatibility: every post row already has its location.

Filters (they run on Apify before billing; posts they skip are free)
  --since <when>          Only posts from a date (2026-09-01) or period ("30 days"); profiles
                          stop paging there.
  --min-likes <n>         Only posts with at least n likes.
  --min-plays <n>         Only videos and reels with at least n plays.
  --videos-only           Skip photos and carousels.
  --skip-pinned           Skip posts pinned to the top of a profile.

Only new posts (Instaloader: --fast-update)
  -F, --fast-update       Return only posts and comments earlier runs with the same --monitor-key
                          did not return; profile rows get follower changes.
  --monitor-key <key>     Name of that memory, kept in your Apify account (default instaloader);
                          one per schedule.

Output
  --out <path>            .jsonl (every field, default instagram.jsonl) or .csv (flat columns;
                          profiles, comments, places and keywords go to PATH-stem.<type>.csv).
  --max-total <n>         Hard cap on rows in the run (default 1000).
  --max-charge <usd>      Hard cost cap for the run, enforced by Apify (default 2).
  -q, --quiet             Print errors only.

Re-export without a new run
  --dataset <id>          Export the dataset of a run you already made.
  --from <file>           Convert a JSON/JSONL file of the Actor's rows or of this script's .jsonl
                          (no token needed).

  -h, --help              Show this help.

Not available without a login (the script stops and says why):
  --login --stories --highlights --tagged --post-filter --latest-stamps @profile :feed :stories :saved

Price: $1.90 per 1,000 rows (posts, profiles, places, keywords or comments) on Apify's Free and
Starter plans, $1.50 on Scale, $1.10 on Business (in force since 2026-09-26, checked 2026-10-06).
Comments attached with --comments are included. Free plans stop at 100 rows per run.

Examples:
  node --env-file=.env instaloader-map.mjs nasa --count 50 --out nasa.csv
  node --env-file=.env instaloader-map.mjs nasa natgeo --no-posts --out profiles.csv
  node --env-file=.env instaloader-map.mjs "#travel" %213131048 -- -DRvit9Ejgel
  node --env-file=.env instaloader-map.mjs nasa --fast-update --out "nasa-$(date +%F).jsonl"
  node download-media.mjs nasa.jsonl`;

// Instaloader options that need a logged-in Instagram account, or have no equivalent here.
// They stop the script with this explanation instead of being dropped silently.
const LOGIN = 'This script never signs in to Instagram. Public profiles, posts, hashtags, locations and '
    + 'comments need no account; private profiles stay out of reach.';
const STOP = {
    ...Object.fromEntries(['--login', '-l', '--password', '-p', '--sessionfile', '-f',
        '--load-cookies', '-b', '--cookiefile', '-B'].map((f) => [f, LOGIN])),
    ...Object.fromEntries(['--stories', '-s', '--storyitem-filter', '--storyitem-metadata-txt'].map((f) => [f,
        'Stories are only shown to logged-in Instagram accounts, so no logged-out tool can download them.'])),
    '--highlights': 'The contents of highlights are only shown to logged-in accounts. Highlight titles and '
        + 'covers are on profile rows (--profile-rows or --no-posts).',
    '--tagged': 'Posts a profile is tagged in are only shown to logged-in Instagram accounts.',
    ...Object.fromEntries(['--post-filter', '--only-if'].map((f) => [f,
        "Python filter expressions aren't supported. Use --min-likes, --min-plays, --since, "
        + '--videos-only or --skip-pinned (they run on Apify before billing) or filter the output '
        + 'afterwards. MAPPING.md translates the common expressions.'])),
    '--latest-stamps': 'Use --fast-update. What earlier runs saved is remembered in your Apify account '
        + '(under --monitor-key), not in a local stamps file.',
    '--igtv': "There is no separate IGTV input: video posts come with the profile's posts, and --reels "
        + "adds the profile's reels tab.",
};

// Instaloader options that don't apply to a data export. Ignored with a note: {flag: takes a value}.
const FILE_FLAGS = { '--no-pictures': false, '--no-videos': false, '-V': false, '--no-video-thumbnails': false,
    '--no-captions': false, '--no-metadata-json': false, '--no-compress-json': false,
    '--no-profile-pic': false, '--post-metadata-txt': true, '--slide': true,
    '--dirname-pattern': true, '--filename-pattern': true, '--title-pattern': true,
    '--sanitize-paths': false };
const NETWORK_FLAGS = { '--user-agent': true, '--max-connection-attempts': true, '--request-timeout': true,
    '--abort-on': true, '--no-iphone': false, '--resume-prefix': true, '--no-resume': false };

const POST_COLUMNS = [
    'target', 'code', 'url', 'created_at', 'type', 'caption', 'likes', 'comments', 'plays', 'views',
    'video_duration', 'owner', 'owner_followers', 'owner_verified', 'is_pinned', 'is_paid_partnership',
    'location', 'location_lat', 'location_lng', 'hashtags', 'mentions', 'tagged_users', 'coauthors',
    'audio_title', 'audio_artist', 'engagement_rate', 'carousel_count', 'image_url', 'video_url',
];
const PROFILE_COLUMNS = [
    'target', 'username', 'full_name', 'followers', 'following', 'biography', 'external_url', 'bio_links',
    'emails', 'phones', 'category', 'account_type', 'is_verified', 'is_private', 'highlights', 'has_reels',
    'threads_username', 'instagram_graph_id', 'follower_delta', 'related_profiles', 'profile_pic_url', 'url',
];
const COMMENT_COLUMNS = ['target', 'post_code', 'comment_id', 'username', 'text', 'likes', 'created_at', 'is_post_owner'];
const PLACE_COLUMNS = ['target', 'id', 'name', 'category', 'lat', 'lng', 'address', 'city', 'post_count', 'url'];
const KEYWORD_COLUMNS = ['target', 'keyword', 'has_public_posts', 'description', 'related_keywords', 'url'];
// dataType -> [CSV file suffix, columns]. The run's main type goes to --out itself.
const TABLES = {
    post: ['posts', POST_COLUMNS],
    comment: ['comments', COMMENT_COLUMNS],
    profile: ['profiles', PROFILE_COLUMNS],
    place: ['places', PLACE_COLUMNS],
    keyword: ['keywords', KEYWORD_COLUMNS],
};

function stop(msg) {
    console.error(`instaloader-map.mjs: ${msg}`);
    process.exit(2);
}

// This script's own options: name -> [key, kind]. kind: 'flag' | 'int' | 'num' | 'str'.
const OPTIONS = {
    '-c': ['count', 'int'], '--count': ['count', 'int'],
    '--reels': ['reels', 'flag'], '--no-posts': ['noPosts', 'flag'], '--profile-rows': ['profileRows', 'flag'],
    '--similar-accounts': ['similarAccounts', 'flag'],
    '-C': ['comments', 'flag'], '--comments': ['comments', 'flag'],
    '--comments-per-post': ['commentsPerPost', 'int'], '--all-comments': ['allComments', 'flag'],
    '--max-comments': ['maxComments', 'int'], '--related-keywords': ['relatedKeywords', 'int'],
    '--video-views': ['videoViews', 'flag'],
    '-G': ['geotags', 'flag'], '--geotags': ['geotags', 'flag'],
    '--since': ['since', 'str'], '--min-likes': ['minLikes', 'int'], '--min-plays': ['minPlays', 'int'],
    '--videos-only': ['videosOnly', 'flag'], '--skip-pinned': ['skipPinned', 'flag'],
    '-F': ['fastUpdate', 'flag'], '--fast-update': ['fastUpdate', 'flag'], '--monitor-key': ['monitorKey', 'str'],
    '--out': ['out', 'str'], '--max-total': ['maxTotal', 'int'], '--max-charge': ['maxCharge', 'num'],
    '-q': ['quiet', 'flag'], '--quiet': ['quiet', 'flag'],
    '--dataset': ['dataset', 'str'], '--from': ['from', 'str'],
    '-h': ['help', 'flag'], '--help': ['help', 'flag'],
};

// Instaloader compatibility, then this script's options. Expands +args.txt files, stops on options
// that need a login, drops file and network options with a note, and picks out Instaloader's
// -SHORTCODE post targets.
function parseArgs(argv) {
    const expanded = [];
    for (const a of argv) {
        if (a.startsWith('+') && a.length > 1) {
            const path = a.slice(1);
            if (!existsSync(path) || !statSync(path).isFile()) stop(`${a}: no such file`);
            expanded.push(...readFileSync(path, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
        } else expanded.push(a);
    }
    const o = { targets: [], notes: [], commentsPerPost: 50, maxComments: 100, monitorKey: 'instaloader',
        out: 'instagram.jsonl', maxTotal: 1000, maxCharge: 2 };
    const late = [];
    let after = false;
    for (let i = 0; i < expanded.length; i++) {
        const a = expanded[i];
        if (a === '--') { after = true; continue; }
        // -SHORTCODE: Instaloader wants it after --; a full 11-character code works anywhere here.
        if (new RegExp(`^-[A-Za-z0-9_][A-Za-z0-9_-]{${after ? 4 : 9},}$`).test(a)) { late.push(a); continue; }
        const eq = a.startsWith('--') ? a.indexOf('=') : -1;
        const flag = eq > 0 ? a.slice(0, eq) : a;
        if (flag in STOP) stop(`${flag}: ${STOP[flag]}`);
        if (flag in FILE_FLAGS || flag in NETWORK_FLAGS) {
            const takes = flag in FILE_FLAGS ? FILE_FLAGS[flag] : NETWORK_FLAGS[flag];
            o.notes.push(flag in FILE_FLAGS
                ? `${flag} ignored: it is about saving files; download_media.py does that (see its --help).`
                : `${flag} ignored: requests run on Apify, and retries and rate limits are the Actor's job.`);
            if (takes && eq < 0) i++;
            continue;
        }
        if (!(flag in OPTIONS)) {
            if (a.startsWith('-') && a.length > 1) throw new Error(`unrecognized arguments: ${a}`);
            o.targets.push(a);
            continue;
        }
        const [key, kind] = OPTIONS[flag];
        if (kind === 'flag') {
            if (eq > 0) throw new Error(`argument ${flag}: ignored explicit argument '${a.slice(eq + 1)}'`);
            o[key] = true;
            continue;
        }
        const v = eq > 0 ? a.slice(eq + 1) : expanded[++i];
        if (v === undefined) throw new Error(`argument ${flag}: expected one argument`);
        if (kind === 'int') {
            if (!/^-?\d+$/.test(v.trim())) throw new Error(`argument ${flag}: invalid int value: '${v}'`);
            o[key] = Number.parseInt(v, 10);
        } else if (kind === 'num') {
            const n = Number(v);
            if (v.trim() === '' || !Number.isFinite(n)) throw new Error(`argument ${flag}: invalid float value: '${v}'`);
            o[key] = n;
        } else o[key] = v;
    }
    o.targets.push(...late);
    if (o.help) return o;
    if (!/\.(jsonl|csv)$/i.test(o.out)) throw new Error('--out must end in .jsonl or .csv');
    const sources = [o.targets.length > 0, Boolean(o.dataset), Boolean(o.from)].filter(Boolean).length;
    if (sources === 0) throw new Error('give targets (nasa, "#travel", %213131048, -- -SHORTCODE), --dataset <id> or --from <file>');
    if (sources > 1) throw new Error('use one of: targets, --dataset, --from');
    if (o.noPosts && o.allComments) throw new Error('--no-posts and --all-comments are different runs; pick one');
    if (o.comments && (o.noPosts || o.allComments)) throw new Error("--comments attaches comments to posts; it doesn't combine with --no-posts or --all-comments");
    if (o.similarAccounts && !(o.noPosts || o.profileRows)) throw new Error('--similar-accounts adds to profile rows: use it with --no-posts or --profile-rows');
    if (o.relatedKeywords != null && !(o.relatedKeywords >= 0 && o.relatedKeywords <= 100)) throw new Error('--related-keywords is 0 to 100');
    if (!(o.commentsPerPost >= 1 && o.commentsPerPost <= 200)) throw new Error('--comments-per-post is 1 to 200');
    return o;
}

// Instaloader target -> an input the Actor understands (an Instagram URL).
function canonical(target) {
    const t = target.trim();
    if (t.startsWith('@')) {
        stop(`${t}: @profile means the accounts a profile follows in Instaloader. Follower and following `
            + 'lists are only shown to logged-in accounts. For the profile itself, drop the @.');
    }
    if (t.startsWith(':')) {
        stop(`${t}: your feed, stories and saved posts belong to a logged-in account; there is nothing `
            + 'to read without one.');
    }
    if (/\.json(\.xz)?$/i.test(t)) {
        stop(`${t}: re-downloading from Instaloader's metadata files isn't supported; pass the profile, `
            + 'hashtag or post instead.');
    }
    if (/^(https?:\/\/)?([a-z0-9-]+\.)?instagram\.com(\/|$)/i.test(t)) return /^https?:\/\//i.test(t) ? t : `https://${t}`;
    if (/^#[^\s#/]+$/.test(t)) return `${IG}explore/tags/${t.slice(1)}/`;
    if (/^%\d+$/.test(t)) return `${IG}explore/locations/${t.slice(1)}/`;
    if (/^-[A-Za-z0-9_-]{5,}$/.test(t)) return `${IG}p/${t.slice(1)}/`;
    if (/^\d{3,20}$/.test(t)) return t; // a numeric Instagram user id
    if (/^[A-Za-z0-9._]{1,30}$/.test(t)) return `${IG}${t}/`;
    return stop(`${t}: not a profile, "#hashtag", %location_id, -SHORTCODE or Instagram URL`);
}

const RESERVED = new Set(['explore', 'reels', 'reel', 'p', 'tv', 'stories', 'accounts', 'direct', 'popular', 'about',
    'legal', 'developer', 'web', 'share']);

const unquote = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

// The Actor input a row came from -> the Instaloader-style target (nasa, #travel, %id, -CODE).
function targetOf(inp) {
    const m = /^https?:\/\/(?:[a-z0-9-]+\.)?instagram\.com\/([^?#]*)/i.exec(inp || '');
    if (!m) return inp || '';
    const parts = m[1].split('/').filter(Boolean).map(unquote);
    if (parts.length >= 3 && parts[0] === 'explore' && parts[1] === 'tags') return `#${parts[2]}`;
    if (parts.length >= 3 && parts[0] === 'explore' && parts[1] === 'locations') return `%${parts[2]}`;
    if (parts.length >= 2 && ['p', 'reel', 'tv'].includes(parts[0])) return `-${parts[1]}`;
    if (parts.length >= 2 && parts[0] === 'reels' && parts[1] !== 'audio') return `-${parts[1]}`;
    if (parts.length && !RESERVED.has(parts[0].toLowerCase())) {
        if (parts.length >= 3 && ['p', 'reel'].includes(parts[1])) return `-${parts[2]}`;
        return parts[0];
    }
    return inp;
}

const isProfileTarget = (t) => /^[A-Za-z0-9._]{1,30}$/.test(t) && !/^\d+$/.test(t);

// Prefix every row with the Instaloader-style target it came from (Instaloader's folder name).
const withTarget = (r) => ({ target: r.target || targetOf(r.source?.input || ''), ...r });

const join = (values) => (values || []).filter((v) => v != null).map(String).join(', ');

function postRow(r) {
    const owner = r.owner || {}; const loc = r.location || {}; const video = r.video || {};
    const image = r.image || {}; const audio = r.audio || {};
    return {
        target: r.target, code: r.code, url: r.url, created_at: r.createdAt, type: r.mediaType,
        caption: r.caption, likes: r.likeCount, comments: r.commentCount, plays: video.playCount,
        views: video.viewCount, video_duration: video.duration, owner: owner.username,
        owner_followers: owner.followerCount, owner_verified: owner.isVerified, is_pinned: r.isPinned,
        is_paid_partnership: r.isPaidPartnership, location: loc.name, location_lat: loc.lat,
        location_lng: loc.lng, hashtags: join(r.hashtags), mentions: join(r.mentions),
        tagged_users: join((r.taggedUsers || []).filter(Boolean).map((u) => u.username)),
        coauthors: join((r.coowners || []).filter(Boolean).map((u) => u.username)),
        audio_title: audio.title, audio_artist: audio.artist, engagement_rate: r.engagementRate,
        carousel_count: r.carouselCount, image_url: image.url, video_url: video.url,
    };
}

function profileRow(r) {
    return {
        target: r.target, username: r.username, full_name: r.fullName, followers: r.followerCount,
        following: r.followingCount, biography: r.biography, external_url: r.externalUrl,
        bio_links: join((r.bioLinks || []).filter(Boolean).map((l) => l.url)), emails: join(r.emails),
        phones: join(r.phones), category: r.category, account_type: r.accountType, is_verified: r.isVerified,
        is_private: r.isPrivate, highlights: r.highlightCount, has_reels: r.hasReels,
        threads_username: r.threadsUsername, instagram_graph_id: r.instagramGraphId,
        follower_delta: r.changes?.followerDelta,
        related_profiles: join((r.relatedProfiles || []).filter(Boolean).map((p) => p.username)),
        profile_pic_url: r.hdProfilePicUrl || r.profilePicUrl, url: r.url,
    };
}

// A comment row, or one of a post's latestComments (then `post` is that post).
function commentRow(c, post) {
    const owner = c.owner || {};
    if (!post) {
        return { target: c.target, post_code: c.postCode, comment_id: c.id, username: owner.username, text: c.text,
            likes: c.likeCount, created_at: c.createdAt, is_post_owner: c.isPostOwner };
    }
    const postOwner = post.owner?.username;
    const mine = !owner.username || !postOwner ? null : owner.username === postOwner;
    return { target: post.target, post_code: post.code, comment_id: c.id, username: owner.username, text: c.text,
        likes: c.likeCount, created_at: c.createdAt, is_post_owner: mine };
}

const placeRow = (r) => ({ target: r.target, id: r.id, name: r.name, category: r.category, lat: r.lat, lng: r.lng,
    address: r.address, city: r.city, post_count: r.postCount, url: r.url });

const keywordRow = (r) => ({ target: r.target, keyword: r.keyword, has_public_posts: r.hasPublicPosts,
    description: r.description, related_keywords: join(r.relatedKeywords), url: r.url });

// CSV cell. Text that starts with = + - @, a tab or a carriage return gets a leading ' so Excel and
// Google Sheets show it as text instead of running it as a formula (captions are written by strangers).
function cell(v) {
    let s;
    if (v == null) s = '';
    else if (typeof v === 'boolean') s = v ? 'true' : 'false';
    else if (typeof v === 'number') s = String(v);
    else if (typeof v === 'object') s = JSON.stringify(v);
    else {
        s = String(v);
        if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    }
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function writeCsv(path, columns, rows) {
    // UTF-8 with a BOM, so Excel shows emoji and accents correctly when it opens the file.
    const lines = [columns.join(','), ...rows.map((r) => columns.map((c) => cell(r[c])).join(','))];
    writeFileSync(path, `﻿${lines.join('\r\n')}\r\n`);
}

function mainType(rows, mode) {
    if (mode) return mode;
    const kinds = new Set(rows.map((r) => r.dataType));
    return ['post', 'comment', 'profile', 'place', 'keyword'].find((k) => kinds.has(k)) || 'post';
}

// Write the rows; returns the files written. JSONL keeps every row as the Actor returned it.
function writeOut(out, rows, mode) {
    if (/\.jsonl$/i.test(out)) {
        writeFileSync(out, rows.map((r) => `${JSON.stringify(r)}\n`).join(''));
        return [out];
    }
    const tables = Object.fromEntries(Object.keys(TABLES).map((k) => [k, []]));
    const builders = { post: postRow, comment: (r) => commentRow(r), profile: profileRow, place: placeRow, keyword: keywordRow };
    for (const r of rows) {
        if (r.dataType in builders) tables[r.dataType].push(builders[r.dataType](r));
        if (r.dataType === 'post') for (const c of r.latestComments || []) tables.comment.push(commentRow(c, r));
    }
    const main = mainType(rows, mode);
    const written = [];
    const stem = out.slice(0, -4);
    for (const [kind, [suffix, columns]] of Object.entries(TABLES)) {
        if (kind !== main && !tables[kind].length) continue;
        const path = kind === main ? out : `${stem}.${suffix}.csv`;
        writeCsv(path, columns, tables[kind]);
        written.push(path);
    }
    return written;
}

function readFromFile(path) {
    const text = readFileSync(path, 'utf8').replace(/^﻿/, '').trim();
    if (!text) return [];
    if (text.startsWith('[')) return JSON.parse(text);
    return text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}

// RUN_REPORT (in the run's key-value store) says what happened to each input: ok, private,
// not_found, login_only, capped ... Optional: the export doesn't depend on it.
async function printRunReport(client, run, quiet) {
    if (quiet) return;
    try {
        const rec = await client.keyValueStore(run.defaultKeyValueStoreId).getRecord('RUN_REPORT');
        const queries = rec?.value?.queries;
        for (const q of Array.isArray(queries) ? queries : []) {
            const note = q.note ? ` (${q.note})` : '';
            console.error(`  ${q.status ?? '?'}  ${targetOf(q.input ?? '')}  ${q.rows ?? 0} row${q.rows === 1 ? '' : 's'}${note}`);
        }
    } catch { /* the report is a convenience */ }
}

async function main() {
    let o;
    try {
        o = parseArgs(process.argv.slice(2));
    } catch (e) {
        console.error(`instaloader-map.mjs: error: ${e.message} (see --help)`);
        process.exit(2);
    }
    if (o.help) { console.log(HELP); return; }

    const startUrls = [];
    for (const t of o.targets) { // checked before anything runs: @profile, :feed ... stop here
        const url = canonical(t);
        startUrls.push(url);
        const name = targetOf(url);
        if (o.reels && isProfileTarget(name)) startUrls.push(`${IG}${name}/reels/`);
    }
    const inputs = [...new Set(startUrls)];

    const say = o.quiet ? () => {} : (m) => console.error(m);
    for (const n of o.notes) say(n);
    if (o.geotags) say('--geotags: nothing to add, every post row already has its location (name and coordinates when Instagram shows them).');

    const mode = o.noPosts ? 'profile' : o.allComments ? 'comment' : null;
    let items;
    if (o.from) {
        items = readFromFile(o.from);
    } else {
        if (!process.env.APIFY_TOKEN) {
            console.error('Set APIFY_TOKEN (see .env.example, run with node --env-file=.env), or use --from <file>');
            process.exit(1);
        }
        const { ApifyClient } = await import('apify-client'); // loaded here so --help and --from work before npm install
        const client = new ApifyClient({ token: process.env.APIFY_TOKEN });
        let datasetId = o.dataset;
        if (!datasetId) {
            const input = {
                startUrls: inputs,
                resultsType: o.noPosts ? 'details' : o.allComments ? 'comments' : 'posts',
                maxItems: o.maxTotal,
            };
            if (o.count != null) input.maxItemsPerQuery = o.count;
            if (o.profileRows) input.includeDetails = true;
            if (o.similarAccounts) input.includeRelatedProfiles = true;
            if (o.comments) input.commentsPerPost = o.commentsPerPost;
            if (o.allComments) input.maxComments = o.maxComments;
            if (o.relatedKeywords) input.expandRelatedKeywords = o.relatedKeywords;
            if (o.videoViews) input.includeVideoViews = true;
            if (o.since) input.until = o.since;
            if (o.minLikes != null) input.minLikes = o.minLikes;
            if (o.minPlays != null) input.minPlays = o.minPlays;
            if (o.videosOnly) input.videosOnly = true;
            if (o.skipPinned) input.skipPinnedPosts = true;
            if (o.fastUpdate) { input.monitor = true; input.monitorKey = o.monitorKey; }
            say(`Running ${ACTOR} on ${inputs.length} input(s) ...`);
            // maxTotalChargeUsd caps what this run can cost you (pay-per-event Actors only).
            const run = await client.actor(ACTOR).call(input, { maxTotalChargeUsd: o.maxCharge });
            say(`Run ${run.id} finished: ${run.status}`);
            await printRunReport(client, run, o.quiet);
            datasetId = run.defaultDatasetId;
        }
        items = [];
        for await (const it of client.dataset(datasetId).listItems()) items.push(it);
    }

    const rows = items.map(withTarget);
    const files = writeOut(o.out, rows, mode);
    const counts = new Map();
    for (const r of rows) counts.set(r.dataType || 'row', (counts.get(r.dataType || 'row') || 0) + 1);
    const summary = [...counts].map(([k, n]) => `${n} ${k}${n === 1 ? '' : 's'}`).join(', ') || 'no rows';
    say(`Wrote ${summary} to ${files.join(', ')}`);
    if (o.targets.length && o.fastUpdate && !rows.length) say(`Nothing new since the last run with --monitor-key ${o.monitorKey}.`);
    if (o.targets.length && items.length === 100 && o.maxTotal > 100) say('Exactly 100 rows: Free Apify plans stop at 100 rows per run; a paid plan lifts that.');
}

main().catch((e) => {
    console.error(e?.message || e);
    process.exit(1);
});
