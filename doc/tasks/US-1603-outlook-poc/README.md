# US-1603: PoC — Outlook model, reliability matrix, go/no-go report

**Epic:** [EPIC-120](../../epics/EPIC-120.md) · **Status:** done (proof of concept), 2026-10-03
**Depends on:** [US-1602](../US-1602-site-extension-injection-poc/README.md)

## Goal

Show whether an injected AiVision model on a heavy single-page app (Outlook on the web) stays
reliable through reloads, navigation, session restore and sign-in redirects, and whether it is
cheaper for an agent than snapshots. End with a go/no-go.

## The model

[`outlook-extension.js`](outlook-extension.js) is installed as
`<data>/site-extensions-poc/<host>.js`. It was written by studying the page once: every DOM probe
used for that returned only roles, attribute names, counts and text lengths, never mailbox text.

| Member | What it does |
|---|---|
| `folder`, `folders[name]` | Current folder; folders from `[role=treeitem][data-folder-name]` (deduplicated, Favorites repeat them). `folders[i].open()` |
| `messages`, `messages[i]` / `messages["<id>"]` | Rendered rows `[role=option][data-convid]`: id, sender, senderEmail, subject, date, unread. Headers only. Summary carries `visible` and `total` (from `aria-setsize`) |
| `read(id)` / `messages[i].read()` | Opens the message, waits for the reading pane, returns headers + body text (20,000-character cap) |
| `open(id)` | Selects a message |
| `search(text)` | Types into Outlook's search box and waits for a different result set |
| `scrollMessages("down"\|"up"\|"top")` | Pages the virtualized list |
| `openFolder(name)` | Clicks a folder |

Nothing sends, moves or deletes mail. `refresh()` fires when the list or the folder tree goes
between empty and non-empty. `notify()` reports new mail without its content (see the matrix).

Selectors are roles and data attributes only. The one positional assumption is the order of text
spans in a row (sender, subject, date, preview), with the date found by its parseable `title`.

## Reliability matrix

Host `outlook.cloud.microsoft` (Outlook's current host — the epic's list predates it). Times are
from the navigation start; "model" is the first registration, "list" the refresh once Outlook
rendered the message rows.

| Case | Result | Injected | Model | List |
|---|---|---|---|---|
| Soft reload | Pass | 60–145 ms | 108–196 ms | 1.3–1.9 s |
| Hard reload (ignore cache) | Pass | 393 ms | 394 ms | 1.8 s |
| Folder switch inside the app | Pass. Same document; model persists, `folder` follows | — | — | — |
| Open a message | Pass. In-document navigation; model persists | — | — | — |
| Back / forward inside the app | Not applicable: Outlook uses `replaceState`, so there is no in-app history | — | — | — |
| Back across documents (Outlook → example.com → back) | Pass. Re-injected | 183 ms | 275 ms | 1.4 s |
| Arrival from another host (login page → Outlook) | Pass | 56 ms | 107 ms | 1.4 s |
| `outlook.office.com` | Pass. Server-redirects to `outlook.cloud.microsoft`, injected there | 156 ms | 195 ms | 1.4 s |
| `outlook.office365.com` | Injected into the intermediate document, then redirected to the account picker on `login.microsoftonline.com`. The brief registration is cleared on navigation. Harmless; the sign-in page was not touched | 155 ms | 164 ms | — |
| `outlook.live.com` | Not tested (consumer accounts; no account available) | | | |
| First load after an actual sign-in | Not tested: it needs signing out of the user's account. Covered by "arrival from another host", which is the same document navigation | | | |
| Session restore (app restart) | Pass. Times from renderer start | 1.62 s | 1.63 s | 2.9 s |
| Two tabs on the same host | Pass. Each tab injected and registered on its own; `editor.app` follows the active tab | | | |
| Background tab made active | Pass. The model answered immediately | | | |
| Private tab | Pass. Agent-opened Incognito page on the Outlook host: no injection, no runtime, no `__aiVision` | | | |
| Virtualized list | Pass. 35 `scrollMessages("down")` pages covered all 294 messages, matching `total`, in 14 s. Each page has 9–11 rows rendered | | | |
| Late model (US-1602 fix) | Pass. A test extension that published after 3 s was found at 3,016 ms | | | |
| Stale model | No refusal in ~40 agent calls across 14 shape changes: the re-probe finishes before the agent's next call. An in-tick refusal was not measured | | | |
| New mail while open | Pass. `notify()` fires about 10 s after a new row is inserted at the top: tested by sending a message while viewing Sent Items, with the `unread` condition temporarily removed, since sent rows are read. No false notify across scrolling, search and folder switches with the real script. Two earlier versions were wrong: "the first row changed" fired on scroll-to-top, and `aria-posinset` marks only the focused row. Position comes from layout now. No real incoming mail arrived during the test window | | | |
| Long idle; sleep and wake | Not tested in this session | | | |
| Page console | Pass. No `console.error` from the extension. The only uncaught page errors are `ResizeObserver loop completed with undelivered notifications`: 2 in 25 s idle, 12 during fast scrolling. Outlook's own virtual list emits them | | | |

## Agent cost: model vs snapshots

Measured on the same page state (character counts; about four characters per token).

| Question | Through the model | Through snapshots |
|---|---|---|
| "What is in my inbox?" (8 visible rows) | `messages`: 2,184 chars, plus a one-time hint of about 900 | full snapshot 13,810; interactive 9,202; list-rooted 7,519 — and the snapshot also carries the previews |
| Read one message | `read(id)`: 346 chars | click, then snapshot: 6,456 chars |
| All 294 headers | 35 × (`scrollMessages` + `messages`) ≈ 77,000 chars | 35 × (scroll + list snapshot) ≈ 263,000 chars, plus parsing ARIA labels |

So the model is 4–6 times cheaper for a list, about 19 times cheaper for a body, and needs no
parsing. It also returns less sensitive data, since previews never leave the page unless asked.

## Go / no-go

**Go.** The injected model loaded on every document path tested, survived reloads, cross-host
arrival and session restore, needed no page cooperation, was not blocked by the Content Security
Policy, and stayed out of private tabs. The open items (a real sign-in redirect, long idle and
sleep, `outlook.live.com`) show no sign of failure. They are covered by the
same document lifecycle that passed, and should be rechecked in US-1604.

## Changes US-1604 onward need

1. **Host matching is a list, not one host.** Outlook alone spans `outlook.cloud.microsoft`,
   `outlook.office.com` and `outlook.office365.com`. The manifest should take several exact hosts.
2. **Inject with CDP `Runtime.evaluate` on `dom-ready`**, after attaching the AI-vision binding, then
   probe. Keep the private-page rule strict: `isIncognito || isTor` with no agent exception.
3. **Intermediate redirect documents get injected.** This is harmless, because registration is
   cleared on navigation. The store must not treat an injection as a sign the model is usable.
4. **Shape-changed noise.** Each `refresh()` logs `shape-changed` to the agent, even when the shape
   is identical. One search logged two. The host should compare the new shape with the old and log
   nothing when they match.
5. **In-document navigation noise.** Opening a message or switching folder logs "browser page
   navigated" although the model is unaffected. Consider not logging a same-document navigation for
   a tab with a live model.
6. **Duplicate probe.** The post-injection probe and the load probe often both register the same
   version. Harmless; deduplicate when convenient.
7. **Authoring guidance (US-1607):**
   - Call `refresh()` once after a late `expose()`.
   - The scroller of a virtualized list may sit inside the `listbox`.
   - Wait for a changed result set, not merely a non-empty one: Outlook swaps lists in place.
   - Report new items by layout position (scrolled to the top) and a seen-set, not by "the first
     row changed". ARIA position attributes may mark only the focused row.
   - The PoC's DOM-study technique worked: probe scripts that return structure, never text.
8. **Reload in place (US-1606)** needs a new document today, because injection is per document. A
   dev reload that re-evaluates into the same document needs `dispose()` of the old remote first.
9. **Runtime size.** At 52 KB per document it is acceptable. Minify it for production.

## Test data

Every check that read mail used test messages the agent sent to the user's personal address:
three of them, with subjects marked `PSPH-POC` and marker words in the bodies. No other mailbox content
was read into the agent's context or recorded here.
