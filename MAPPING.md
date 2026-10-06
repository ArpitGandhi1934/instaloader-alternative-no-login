# Instaloader to no-login mapping

Every Instaloader target, command-line option and common Python call, and what it becomes in this repo. "Login in Instaloader" is what [Instaloader's own documentation][il-cli] says (version 4.15.3, read on 2026-10-06). "Here" is `instaloader_map.py` / `instaloader-map.mjs` calling the [Instagram Scraper][store] Actor (build 0.2.15, input schema checked the same day).

Instaloader options that can't work without an Instagram account stop the script with a one-line explanation, so a pasted Instaloader command never fails silently. Options about files and connections are ignored with a note.

## Targets

| Instaloader target | Login in Instaloader | Here | Actor input |
|---|---|---|---|
| `profile` | No | `nasa`: the profile's posts, newest first, as deep as the profile goes | `startUrls: ["https://www.instagram.com/nasa/"]` |
| `"#hashtag"` | **Yes** | `"#travel"`: the hashtag's top posts, about 60, for hashtags that have a public page | `https://www.instagram.com/explore/tags/travel/` |
| `%location id` | **Yes** | `%213131048`: the place's top and most recent posts, about 70 | `https://www.instagram.com/explore/locations/213131048/` |
| `-- -SHORTCODE` | No | Same (`-- -DRvit9Ejgel`); an 11-character code also works without the `--` | `https://www.instagram.com/p/DRvit9Ejgel/` |
| `+args.txt` | No | Same: one argument per line | |
| `@profile` (the accounts a profile follows) | **Yes** | Not available: following and follower lists are only shown to logged-in accounts. Stops with an explanation | |
| `:feed`, `:stories`, `:saved` | **Yes** | Not available: they belong to a logged-in account | |
| `filename.json[.xz]` | No | Not supported: pass the profile, hashtag or post instead | |
| (no Instaloader equivalent) | | Any Instagram URL: a profile's `/reels/` tab, a keyword search (`/explore/search/keyword/?q=toronto`), an audio page (`/reels/audio/<id>/`, first 12 reels) | as given |

## What to download of each post and profile

| Instaloader option | Login in Instaloader | Here |
|---|---|---|
| `--comments`, `-C` | **Yes** | `--comments` / `-C`: the newest 50 comments of each post (`--comments-per-post`, up to 200), inside the post's price. In CSV they go to `<out>.comments.csv`. For every public comment instead (up to about 4,800 per post, one billed row each): `--all-comments`. Replies are login-only, so they're not included |
| `--geotags`, `-G` | **Yes** | Accepted; nothing to add. Every post row has `location` (`id`, `name`, `slug`, `lat`, `lng`) when the post has one |
| `--reels` | No | `--reels`: adds each profile's reels tab, which carries play counts |
| `--no-posts` | No | `--no-posts`: one row per profile (bio, links, followers, following, category, account type, highlight titles, emails and phones written in the bio) |
| `--stories`, `-s` | **Yes** | Not available. Stops with an explanation |
| `--highlights` | **Yes** | Not available. Highlight titles and covers are on profile rows |
| `--tagged` | No | Not available: Instagram shows a profile's tagged posts only to logged-in accounts |
| `--igtv` | No | Stops: there is no separate IGTV input; video posts come with the profile's posts |
| `--no-profile-pic` | No | `download_media.py --no-profile-pic` |
| `--no-pictures`, `--no-videos` / `-V`, `--no-video-thumbnails`, `--no-captions` | No | Same flags on `download_media.py` |
| `--dirname-pattern`, `--filename-pattern` | No | Same flags on `download_media.py`, with `{target}`, `{profile}`, `{date_utc}` and `{shortcode}` |
| `--no-metadata-json`, `--no-compress-json`, `--post-metadata-txt`, `--title-pattern`, `--sanitize-paths`, `--slide` | No | Ignored with a note. Metadata goes to one JSONL or CSV file instead of a file per post, file names are always safe on Windows, and every slide of a carousel is downloaded |

## Which posts to download

| Instaloader option | Here |
|---|---|
| `--fast-update`, `-F` | `--fast-update` / `-F`: the Actor's monitor mode. Posts and comments that earlier runs with the same `--monitor-key` returned are skipped and not billed, profile paging stops at the newest post already delivered, and profile rows gain `changes.followerDelta`. The memory lives in a key-value store in your own Apify account (`instagram-monitor-<key>`), not in your target folders |
| `--latest-stamps` | Stops: use `--fast-update` (same idea, memory kept on Apify) |
| `--count`, `-c` | `--count` / `-c`: at most N rows per target. Instaloader applies it to hashtags, locations, feed and saved posts; here it applies to every target. With `--profile-rows` the profile, hashtag or location row counts too: in the sample run, `nasa` at `--count 3` gave 1 profile row and 2 posts |
| (no equivalent) | `--max-total` caps rows in the whole run (default 1,000) and `--max-charge` caps its cost in USD (default 2), enforced by Apify |
| `--post-filter`, `--only-if` | Stops. The filters below run on Apify before billing, so posts they skip are free |
| `--storyitem-filter` | Stops (stories are login-only) |

### `--post-filter` expressions

| Instaloader `--post-filter` | Here |
|---|---|
| `"likes > 1000"` | `--min-likes 1001` (posts with hidden like counts are skipped) |
| `"date_utc >= datetime(2026, 9, 1)"` | `--since 2026-09-01`, or a period: `--since "30 days"`. Profiles stop paging at the first older post, so older posts are never read or billed |
| `"is_video"` | `--videos-only` (photos and carousels are skipped and not billed) |
| `"not is_pinned"` | `--skip-pinned` |
| `"video_play_count >= 10000"` | `--min-plays 10000` (photos, and videos without a public play count, are skipped) |
| `"video_view_count > 10000"`, `"'keyword' in caption"`, `"owner_username == 'x'"`, anything else | No pre-billing filter. Filter the output afterwards, for example `jq -c 'select(.caption // "" \| test("launch"; "i"))' nasa.jsonl` |

## Login and connection options

| Instaloader option | Here |
|---|---|
| `--login` / `-l`, `--password` / `-p`, `--sessionfile` / `-f`, `--load-cookies` / `-b`, `--cookiefile` / `-B` | Stops: nothing here signs in to Instagram. Public profiles, posts, hashtags, locations and comments need no account, and private profiles stay out of reach |
| `--user-agent`, `--max-connection-attempts`, `--request-timeout`, `--abort-on`, `--no-iphone`, `--resume-prefix`, `--no-resume` | Ignored with a note: the requests run on Apify, and retries and rate limits are the Actor's job. Each input ends with a status in the run's `RUN_REPORT` (`ok`, `private`, `not_found`, `login_only`, `capped`, `partial`, `blocked` ...) that the script prints |
| `--quiet`, `-q` | `--quiet` / `-q` |

## Python module

The rows are plain JSON (one object per line in the `.jsonl`), not Instaloader objects. Field names are the Actor's.

| Instaloader (Python) | Here |
|---|---|
| `Profile.from_username(L.context, "nasa")` | `--no-posts nasa` gives one `profile` row |
| `profile.username`, `full_name`, `biography`, `external_url` | `username`, `fullName`, `biography`, `externalUrl` (plus every bio link in `bioLinks`) |
| `profile.followers`, `profile.followees` | `followerCount`, `followingCount` |
| `profile.userid` | `id` |
| `profile.is_verified`, `is_private`, `is_business_account`, `business_category_name` | `isVerified`, `isPrivate`, `accountType` / `isBusiness` / `isCreator`, `category` |
| `profile.profile_pic_url` | `hdProfilePicUrl`, `profilePicUrl` |
| `profile.mediacount` | Not available: `postCount` is `null`, Instagram hides it from logged-out visitors |
| `profile.get_posts()` | `nasa` (posts, newest first) |
| `profile.get_reels()` | `--reels`, or the URL `https://www.instagram.com/nasa/reels/` |
| `profile.get_similar_accounts()` (login) | `--similar-accounts` adds `relatedProfiles` (up to 50, when Instagram suggests any) to profile rows |
| `profile.get_followers()`, `profile.get_followees()` (login) | Not available |
| `profile.get_tagged_posts()` | Not available |
| `Post.from_shortcode(L.context, "DRvit9Ejgel")` | `-- -DRvit9Ejgel` or the post URL |
| `post.shortcode`, `post.date_utc`, `post.caption` | `code`, `createdAt` (ISO 8601, UTC), `caption` |
| `post.caption_hashtags`, `post.caption_mentions` | `hashtags`, `mentions` |
| `post.likes`, `post.comments` | `likeCount`, `commentCount` |
| `post.typename` (`GraphImage`, `GraphVideo`, `GraphSidecar`) | `mediaType` (`image`, `video`, `carousel`) |
| `post.url`, `post.video_url`, `post.video_duration` | `image.url`, `video.url`, `video.duration` |
| `post.video_play_count`, `post.video_view_count` | `video.playCount`, `video.viewCount` (with `--video-views`) |
| `post.get_sidecar_nodes()`, `post.mediacount` | `carousel[]` (`type`, `url`, `videoUrl`), `carouselCount` |
| `post.owner_username`, `post.owner_id` | `owner.username`, `owner.id`; every post also carries `owner.followerCount` |
| `post.location` | `location` (`id`, `name`, `slug`, `lat`, `lng`) |
| `post.tagged_users` | `taggedUsers[].username` |
| `post.is_sponsored`, `post.sponsor_users` | `isPaidPartnership`, `sponsors` |
| `post.accessibility_caption`, `post.is_pinned` | `accessibilityCaption`, `isPinned` |
| `post.get_comments()` (login) | `--all-comments`: `comment` rows with `text`, `createdAt`, `likeCount`, `owner.username`, `postCode` |
| `comment.answers` | Not available: replies are only shown to logged-in accounts |
| `post.get_likes()` | Not available: who liked a post is only shown to logged-in accounts |
| `Hashtag.from_name(L.context, "travel").get_top_posts()` | `"#travel"` |
| `hashtag.get_posts_resumable()` (recent posts) | Not available: logged out, Instagram shows a hashtag's top posts only. `--related-keywords N` adds the top posts of up to N related keywords |
| `hashtag.mediacount` | Not available on hashtag rows |
| `L.get_location_posts("213131048")` | `%213131048` |
| `L.download_post(post, target)` | `download_media.py`: one folder per target, `{date_utc}_UTC` file names, caption in a `.txt` |

Fields Instaloader doesn't have: `coowners` (collab posts), `audio` (title, artist, original or licensed), `engagementRate`, `owner.followerCount` on every post, and on profile rows the emails and phone numbers written in the bio, `threadsUsername` and `instagramGraphId` (the account's id in Meta's Instagram Graph API).

[il-cli]: https://instaloader.github.io/cli-options.html

<!-- All apify.com links for this file live below. When the Apify affiliate id exists, append ?fpr=<id> to these URLs only. -->
[store]: https://apify.com/yugenox/instagram-scraper
