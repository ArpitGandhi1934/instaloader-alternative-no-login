#!/usr/bin/env node
// Download the photos and videos of rows written by instaloader-map.mjs, Instaloader-style.
//
// One folder per target (nasa/, #travel/, %213131048/), files named {date_utc}_UTC like
// Instaloader's: 2026-09-10_21-20-24_UTC_1.jpg for the first slide of a carousel, .mp4 for
// videos, and the caption in a .txt next to them. Files that already exist are skipped, so a
// re-run only fetches what is missing.
//
// Instagram's media URLs are signed and expire, usually within a few days of the run, so download
// soon after scraping. Saving media for your own analysis is one thing; republishing it needs the
// owner's permission.
//
// Same options and the same files as download_media.py. No token, no npm packages. Node 20.6+.

import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const HELP = `Download the photos and videos of rows written by instaloader-map.mjs, Instaloader-style.

Usage: node download-media.mjs ROWS.jsonl [ROWS2.jsonl ...] [options]

  --dest <dir>                Where the target folders go (default: here).
  --dirname-pattern <p>       Folder per post: {target}, {profile} (default {target}).
  --filename-pattern <p>      File name: {date_utc}, {shortcode}, {profile}, {target}
                              (default {date_utc}_UTC).
  --no-pictures               Skip photos (implies --no-video-thumbnails).
  -V, --no-videos             Skip videos.
  --no-video-thumbnails       Skip the cover image of videos.
  --no-captions               Don't write the caption .txt files.
  --no-profile-pic            Skip profile pictures of profile rows.
  --timeout <s>               Seconds per file (default 60).
  -h, --help                  Show this help.

Example: node download-media.mjs nasa.jsonl --dest media --no-videos`;

const EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.mp4', '.mov']);

function parseArgs(argv) {
    const o = { files: [], dest: '.', dirnamePattern: '{target}', filenamePattern: '{date_utc}_UTC', timeout: 60 };
    const flags = { '--no-pictures': 'noPictures', '-V': 'noVideos', '--no-videos': 'noVideos',
        '--no-video-thumbnails': 'noVideoThumbnails', '--no-captions': 'noCaptions', '--no-profile-pic': 'noProfilePic',
        '-h': 'help', '--help': 'help' };
    const values = { '--dest': 'dest', '--dirname-pattern': 'dirnamePattern', '--filename-pattern': 'filenamePattern',
        '--timeout': 'timeout' };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const eq = a.startsWith('--') ? a.indexOf('=') : -1;
        const flag = eq > 0 ? a.slice(0, eq) : a;
        if (flag in flags) o[flags[flag]] = true;
        else if (flag in values) {
            const v = eq > 0 ? a.slice(eq + 1) : argv[++i];
            if (v === undefined) throw new Error(`argument ${flag}: expected one argument`);
            o[values[flag]] = flag === '--timeout' ? Number(v) : v;
        } else if (a.startsWith('-') && a.length > 1) throw new Error(`unrecognized arguments: ${a}`);
        else o.files.push(a);
    }
    if (!o.help && !o.files.length) throw new Error('give one or more .jsonl files from instaloader-map.mjs');
    return o;
}

function readRows(path) {
    const text = readFileSync(path, 'utf8').replace(/^﻿/, '').trim();
    if (!text) return [];
    if (text.startsWith('[')) return JSON.parse(text);
    return text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}

// A file or folder name that works on Windows, macOS and Linux.
function safe(part) {
    const s = String(part || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim().replace(/\.+$/, '');
    return s || '_';
}

// 2026-09-10T21:20:24.000Z -> 2026-09-10_21-20-24 (Instaloader's {date_utc}).
function dateUtc(createdAt) {
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(createdAt || '');
    return m ? `${m[1]}_${m[2]}-${m[3]}-${m[4]}` : 'unknown-date';
}

function extOf(url, fallback) {
    let ext = '';
    try { ext = extname(new URL(url).pathname).toLowerCase(); } catch { /* not a URL */ }
    return EXTENSIONS.has(ext) ? ext : fallback;
}

function fill(pattern, row, profile) {
    const target = row.target || profile;
    return pattern.replaceAll('{target}', safe(target)).replaceAll('{profile}', safe(profile))
        .replaceAll('{shortcode}', safe(row.code || '')).replaceAll('{date_utc}', dateUtc(row.createdAt));
}

// [url, path without extension, default extension] for every file of one row.
function jobsFor(row, o) {
    const out = [];
    const kind = row.dataType;
    if (kind === 'profile') {
        const pic = row.hdProfilePicUrl || row.profilePicUrl;
        const user = row.username || 'profile';
        if (pic && !o.noProfilePic) out.push([pic, `${fill(o.dirnamePattern, row, user)}/${safe(user)}_profile_pic`, '.jpg']);
        return out;
    }
    if ((kind != null && kind !== 'post') || !row.code) return out;
    const profile = row.owner?.username || 'unknown';
    const base = `${fill(o.dirnamePattern, row, profile)}/${fill(o.filenamePattern, row, profile)}`;
    const noThumbs = o.noVideoThumbnails || o.noPictures;
    const slides = row.carousel || [];
    if (slides.length) {
        slides.forEach((s, idx) => {
            const i = idx + 1;
            if (s.type === 'video' && s.videoUrl) {
                if (!o.noVideos) out.push([s.videoUrl, `${base}_${i}`, '.mp4']);
                if (s.url && !noThumbs) out.push([s.url, `${base}_${i}`, '.jpg']);
            } else if (s.url && !o.noPictures) out.push([s.url, `${base}_${i}`, '.jpg']);
        });
    } else {
        const video = row.video || {};
        const image = row.image?.url;
        if (video.url) {
            if (!o.noVideos) out.push([video.url, base, '.mp4']);
            if (image && !noThumbs) out.push([image, base, '.jpg']);
        } else if (image && !o.noPictures) out.push([image, base, '.jpg']);
    }
    return out;
}

async function fetchTo(url, path, timeoutSecs) {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (download_media.py)' },
        signal: AbortSignal.timeout(timeoutSecs * 1000) });
    if (!res.ok) {
        const err = new Error(`HTTP ${res.status}`);
        err.status = res.status;
        throw err;
    }
    const tmp = `${path}.part`;
    await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
    renameSync(tmp, path);
}

async function main() {
    let o;
    try {
        o = parseArgs(process.argv.slice(2));
    } catch (e) {
        console.error(`download-media.mjs: error: ${e.message} (see --help)`);
        process.exit(2);
    }
    if (o.help) { console.log(HELP); return; }

    const rows = o.files.flatMap(readRows);
    let got = 0; let skipped = 0; let expired = 0; let failed = 0;
    for (const row of rows) {
        const jobs = jobsFor(row, o);
        if ((row.dataType == null || row.dataType === 'post') && row.code && row.caption && !o.noCaptions) {
            const profile = row.owner?.username || 'unknown';
            const txt = join(o.dest, `${fill(o.dirnamePattern, row, profile)}/${fill(o.filenamePattern, row, profile)}.txt`);
            if (!existsSync(txt)) {
                mkdirSync(dirname(txt), { recursive: true });
                writeFileSync(txt, `${row.caption}\n`);
            }
        }
        for (const [url, stem, fallback] of jobs) {
            const path = join(o.dest, `${stem}${extOf(url, fallback)}`);
            if (!url.startsWith('http') || url.includes(' ')) { skipped++; continue; } // sample placeholders
            if (existsSync(path) && statSync(path).size > 0) { skipped++; continue; }
            mkdirSync(dirname(path), { recursive: true });
            try {
                await fetchTo(url, path, o.timeout);
                got++;
                console.error(`  ${path}`);
            } catch (e) {
                if (e.status === 403 || e.status === 410) expired++;
                else {
                    failed++;
                    console.error(`  failed (${e.status ?? e.name}): ${path}`);
                }
            }
        }
    }
    console.error(`Downloaded ${got} files, skipped ${skipped} (already there or no real URL), `
        + `${expired} expired links, ${failed} failed.`);
    if (expired) {
        console.error("Expired links: Instagram's media URLs are signed and stop working after a few days. "
            + 'Run instaloader-map.mjs again and download right away.');
    }
}

main().catch((e) => {
    console.error(e?.message || e);
    process.exit(1);
});
