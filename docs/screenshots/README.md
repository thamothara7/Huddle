# Screenshots checklist

Capture these from `r/huddle_mod_dev` in your browser after seeding the sub with realistic test data. PNG, retina/2x preferred. Save with the exact filenames below — the main README references them.

## Setup before shooting

Best demo data looks like this. Spend 5 minutes seeding it.

1. **Create 3 test users** (or use accounts you already control). Real Reddit accounts work best — they'll have snoovatars / icons. Suggested mix:
   - `u/karthikvelan1` (or similar) — well-established account
   - `u/Thamothara7` (your mod account) — moderately active
   - A throwaway account — newer, for the "new account" suggestion case
2. **Submit 5–6 posts and a few comments** across these users in `r/huddle_mod_dev`. Vary the titles a bit ("Test post", "Help with X", "Discussion: Y") so they don't all read "Hi" in the screenshots.
3. **Report the items** with a mix:
   - Some with the default "Spam" reason
   - Some with custom additional information typed in
   - Have one of your accounts use Reddit's mod-report flow on one post (so the **MOD** chip shows up)
4. Refresh the Huddle post. Wait ~10s for AI summaries + suggestions to populate.

## Shots to capture

| Filename | What to capture | Why |
|---|---|---|
| `01-grouped-queue.png` | The whole Huddle modqueue post showing **2–3 groups with different authors**. AI summaries visible on each item. **AI-suggested chip** visible above the buttons on at least one item. | Hero shot. This is the lead image for the Devpost gallery. |
| `02-ai-summary-and-suggestion.png` | Close-up of a single item row showing the `AI` chip + Gemini's one-sentence summary, AND the colored **AI suggests Remove · high confidence** chip with the why-line below it. Crop tight on the row. | Two-AI-surfaces-in-one-row story. Zoom your browser to ~150 % so the chip and text are readable. |
| `03-context-peek-drawer.png` | The right-side drawer open over the queue, showing facts table + recent activity list with two-letter status codes (`ok` / `rm` / `pn` / `sp`) + 30-day stacked-histogram timeline. Include the **Ban user** link in the drawer header. | The killer feature. The drawer is the headline 84%-fix surface. |
| `04-reject-with-reason.png` | An item with the **Reject with reason** inline panel open: textarea with a Gemini-drafted reason filled in (click "Suggest with AI" to populate), plus the **Cancel** + **Confirm reject** buttons visible. | Shows the third AI surface and the polished editorial flow. |
| `05-bulk-action.png` | Collapsed group card with `Approve all` / `Remove all` buttons in the resting state, OR mid-confirm with one button morphed to **Confirm: approve N** in bold rose with the pulse animation. | Demonstrates the click-twice confirm pattern + bulk-action UX. |

## Bonus shots (use as supporting images)

| Filename | What to capture |
|---|---|
| `06-empty-state.png` | The "Modqueue is clear" empty state with the Huddle logo at 80 % opacity. Use after approving all open items. |
| `07-splash.png` | The inline splash view in the Reddit feed (before clicking "Open queue") with the gradient logo + tagline + CTA button. |
| `08-mod-report-chip.png` | Close-up of an item with the amber **MOD** chip + mod-reported reason text. Demonstrates the mod-vs-user-report distinction. |
| `09-banned-state.png` | Drawer header after a successful ban — the rose **Banned · cleaned up N items** indicator next to View profile. |

## Notes

- **Hide your IRL Reddit username** in the right sidebar if it's a personal account. Crop it out or anonymize before publishing.
- **Dark mode reads more polished** for these — the gradient logo and the chips look richer. Light mode also works; pick one and stay consistent across all shots.
- **Resolution**: 1200–1500 px wide is plenty for the README and Devpost gallery. Crop tight; don't include browser chrome unless it adds context.
- **The AI-suggestion chip is the most photogenic new element.** Make sure shot #2 captures it clearly — that single screenshot tells the "AI grouped + summarized + recommended" story in one frame.
- If you want to mock realistic data for the demo (real spam-pattern accounts are rare in a fresh test sub), this is fine — just disclose in the Devpost description that some demo data is scripted for visualization. Judges respect honesty.

## Macro mechanics (since you'll do this manually)

- **macOS**: `Cmd+Shift+4` then space, then click the WebView window for a clean window capture; or `Cmd+Shift+4` and drag for a rectangle.
- **iOS preview in browser**: Reddit shows a "Mobile" preview switcher above the WebView — use that to capture mobile-shaped shots if you want a mobile-specific gallery.
- After capture, drag the PNG into `docs/screenshots/` with the correct filename and commit.
