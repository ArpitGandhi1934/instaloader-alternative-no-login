# Instaloader Alternative Without Login (Python + Node.js)

[![Instagram Scraper on Apify][badge]][store]

**Run your Instaloader jobs with no Instagram login.** Instaloader's own documentation marks hashtags, locations, comments and geotags as "requires login", and its troubleshooting page warns that anonymous access from cloud, VPN and proxy IP addresses may face significantly stricter limits. This repo takes the targets you would give Instaloader (`nasa`, `"#travel"`, `%213131048`, `-- -SHORTCODE`), runs the [Instagram Scraper][store] Actor on Apify with no Instagram account, and writes one row per post, profile or comment to JSONL or CSV. `download_media.py` then saves the photos and videos into one folder per target with Instaloader's `{date_utc}_UTC` file names.

You need an Apify API token, not an Instagram account, cookies or a Graph API app. Follower lists, stories and private profiles are out of reach without a login, here and in every other no-login tool; the [full list](#what-you-cant-get-without-a-login) is below.

Guide: [Instagram scraping without login](https://yugenox-data.vercel.app/instagram/scraper-no-login). Every Instaloader option and Python call, mapped: [MAPPING.md](MAPPING.md).

## What you get

Real output from one run on 2026-10-06, `python instaloader_map.py nasa "#travel" %213131048 --count 3 --profile-rows --comments --comments-per-post 3 -- -DdPsDCWRT-u`:

| target | code | type | likes | comments | plays | owner | location |
|---|---|---|---:|---:|---:|---|---|
| nasa | DdHyaYAifb6 | carousel | 121,327 | 1,050 | | nasa | |
| nasa | DdWyDLcGiqo | carousel | 756,630 | 1,832 | | astro_jessica | |
| -DdPsDCWRT-u | DdPsDCWRT-u | video | 60,711 | 262 | | nasaadmin | |
| #travel | DTfS7SMEk8B | video | 3,293,009 | 6,248 | 30,203,657 | life_samour_style | Switzerland, Schweiz |
| #travel | DSI7LxnEbrb | video | 17,906,746 | 15,133 | 147,320,368 | landon_paschall | |
| %213131048 | REDACTED | carousel | 0 | 0 | | user_1 | Kant Kino Berlin |
| %213131048 | REDACTED | carousel | 1 | 0 | | user_7 | Blankenfelder Reiterverein e.V. |

Plus one row per target from `--profile-rows`: the `nasa` profile (104,275,379 followers, following 90, business account, 5 highlights, its bio links), the `#travel` topic (Instagram's description and related keywords) and the Berlin place (category Region, 34,090,112 posts, coordinates). Posts also carry up to 3 of their newest comments.

The run saved 10 rows and was billed 10 results, $0.019 at the Free-plan price; the attached comments cost nothing extra. Files in [`samples/`](samples): every field as [JSONL](samples/sample.jsonl), and the same rows as CSV ([posts](samples/sample.csv), [comments](samples/sample.comments.csv), [profiles](samples/sample.profiles.csv), [places](samples/sample.places.csv), [keywords](samples/sample.keywords.csv)). Accounts that are not verified are pseudonymized (`user_1` ...) and captions and comments are cut to one sentence ([how](samples/redact.jq)).

Two things the sample shows: with `--profile-rows`, `--count 3` counts the profile row too (`nasa` gave 1 profile + 2 posts), and the reel fetched by its shortcode came back without a play count while the hashtag reels had one.

## Quick start

1. Create a free Apify account and copy your API token ([sign up][signup], then Console > Settings > API & Integrations).
2. `cp .env.example .env` and paste the token after `APIFY_TOKEN=`.

**Python** (3.10 or newer; `download_media.py` needs only the standard library):

```bash
pip install -r requirements.txt
python instaloader_map.py nasa --count 50 --out nasa.jsonl
python download_media.py nasa.jsonl
```

**Node.js** (20.6 or newer):

```bash
npm install
node --env-file=.env instaloader-map.mjs nasa --count 50 --out nasa.jsonl
node download-media.mjs nasa.jsonl
```

Both languages take the same options and write byte-identical files. `--help` lists everything.

## Instaloader commands, translated

| Job | Instaloader | Login in Instaloader | Here |
|---|---|---|---|
| A profile's posts | `instaloader nasa` | No | `python instaloader_map.py nasa --out nasa.jsonl`, then `python download_media.py nasa.jsonl` |
| Profile data only | `instaloader --no-posts nasa` | No | `python instaloader_map.py nasa natgeo --no-posts --out profiles.csv` |
| A profile's reels | `instaloader --reels nasa` | No | `python instaloader_map.py nasa --reels` |
| One post | `instaloader -- -DRvit9Ejgel` | No | `python instaloader_map.py -- -DRvit9Ejgel` |
| Hashtag posts | `instaloader "#travel"` | **Yes** | `python instaloader_map.py "#travel"` (top posts, about 60; `--related-keywords 10` for more) |
| Location posts | `instaloader %213131048` | **Yes** | `python instaloader_map.py %213131048` (top and most recent, about 70) |
| Comments | `instaloader --comments nasa` | **Yes** | `python instaloader_map.py nasa --comments` (newest 50 per post, included in the price) or `--all-comments` (every public comment, one row each) |
| Only new posts | `instaloader --fast-update nasa` | No | `python instaloader_map.py nasa --fast-update` |
| Filter posts | `instaloader --post-filter="likes>1000" nasa` | No | `python instaloader_map.py nasa --min-likes 1001` (also `--since`, `--min-plays`, `--videos-only`, `--skip-pinned`) |
| Similar accounts | `profile.get_similar_accounts()` | **Yes** | `python instaloader_map.py nasa --no-posts --similar-accounts` |
| Stories, highlights, tagged posts, followers | `--stories`, `--highlights`, `--tagged`, `@profile` | Yes (`--tagged`: no) | Not available (the script stops and says why) |

Options that need a login stop the script with a one-line explanation. Options about files (`--no-videos`, `--dirname-pattern` ...) belong to `download_media.py`, and connection options (`--user-agent`, `--max-connection-attempts` ...) are ignored with a note, so a pasted Instaloader command still runs. [MAPPING.md](MAPPING.md) has every option, the `--post-filter` translations and the Python module (`Profile`, `Post`, `Hashtag`) mapped to row fields.

## Recipes

**Instagram profile scraper in Python.** `python instaloader_map.py nasa natgeo esa --no-posts --out profiles.csv` writes one row per profile: followers, following, bio, every bio link, category, business or creator account, highlight count, Threads username, and emails or phone numbers written in the bio. Add `--similar-accounts` for up to 50 related accounts per profile, when Instagram suggests any.

**Instagram post scraper in Python.** `python instaloader_map.py nasa --since 2026-09-01 --skip-pinned --out nasa.csv` writes every post since September 1 with likes, comments, plays (reels), caption, hashtags, mentions, tagged and co-author accounts, location and audio. Profiles stop paging at the first older post, so older posts are never read or billed.

**Download a profile like Instaloader.** `python download_media.py nasa.jsonl` creates `nasa/2026-09-10_21-20-24_UTC_1.jpg` ... for carousels, `.mp4` plus a `.jpg` cover for videos, and the caption as `.txt`. It skips files that already exist and takes Instaloader's `--no-videos`, `--no-pictures`, `--no-video-thumbnails`, `--no-captions`, `--dirname-pattern` and `--filename-pattern`. Download soon after the run: Instagram's media links are signed and expire. In the sample run they expired between 32 hours and 4.5 days later.

**Every comment on a post.** `python instaloader_map.py -- -DdPsDCWRT-u --all-comments --max-comments 2000 --max-total 2000 --max-charge 4 --out comments.csv` writes one row per public comment (text, author, likes, date), up to about 4,800 per post. Raise `--max-total` (default 1,000 rows) and `--max-charge` (default $2) with `--max-comments`, or the run stops at whichever cap it reaches first; on a Free Apify plan it stops at 100. For most-liked-first sorting and keyword filters, use [instagram-comments-export](https://github.com/ArpitGandhi1934/instagram-comments-export).

**Run it every day, like `--fast-update`.** `--fast-update` returns only posts that earlier runs with the same `--monitor-key` didn't return, and doesn't bill the repeats. Write each day to its own file:

```bash
# crontab -e   (every morning at 7)
0 7 * * * cd /path/to/instaloader-alternative-no-login && python3 instaloader_map.py +watchlist.txt --fast-update --monitor-key watchlist --out "new-$(date +\%F).jsonl" && python3 download_media.py "new-$(date +\%F).jsonl"
```

`watchlist.txt` holds one target per line, the same `+args.txt` format Instaloader reads (start from `watchlist.example.txt`). The memory of what was already delivered lives in a key-value store in your own Apify account (`instagram-monitor-watchlist`), so the schedule can move between machines. To run on Apify instead of your machine, save the input as a task in Apify Console and attach a daily schedule.

## Why this works without a login

Instagram shows logged-out visitors a public profile's posts, a popular hashtag's top posts, a place's top and recent posts, and every public comment on a post. The Actor reads those public pages on Apify's servers, so there is no Instagram account to challenge or restrict, and your own IP address isn't the one sending requests.

Instaloader's [troubleshooting page][il-trouble] (read 2026-10-06) covers 429 "Too Many Requests" errors, says services with "promiscuous IP addresses, such as cloud, VPN and public proxy services, might be subject to significantly stricter limits for anonymous access", and describes login errors and checkpoint challenges. Here, each input ends with a status in the run's `RUN_REPORT` (`ok`, `private`, `not_found`, `login_only`, `capped`, `partial`, `blocked` ...), which the script prints, and you pay only for rows saved.

## What you can't get without a login

These are only shown to logged-in Instagram accounts, so neither this repo nor any other no-login tool returns them:

- **Follower and following lists.** Follower and following counts, yes; the list of who follows an account, no.
- Stories, and the contents of highlights (highlight titles and covers are on profile rows).
- Posts a profile is tagged in.
- Who liked a post, and replies to comments.
- Private profiles, your feed and your saved posts.
- A profile's total post count (`postCount` is `null`).
- Hashtags without a public page (for example `#food`): the run report says `login_only` and nothing is charged.

If you need those for your own account or for private accounts that accepted you, Instaloader with your login is the right tool. For insights on an account you own, Meta's Instagram Graph API is the official route.

## Price

Pay per row saved (a post, profile, place, hashtag or comment row), no subscription and no start fee. Prices from the Actor's pricing in the Apify API on 2026-10-06, in force since 2026-09-26; the [Store page][store] always shows the current ones.

| Rows | Free and Starter plans | Scale plan | Business plan and up |
|---:|---:|---:|---:|
| 1,000 | $1.90 | $1.50 | $1.10 |
| 10,000 | $19.00 | $15.00 | $11.00 |
| 100,000 | $190.00 | $150.00 | $110.00 |

What common Instaloader jobs cost on the Free and Starter plans (Scale / Business in brackets):

- A profile's latest 500 posts: $0.95 ($0.75 / $0.55)
- 100 profiles with `--no-posts`: $0.19 ($0.15 / $0.11)
- A hashtag's top posts (about 60): $0.11 ($0.09 / $0.07)
- Every comment on a post with 2,000 public comments: $3.80 ($3.00 / $2.20)
- 20 profiles checked daily with `--fast-update`, about one new post each per day (600 rows a month): $1.14 a month ($0.90 / $0.66)
- `--comments` adds nothing: attached comments are included in the post's price.

**Free Apify plans are limited to 100 rows per run**, paid from the plan's monthly usage credit; the bigger jobs above need a paid plan. Rows your filters skip, inputs that return nothing and posts `--fast-update` already delivered are free. `--max-charge` (default $2) is a hard cap Apify enforces for each run.

Instaloader itself is free and open source. Other Instagram Actors on the Apify Store, per 1,000 posts, from the Apify API on 2026-10-06:

| Actor | Free | Starter | Scale | Business |
|---|---:|---:|---:|---:|
| **yugenox/instagram-scraper** (this repo) | $1.90 | $1.90 | $1.50 | $1.10 |
| apify/instagram-scraper | $2.70 | $2.30 | $1.90 | $1.50 |
| apidojo/instagram-scraper | $0.50 | $0.49 | $0.48 | $0.47 |

apidojo's Actor costs the least per post. This repo calls yugenox/instagram-scraper because its inputs cover the Instaloader jobs above in one Actor (profiles, reels tabs, hashtags, locations, single posts, all comments, only-new-posts memory) and attached comments come with the post's price.

## Output

`.jsonl` (the default) keeps every field the Actor returns, one row per line, with a `target` field in front naming the Instaloader target the row came from (`nasa`, `#travel`, `%213131048`, `-DdPsDCWRT-u`). `--from rows.jsonl --out rows.csv` converts it later without a token.

`.csv` writes flat columns, UTF-8 with a BOM so Excel shows emoji correctly. Cells that start with `=`, `+`, `-` or `@` get a leading `'` so a spreadsheet shows them as text instead of running them as formulas (that's why a post target shows as `'-DdPsDCWRT-u` in the CSV).

| File | Columns |
|---|---|
| `out.csv` (posts) | target, code, url, created_at, type, caption, likes, comments, plays, views, video_duration, owner, owner_followers, owner_verified, is_pinned, is_paid_partnership, location, location_lat, location_lng, hashtags, mentions, tagged_users, coauthors, audio_title, audio_artist, engagement_rate, carousel_count, image_url, video_url |
| `out.comments.csv` | target, post_code, comment_id, username, text, likes, created_at, is_post_owner |
| `out.profiles.csv` | target, username, full_name, followers, following, biography, external_url, bio_links, emails, phones, category, account_type, is_verified, is_private, highlights, has_reels, threads_username, instagram_graph_id, follower_delta, related_profiles, profile_pic_url, url |
| `out.places.csv` | target, id, name, category, lat, lng, address, city, post_count, url |
| `out.keywords.csv` | target, keyword, has_public_posts, description, related_keywords, url |

With `--no-posts` the profiles go to `out.csv`, and with `--all-comments` the comments do. `--dataset <id>` exports a run you already made in Apify Console.

## Limits

- **Public data only.** Nothing here signs in to Instagram; private accounts are never accessed.
- Hashtags return their top posts (about 60, for hashtags with a public page), locations about 70 posts, audio pages their first 12 reels.
- Comments come without replies. Instagram's comment count includes replies and hidden comments, so expect fewer rows than the count.
- Some videos come without a play count: in the sample, the reel fetched by its shortcode had none while the hashtag reels had one. `--reels` adds a profile's reels tab, which carries play counts.
- Media links in the rows expire within days (see Recipes).
- Free Apify plans stop at 100 rows per run.

## Privacy

Posts, profiles and comments are public, but usernames, bios, faces and comment text are personal data under PIPEDA (Canada), GDPR (EU) and similar laws. You are responsible for having a lawful reason to collect them, for how long you keep them and for what you do with them. Downloading media for your own analysis is not the same as republishing it, which needs the owner's permission. Don't send commercial messages to the people you find without consent (CASL, CAN-SPAM). See [Is web scraping legal?][legal]

## More

- Guides on [yugenox-data.vercel.app](https://yugenox-data.vercel.app): [Instagram scraping without login](https://yugenox-data.vercel.app/instagram/scraper-no-login), [Instagram Graph API alternative for public data](https://yugenox-data.vercel.app/instagram/graph-api-alternative), [Instagram profile data to CSV](https://yugenox-data.vercel.app/instagram/profile-data-to-csv), [influencer vetting](https://yugenox-data.vercel.app/instagram/influencer-vetting), [export Instagram comments to Excel](https://yugenox-data.vercel.app/instagram/export-comments), [use it in ChatGPT, Claude and Cursor](https://yugenox-data.vercel.app/ai/use-in-chatgpt-claude-cursor), [pricing calculator](https://yugenox-data.vercel.app/pricing-calculator)
- Examples for every input of the Actor (Python, Node.js, curl, Apify CLI, Google Sheets): [youtube-instagram-scraper-examples](https://github.com/ArpitGandhi1934/youtube-instagram-scraper-examples)
- Instagram Reels to text in bulk: [instagram-reels-transcript-bulk](https://github.com/ArpitGandhi1934/instagram-reels-transcript-bulk)
- Comments with most-liked sorting and keyword filters: [instagram-comments-export](https://github.com/ArpitGandhi1934/instagram-comments-export) ([Instagram Comments Scraper][store-comments])
- From Claude, ChatGPT or Cursor: Apify's hosted MCP server can be pinned to this Actor, `https://mcp.apify.com/?tools=fetch-actor-details,yugenox/instagram-scraper`. You sign in to your own Apify account with OAuth; never put a token in the URL. Setup per client: [yugenox-mcp](https://github.com/ArpitGandhi1934/yugenox-mcp).
- The Actor itself, with its input form, output table and reviews: [Instagram Scraper on Apify][store]. Other ways to call it (Python and JS clients, OpenAPI, MCP) are on its [API page][api].

## Samples, testing and legal

- The sample comes from one run on 2026-10-06 (Actor build 0.2.15) through `instaloader_map.py`; the CSVs were then written from the pseudonymized JSONL with `--from`. Input names checked against the Actor's live input schema the same day. Instaloader facts are from its documentation for version 4.15.3, read on 2026-10-06.
- Disclosure: the Instagram Scraper Actor these scripts call is built by the author of this repo.
- Not affiliated with or endorsed by Instagram or Meta, or by the Instaloader project. Instagram is a trademark of Meta Platforms, Inc.
- MIT licensed. Made by Yugenox Corporation.

[il-trouble]: https://instaloader.github.io/troubleshooting.html

<!-- All apify.com links for this README live below. When the Apify affiliate id exists, append ?fpr=<id> to these URLs only. -->
[store]: https://apify.com/yugenox/instagram-scraper
[api]: https://apify.com/yugenox/instagram-scraper/api
[badge]: https://apify.com/actor-badge?actor=yugenox/instagram-scraper
[store-comments]: https://apify.com/yugenox/instagram-comments-scraper
[signup]: https://console.apify.com/sign-up
[legal]: https://blog.apify.com/is-web-scraping-legal/
