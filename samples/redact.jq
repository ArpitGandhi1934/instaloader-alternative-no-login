# Applied to the raw output before committing (slurps the JSONL, writes JSONL):
#   jq -s -c -f samples/redact.jq out/raw.jsonl > samples/sample.jsonl
#
# The sample is real Actor output. To avoid republishing private individuals' details:
# - Instagram accounts that are not verified become user_1, user_2 ... (in order of first
#   appearance). Their id, full name, bio, links, contacts and avatar are set to null, and every
#   other mention of that username in the file (captions, comments, audio titles) is replaced too.
# - Posts they own lose their post code, URL, ids, @mentions, alt text, carousel ids and audio id.
#   Comments they wrote lose their id and any @mentions.
# - A comment in which the commenter states their age is dropped.
# - Captions, comment text and topic descriptions are cut to their first sentence (plus " …"), and
#   a hashtag's list of related keywords to its first 5.
# - Email addresses are removed from all text, and the `emails` and `phones` of every profile are
#   blanked.
# - Signed Instagram CDN URLs (they expire within days anyway) become a short placeholder.
# Verified accounts, places, hashtags and every count, date and flag are otherwise left untouched.

def rx: gsub("(?<c>[.*+?^${}()|\\[\\]\\\\/])"; "\\\(.c)");
def personFields: ["fullName", "id", "biography", "externalUrl", "profilePicUrl", "hdProfilePicUrl",
                   "bioLinks", "emails", "phones", "threadsUsername", "pronouns", "instagramGraphId"];
def firstSentence:
  (gsub("\\s+"; " ") | sub("^ "; "") | sub(" $"; "")) as $t
  | ([$t | capture("^(?<s>.+?[.!?。！？])( |$)")] | first | .s?) as $s
  | if $s != null and ($s | length) <= 300 then ($s + (if ($s | length) < ($t | length) then " …" else "" end))
    elif ($t | split(" ") | length) > 25 then ($t | split(" ")[:25] | join(" ")) + " …"
    else $t end;
def statesAge: type == "string" and test("\\b(i'?m|i am)\\s+\\w+\\s+(years?|yrs?)\\s+old\\b"; "i");

([.. | objects | select(has("username") and (.isVerified != true)) | .username] | unique) as $ig
| def igAlias($u): "user_" + (($ig | index($u)) + 1 | tostring);
  def aliased: type == "string" and test("^user_[0-9]+$");
  def noMentions: if type == "string" then gsub("@[A-Za-z0-9_.]+"; "@user") else . end;

  # 0) drop comments that state the commenter's age
  map(if .latestComments? then .latestComments |= map(select(.text | statesAge | not)) else . end)
  | map(select(.dataType != "comment" or (.text | statesAge | not)))

  # 1) people objects
  | walk(
    if type == "object" and has("username") and (.isVerified != true) then
      .username = igAlias(.username)
      | reduce personFields[] as $k (.; if has($k) then .[$k] = null else . end)
    else . end
  )
  # 2) posts and comments that belong to them
  | walk(
    if type == "object" and (.owner.username? | aliased) and has("text") then
      .id = null | .text |= noMentions
    elif type == "object" and .dataType? == "post" and (.owner.username? | aliased) then
      .code = "REDACTED" | .url = "https://www.instagram.com/p/REDACTED/" | .id = null | .pk = null
      | .mentions = [] | .caption |= noMentions | .accessibilityCaption = null
      | .carousel |= (if type == "array" then map(.id = null) else . end)
      | .audio |= (if type == "object" then .id = null else . end)
    else . end
  )
  # 3) one-sentence text
  | walk(
    if type == "object" and .dataType? == "post" and (.caption | type) == "string" then .caption |= firstSentence
    elif type == "object" and .dataType? == "keyword" then
      (if (.description | type) == "string" then .description |= firstSentence else . end)
      | (if (.relatedKeywords | type) == "array" then .relatedKeywords |= .[:5] else . end)
    elif type == "object" and has("text") and has("owner") and (.text | type) == "string" then .text |= firstSentence
    else . end
  )
  # 4) remaining mentions of their usernames, emails and phone numbers, anywhere
  | walk(
    if type == "string" then
      (reduce $ig[] as $u (.; if ($u | length) > 3
          then gsub("(?<![A-Za-z0-9_.])" + ($u | rx) + "(?![A-Za-z0-9_])"; igAlias($u)) else . end))
      | gsub("[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}"; "(email removed)")
    elif type == "object" and has("phones") and (.phones | type) == "array" then
      .phones |= map("(removed in sample)") | .emails |= (if type == "array" then map("(removed in sample)") else . end)
    else . end
  )
  # 5) expiring CDN links
  | walk(
    if type == "string" and test("^https://[^/]+\\.(cdninstagram\\.com|fbcdn\\.net)/")
    then "https://cdninstagram.com/(signed media URL, expires within days)"
    else . end
  )
  | .[]
