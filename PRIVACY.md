# Huddle — Privacy Policy

_Last updated: 2026-05-25_

Huddle is a moderation tool for subreddit moderators. It runs as a Devvit app inside Reddit's infrastructure. This document describes what data Huddle handles, where it goes, and what it never touches.

## What Huddle reads

When installed in a subreddit, Huddle subscribes to five event triggers via Reddit's Devvit platform: `PostReport`, `CommentReport`, `ModAction`, `PostSubmit`, and `CommentSubmit`. For each event, Huddle reads:

- **The item being acted on**: its Reddit thing-id (`t3_...` for posts, `t1_...` for comments), title (for posts), author username and user-id, parent post id (for comments), permalink.
- **Report metadata**: the report reason text (typed by a reporter or moderator), the report counts maintained by Reddit, the moderator-report reasons array.
- **Mod-action metadata**: the action type (`approvelink`, `removelink`, `spamlink`, `banuser`, etc.) and the acting moderator's username.
- **Public user metadata** for facts (NOT content): account age, username, count of recent posts and comments in the subreddit, count of those previously removed.

## What Huddle stores

Inside Reddit's Devvit-managed Redis (scoped to the subreddit where Huddle is installed):

- Queue items keyed by their Reddit thing-id, holding the fields above
- Per-user activity history: last 20 post/comment titles in the sub, 30-day rolling moderator-action history
- Cached AI summaries (one sentence per item)
- Cached AI mod-action suggestions (one structured suggestion per item, 24h TTL)
- Cached snoovatar URLs for avatar rendering (24h TTL)
- Per-user facts cache (24h TTL)

All Redis storage is sub-scoped, managed by Reddit's Devvit platform, and inaccessible to anyone outside the app's runtime.

## What Huddle sends to third parties

Huddle uses **Google Gemini Flash** (via Google AI Studio's free tier) for three AI surfaces:

1. **Summary generation**: Huddle sends a structured 5-field fact dict (`{ accountAgeDays, postsInSubTotal, commentsInSubTotal, inSubLast7d, removedInSubTotal }`) and receives a one-sentence factual summary.
2. **Suggested mod action**: Huddle sends the same fact dict plus the (anonymous) report reason strings and receives a recommendation (`approve` / `remove` / `spam` / `review`) with a confidence level and a one-sentence justification.
3. **Removal-reason drafting**: When a moderator clicks "Suggest with AI" in the Reject panel, Huddle sends the fact dict and report reasons and receives a draft removal-reason message.

**Huddle does NOT send to Gemini:**
- The body content of any post or comment
- Reddit usernames (with one exception: the post/comment **title** may include a username if the author chose to include one)
- Direct messages, modmail, or any private communication
- Anything not in the fact dict above

Google Gemini's data handling for the free tier is governed by [Google AI Studio's terms](https://ai.google.dev/terms). Per those terms, free-tier prompts may be used to improve Google's models. Subreddit moderators who require stronger data isolation should provide their own paid-tier API key.

Huddle's only other outbound network request is a fetch to `https://www.reddit.com/user/{name}/about.json` to retrieve a user's public profile-icon URL (default snoo or uploaded icon) when their snoovatar is not exposed by Devvit's typed API. This is the same data shown on every Reddit user's public profile page.

## What Huddle never does

- Huddle never reads or stores private messages or modmail.
- Huddle never sends post or comment **body text** to any third-party LLM.
- Huddle never sells, shares, or transmits data to advertisers or analytics providers.
- Huddle never takes a moderation action without an explicit moderator click — no autonomous bans, removes, or approvals.
- Huddle never logs anonymous reporters' identities (Reddit does not expose them to apps).

## Data retention

- Queue items: persist until actioned, then remain in Redis indefinitely (roadmap: 30-day TTL).
- Cached AI summaries: indefinitely per item (regenerated only on cache invalidation).
- Per-user facts cache: 24 hours.
- Snoovatar URL cache: 24 hours on hit, 5 minutes on miss.
- Mod-action timeline: stored indefinitely; UI reads only the trailing 30 days (roadmap: lazy cull beyond 90 days).

Uninstalling the Huddle app from a subreddit causes Reddit's Devvit platform to revoke Huddle's data access; Reddit's standard data-retention timelines for app-installation state apply thereafter.

## Your rights

If you are a Reddit moderator using Huddle and want any data Huddle has cached about your subreddit purged, uninstall the app from the subreddit's mod tools. For source code, see <https://github.com/thamothara7/Huddle>.

## Contact

Questions about this policy: open an issue at <https://github.com/thamothara7/Huddle/issues>.
