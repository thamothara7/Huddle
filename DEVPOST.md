# Huddle — Devpost submission draft

Paste each section into the corresponding Devpost field. Hackathon: **Reddit Mod Tools and Migrated Apps Hackathon** · Category: **Best New Mod Tool** ($10K).

---

## Tagline (140 chars)

Reports cluster by user. One click reveals context. Bulk-action a bad actor in one move — without leaving Reddit.

---

## Inspiration

Two peer-reviewed papers from Bajpai & Chandrasekharan (UMich) put hard numbers on a problem moderators have lived with for years:

- **84% of moderators "sometimes, often, or almost always" leave the modqueue to seek additional context** while reviewing reports — checking user history, scrolling parent threads, scanning prior mod logs (Bajpai & Chandrasekharan, *In the Queue*, [CHI 2026](https://dl.acm.org/doi/10.1145/3772318.3791931)).
- **74.5% of moderators report experiencing a collision** — two mods unknowingly acting on the same item at the same time (Bajpai & Chandrasekharan, *Towards a Better Modqueue*, [arxiv 2409.16840](https://arxiv.org/abs/2409.16840)).
- The modqueue UI has not been redesigned since 2008.

Every time a mod leaves the queue to gather context, they lose seconds. Across a busy sub, that's hours per week of unpaid volunteer time. Huddle brings the context to the queue.

---

## What it does

Huddle installs as a custom post in any subreddit you moderate. Open it and you see a smarter, team-aware version of the modqueue:

- **Automatic grouping** — reports cluster by author. Multiple reports against one user collapse into one row with bulk Approve all / Remove all actions.
- **Factual AI summaries** — every item shows a one-sentence summary like *"This 259-day-old account has made 2 comments in this subreddit, both within the last 7 days."* The LLM **never sees the reported content** — only a structured fact dict (account age, posts/comments in sub, last 7 days, prior removals). The prompt is strict: factual, no judgment words, max 25 words. Summaries are cached forever per item.

  > **Why an AI that can't see content?** Every other AI mod tool risks hallucinating about your community's content. Huddle's LLM only sees a 5-field fact dict — it cannot make claims it can't justify. Mods see the exact same dict next to the AI's sentence in the Context Peek drawer, so every summary is auditable.

- **Context Peek drawer** — click any item, a right-side drawer slides in showing (1) the exact facts the AI received as a small table, (2) the user's last 5 post/comment titles in this sub with status badges (✓ approved · ✗ removed · ⏳ pending), and (3) a 30-day mod-action mini-timeline. **Titles only — never body content.** Mods who want to read full content click "Open on Reddit ↗" to leave Huddle deliberately.
- **Bulk + inline actions** — Approve / Remove individual items, or Approve all / Remove all at the group level. Everything goes through Reddit's API; Huddle never auto-actions without an explicit click.

---

## How we built it

- **Devvit Web** (`@devvit/web/server`) — Hono HTTP server hosting the five trigger webhooks (PostReport, CommentReport, ModAction, PostSubmit, CommentSubmit) plus the queue/summary/drawer/action APIs.
- **Redis** for the entire data plane — ZSETs for group sets and per-user history (recent titles capped at 20, 30-day action timeline), HASH for the user-facts cache (24h TTL), STRING for cached AI summaries (forever). Because Devvit Redis has no plain SET ops, we use ZSETs with timestamp scores throughout.
- **React 19 + Tailwind 4 + Vite** for the WebView — the queue polls `/api/init` every 5 seconds; each item lazy-fetches its AI summary; the drawer is a render-time composition over data already in Redis (no extra LLM call when the drawer opens).
- **Google Gemini Flash** (`gemini-flash-latest`) via Google AI Studio's free tier — 1,500 requests/day, no card required. The system prompt locks the model into one neutral sentence ≤25 words, never adding opinion words. Thinking mode disabled (`thinkingBudget: 0`) so we get a clean answer in `parts[0]`. Every failure path (no key, network error, 429, safety block, response under 10 chars) silently falls back to a templated raw-facts sentence over the same fact dict.
- **Reddit API client** — `getCommentsAndPostsByUser`, `getUserByUsername`, `getPostById`, `getCommentById` for facts and report-snapshot sync; `approve(id)` / `remove(id, false)` for actions.
- **TypeScript** end-to-end. Branded `t1_` / `t3_` / `t2_` thing-id types narrowed via runtime predicates rather than casts.

A reverse-lookup `huddle:item-groups:{itemId}` ZSET lets mod-action cleanup remove an actioned item from every group it belongs to in a single pass — the spec called this out as the most common bug in similar tools.

---

## Challenges we ran into

1. **The Devvit ecosystem migrated from `@devvit/public-api` (Blocks) to `@devvit/web` (Hono webhooks) between the spec and the build.** Every file path and import pattern in the original spec was obsolete. We translated the architecture in place: triggers become HTTP routes, settings move from `Devvit.addSettings` to `devvit.json` `settings.global`, custom posts host React WebViews via `splash.html`/`game.html` entrypoints.
2. **Devvit Redis has no plain SET operations** — no `sAdd`/`sRem`/`sMembers`. We used ZSETs throughout, with timestamps as scores so we get free recency ordering on every read.
3. **Gemini 2.5's thinking mode broke our parser.** The model's response prepends a "thought" part with a one-character placeholder (`*`) before the real answer. We cached that single `*` as the summary on first call. Fix: set `thinkingConfig.thinkingBudget: 0`, concatenate all non-thought parts, reject any response under 10 characters, and auto-bust suspiciously-short cached values on read.
4. **Reddit doesn't expose reporter identity for anonymous user reports** — by policy. We had to design around this: the group is keyed by reported-content author (not reporter), and mod-initiated reports surface separately through `Post.modReportReasons` / `Comment.modReportReasons`.
5. **The HTTP fetch allowlist looked unregistered in the dev portal** ("No domains requested") even after declaring `permissions.http.domains` in `devvit.json` and running `devvit upload`. Turned out the domain was actually allowlisted — only the portal UI was stale. We diagnosed this by surfacing the LLM source ("AI" vs "raw") as a chip in the UI and logging every fetch outcome to playtest CLI.

---

## Accomplishments we're proud of

- **The full pipeline works end-to-end in production playtest.** Reports flow from Reddit triggers → Redis → React WebView with grouping, AI summaries, drawer, and bulk actions all live.
- **The AI never sees content.** This was a non-negotiable design constraint — it eliminates the entire class of hallucination and judgment errors that plague AI moderation tools. Every summary is grounded in deterministic facts; the LLM is just a sentence formatter.
- **The fallback path is invisible to users.** Whether Gemini returns prose or the raw-facts formatter takes over, the moderator sees the same shape of information in the same place — the LLM is genuine polish, not a load-bearing dependency.
- **The Context Peek drawer is AI-free by design.** It composes facts + history that are already in Redis. No extra LLM call. The "AI legibility" promise is literal: mods see the exact dict the AI received.
- **Mod reports surface distinctly.** When a moderator (not an anonymous user) reports an item, the row shows an amber MOD chip with the mod's name when Reddit's API exposes it — anonymous user reports stay anonymous per Reddit's policy.
- **Backed by peer-reviewed research.** Every feature maps to a finding in the Bajpai papers.

---

## What we learned

- The most important architectural decision in an AI moderation tool isn't the model — it's deciding what the model *doesn't* get to see. Constraining Gemini to formatting-only made hallucination structurally impossible.
- Devvit's WebView model is more permissive than it looks once you accept that custom posts ARE the UI surface — no separate "splash + game expanded view" Blocks dance, just two HTML entrypoints sharing state through HTTP.
- Diagnostic affordances pay back fast. Surfacing the LLM source as a chip in the UI ("AI" vs "raw") and logging each fetch outcome to playtest CLI turned a long debug cycle into a single-glance check.

---

## What's next

Huddle solves the "leaving the queue for context" half of the modqueue problem. Bajpai 2025a notes that moderators still leave the queue to (1) take user-level actions like banning, (2) check Toolbox usernotes, and (3) read full thread context. The roadmap below addresses each of these honestly:

- **Live mod presence** — avatar dots on each row so two mods don't act on the same item simultaneously (the 74.5% collision stat above).
- **Persistent realtime updates** instead of 5-second polling, via Devvit's realtime channel.
- **In-drawer ban / mute / approve-user actions** — close the loop on user-level decisions without leaving Huddle.
- **Toolbox usernote integration** so existing notes surface in the Context Peek drawer.
- **Reporter reliability scoring** once Huddle has accumulated enough per-user history.
- **Postmortem auto-generation** for actioned items, summarizing what happened and why.

These were deliberately scoped out of the MVP per the original spec. The 4-day budget went to the headline 84%-fix.

---

## Built with

`Devvit Web` · `Hono` · `Redis` · `Google Gemini Flash` · `React 19` · `Vite` · `Tailwind CSS 4` · `TypeScript`

---

## Repo

<https://github.com/thamothara7/Huddle>

## App

<https://developers.reddit.com/apps/huddle-mod>

## License

MIT
