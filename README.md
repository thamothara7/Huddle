<div align="center">

<img src="https://raw.githubusercontent.com/thamothara7/Huddle/main/public/huddle-logo.svg" width="96" height="96" alt="Huddle logo"/>

<h1>Huddle</h1>

<em>Reports cluster by user. A factual one-sentence summary appears on every queue item. One click reveals the underlying context — without leaving Reddit.</em>

<p>Built for the <strong>Reddit Mod Tools and Migrated Apps Hackathon</strong> — submission category: Best New Mod Tool.</p>

</div>

---

## The problem

Reddit moderators spend hours each week leaving the modqueue just to gather context: checking user history, scrolling parent threads, scanning prior mod logs. Two peer-reviewed papers quantify this:

- **84% of moderators "sometimes, often, or almost always" leave the modqueue to seek additional context** while reviewing reports. (Bajpai & Chandrasekharan, [*In the Queue*, CHI '26](https://dl.acm.org/doi/10.1145/3772318.3791931). Preprint: [arxiv:2509.07314](https://arxiv.org/abs/2509.07314).)
- **74.5% of moderators report experiencing a collision** — two mods unknowingly acting on the same item at the same time. (Bajpai & Chandrasekharan, [*Towards a Better Modqueue*, arxiv:2409.16840](https://arxiv.org/abs/2409.16840).)
- The modqueue UI has not been redesigned since 2008.

## What Huddle does

Huddle is a Devvit app that renders a smarter, team-aware modqueue inside a custom Reddit post.

**1. Automatic grouping.** Reports cluster by the target user, so multiple reports against one bad actor collapse into a single row with bulk **Approve all** / **Remove all** actions.

**2. Factual AI summaries.** Every queue item gets a one-sentence summary in plain English — *"This 4-year-old account has made 2 comments in this subreddit, both within the last 7 days."* The LLM never sees post or comment **content** — only a structured fact dict (account age, prior items in sub, last 7 days, prior removals). When the LLM is unavailable or rate-limited, Huddle silently falls back to a templated raw-facts sentence over the same data, so the UI never breaks.

**3. AI-suggested mod action.** A color-coded chip above each item's action buttons recommends **Approve · Remove · Spam** with a confidence level and a one-sentence factual justification — built from the same fact dict the summary uses. The model never sees content; it can decline with `review` when signals are insufficient. When Gemini is rate-limited (free-tier 429s), a deterministic heuristic over the same facts takes over so the chip stays useful.

**4. Context Peek drawer.** Click any item → a right-side drawer shows the exact facts the AI received as a small table, the user's last 5 post/comment titles in this sub with two-letter status codes (`ok` approved · `rm` removed · `pn` pending · `sp` spam), and a 30-day mod-action stacked histogram by day and action type. From the drawer header a mod can **Open on Reddit**, **View profile**, or **Ban user** (with a click-twice confirm). Banning auto-removes every queued item from that user in one sweep. No body content is leaked in the drawer; mods who want full content click **Open** to leave Huddle deliberately.

**5. Bulk + inline + reject-with-reason actions.** Approve / Remove per item, **Approve all** / **Remove all** at the group level (collapsed view only, with a click-twice confirm), plus **Reject with reason** — an inline panel where the mod types a removal reason (or clicks **Suggest with AI** to have Gemini draft a friendly, factual, second-person reason from the report context). On confirm Huddle removes the item and posts the reason as a distinguished, stickied reply, exactly like Reddit's native removal-reason flow. All actions go through Reddit's API; Huddle never bypasses moderator intent.

## Screenshots

| Splash | Grouped queue |
|---|---|
| ![splash](https://raw.githubusercontent.com/thamothara7/Huddle/main/docs/screenshots/07-splash.png) | ![grouped queue](https://raw.githubusercontent.com/thamothara7/Huddle/main/docs/screenshots/01-grouped-queue.png) |

| AI summary + suggestion chip | Context Peek drawer |
|---|---|
| ![AI summary and suggestion](https://raw.githubusercontent.com/thamothara7/Huddle/main/docs/screenshots/02-ai-summary-and-suggestion.png) | ![context peek drawer](https://raw.githubusercontent.com/thamothara7/Huddle/main/docs/screenshots/03-context-peek-drawer.png) |

| Empty state |
|---|
| ![empty state](https://raw.githubusercontent.com/thamothara7/Huddle/main/docs/screenshots/06-empty-state.png) |

## Install in your subreddit

You must be a moderator of the target subreddit.

1. Visit the app's page at [developers.reddit.com/apps/huddle-mod](https://developers.reddit.com/apps/huddle-mod).
2. Click **Install** and pick the subreddit.
3. *(Optional)* If you want AI summaries instead of the raw-facts fallback, set your own Gemini key — see "AI summaries" below.
4. In your subreddit, open the subreddit menu (`···`) and click **Install Huddle here**. A custom post titled "Huddle modqueue" is created.
5. Open the post and click **Open queue**. Reports will appear here automatically, clustered by user.

### AI summaries (optional)

Huddle ships with AI summaries powered by [Google Gemini Flash](https://aistudio.google.com/apikey) (free tier — 1,500 requests/day, no card required). The key is configured **once** at the app level and shared across all installs.

To set your own key (if you forked or self-hosted):

```sh
devvit settings set geminiApiKey
```

You'll be prompted to paste the key — it's stored encrypted in Devvit and never echoed back. Summaries are cached forever per item, so a small free-tier quota goes a long way.

If no key is set, Huddle uses a templated raw-facts sentence built from the same fact dict the AI would have received. The moderation utility is identical; only the prose polish is missing.

## Develop locally

Requires Node 22+.

```sh
git clone https://github.com/thamothara7/Huddle.git
cd Huddle
npm install
npm run dev   # devvit playtest in your test subreddit (~huddle_mod_dev)
```

Edit `devvit.json` → `dev.subreddit` to point playtest at your own subreddit (you must be a mod of it).

### Commands

| Command | What it does |
|---|---|
| `npm run dev` | Live playtest — auto-uploads on save and streams logs |
| `npm run build` | Vite build (client + server) |
| `npm run deploy` | type-check → lint → `devvit upload` |
| `npm run launch` | Deploy + publish for App Directory review |
| `npm run type-check` | TypeScript across client/server/shared projects |
| `npm run lint` | ESLint on `src/**/*.{ts,tsx}` |

## Architecture

```
Reddit triggers (PostReport, CommentReport, ModAction, PostSubmit, CommentSubmit)
  → Hono routes at /internal/triggers/*
  → Redis store (ZSETs for groups, JSON-string items, ZSETs for per-user history)
  → React WebView polls /api/init every 5s
  → ItemRow lazy-fetches /api/summary (Gemini + fact-dict, cached forever)
  → Click row → /api/context-peek composes facts + recent titles + 30d action timeline
```

| Folder | Purpose |
|---|---|
| `src/server/routes/triggers.ts` | All 5 trigger handlers |
| `src/server/routes/api.ts` | `/init`, `/summary`, `/context-peek`, `/action`, `/action-bulk` |
| `src/server/core/items.ts`, `groups.ts`, `history.ts`, `reports.ts` | Redis-backed stores |
| `src/server/core/ai/facts.ts` | Per-user facts compute (`getCommentsAndPostsByUser` + `getUserByUsername`) |
| `src/server/core/ai/summary.ts` | Gemini call with cache + raw-facts fallback |
| `src/client/game.tsx` | React queue + Context Peek drawer |
| `src/shared/api.ts` | Types shared between client and server |

## Scale characteristics

Huddle is designed for the mod queue that Bajpai's research described — a few dozen to a few hundred open items at peak, where context-gathering is the bottleneck, not raw volume. The architecture is comfortable at this scale; for the largest subs it would need three additions, documented below.

| Queue size | Mods watching | Behavior |
|---|---|---|
| Under 50 open items | 1–5 | Comfortable. The 5-second polling is invisible. |
| 50–500 open items | 5–20 | Workable. Network payload per poll grows. |
| 500–2,000 open items | 20+ | Degrades. Page load slows, traffic spikes per refresh. |
| 5,000+ items, many simultaneous mods | — | Needs the architectural changes below. |

**Why it scales the way it does:**
- `/api/init` returns the full grouped queue every 5 s — fine when the payload is under ~100 KB.
- Each `ItemRow` lazy-fetches its AI summary on mount — fast for small lists, expensive when hundreds of rows render at once.
- Redis ZSETs handle thousands of members per group, so the data layer isn't the limiter; the network round-trip and the React render are.

**Production-scale roadmap (in priority order):**
1. **Realtime instead of polling.** `permissions.realtime` is already declared in `devvit.json`. The server would publish diffs to `huddle:{subId}:updates`; the client subscribes; the polling traffic disappears.
2. **Pagination on `/api/init`.** Return the first N groups + a cursor — mods rarely scroll past the first screen.
3. **Client-side list virtualization.** Standard `react-window` usage on the queue list.
4. **Background-job the cascade-remove after ban.** Devvit Scheduler can dispatch the work; the endpoint returns `202 Accepted` immediately; the client polls for completion. Today the endpoint blocks until every `reddit.remove` finishes.
5. **TTL on actioned items and cached summaries.** Auto-expire after 30 days so Redis stays bounded.
6. **Atomic `reportCount` via `INCR`.** Fixes a read-modify-write race when many reports hit the same item simultaneously (the count is non-monotonic under burst load today).

None of these are v1 blockers — the demo target is the mod queue Bajpai's paper actually measured. Items 1 and 2 are the highest-ROI fixes if Huddle ever needs to handle a top-100 subreddit.

## Known limitations

- **Old Reddit users cannot use Huddle.** Custom posts don't render there — this is a Devvit platform constraint.
- **Action timeline starts at install date.** Huddle records mod actions it observes; it cannot backfill the full history of a user.
- **User reports are anonymous.** Reddit's trigger payload does not expose reporter identity for user reports, by policy. Huddle surfaces only the report **reason** — and, when present, mod-initiated reports through a distinct amber "MOD" chip.
- **Single AI provider.** Gemini Flash via Google AI Studio's free tier. Failures of any kind (no key, network, 429, safety block) silently fall back to the raw-facts sentence — Huddle never blocks the UI on the LLM.
- **What Huddle doesn't fix yet.** Bajpai 2025a notes mods still leave the queue to (1) check Toolbox usernotes and (2) read full thread context. Huddle closes the "gather context to decide" loop and the "ban + clean up" loop; the Toolbox-integration loop and full thread-context view are roadmap items, not v1.

## License

[MIT](LICENSE) © 2026 Thamothara.

Built with [Devvit](https://developers.reddit.com/), [Hono](https://hono.dev/), [React](https://react.dev/), [Vite](https://vite.dev/), [Tailwind CSS](https://tailwindcss.com/), [TypeScript](https://www.typescriptlang.org/), and [Google Gemini](https://ai.google.dev/).
