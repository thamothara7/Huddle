# Screenshots checklist

Capture these from `r/huddle_mod_dev` after a few test reports. PNG, retina/2x preferred. Drop them in this folder using the exact filenames below — the main README references them.

| Filename | What to capture | Setup |
|---|---|---|
| `01-grouped-queue.png` | The whole Huddle modqueue post showing at least 2 groups with different authors. The headline shot. | Report 2-3 items from one user, 1 item from another. Open the Huddle post. |
| `02-ai-summary.png` | Close-up of a single item row showing the **AI** indigo chip + the Gemini-formatted sentence. Crop tight on the row. | Trigger a summary fetch (refresh the queue post). Zoom your browser to ~150% so the chip and text are readable. |
| `03-context-peek-drawer.png` | The right-side drawer open over the queue, showing facts table + recent activity + 30-day timeline. The killer feature. | Click into any item to open the drawer. Capture before clicking outside. |
| `04-bulk-action.png` | Group header showing `Approve all` / `Remove all` buttons. The browser confirm dialog (`Approve all 2 items from u/…?`) makes a great extra detail if you can capture it mid-click. | Click an Approve all / Remove all button; pause on the confirm. |
| `05-empty-state.png` | The "Modqueue is empty. Reports will appear here clustered by user." copy. Use after clearing the queue or in a quiet sub. | Approve all open items, then refresh. |

## Notes

- **Hide your IRL Reddit username** if it's in the sidebar. Crop it out or anonymize before publishing.
- **Dark mode** looks more polished than light for these. The app supports both via Tailwind dark: variants.
- **Mod-report chip** (amber **MOD** badge) is a bonus shot if you can trigger it by clicking the report flow as a moderator and using "Custom response."
- Resolution: ~1200px wide is fine for README rendering; full-screen captures are fine too.
