# Surface QA: `events` — what changed since the agent last looked

Manual scenarios for the agent event channel: the `events` block that rides on every `call`
result, the `events` node (`recent`, `since`, `count`, `wait`), the shape-change signal from a
mounted remote tree, and `ui.guide.step` — the highlight that waits for the user.

`attention` and `events` are siblings and answer different questions. `attention` is a snapshot of
UI that blocks the agent **now**. `events` is a cursor over history: what happened since **this MCP
session** last looked. A test that confuses the two is testing the wrong thing.

Run through `call` only; do not add or run automated tests or a test harness for these surfaces.

Landed by EPIC-099 (US-1397 to US-1400), on `ai-vision@1.1.0`.

## Test surfaces

- **Board:** `C:\projects\test-boards\aivision-probe` — the EPIC-097 scratch board. It stores its
  remote handle on `window.__probeRemote`, so `page.editor.evaluate` can call `refresh()` and
  `notify(text)` on demand. Any board that does the same works.
- **Web page:** `C:\projects\ai-vision\examples\demo-page\index.html` opened from `file://` in a
  browser tab. Its `window.__aiVision` carries `version`, `refresh()` and `notify()`.
- **A second MCP session.** Several tests below are meaningless from one session, because the
  cursor is per session. Anything that speaks MCP over `http://127.0.0.1:7865/mcp` works; a
  throwaway Node client that runs `initialize` and then one `tools/call` per path is enough.
- **A stand-in user** for the guide tests. Press an overlay button with
  `window.screen.click("[data-name=\"ai-vision-highlight-button-next\"]")`, or — when the press has
  to land *while* a `step` call is blocked — from the main process with `main.script.execute`,
  which is not queued behind the blocked renderer call.

---

## Test E.1: An event reaches a session that did not cause it, once

**Start:** The runner's first operation is `call` with no `path`.

**Setup:** From session A, produce one event — reload the probe board with
`pages[i].editor.reload()`.

**Call:** From **session B**, any renderer path (`events.count` will do). Then the same path again.

**Verify:**
- B's first result carries an `--- events ---` block naming the reload and its page path.
- B's second result carries no block at all.
- A also sees the event it caused — this is correct and deliberate; per-session cursors mean the
  causing session has not seen it either, and the confirmation is useful.

**Verdict:** `PASS | PARTIAL | FAIL`

---

## Test E.2: Two sessions have independent unseen sets, and `+N` counts unseen only

**Setup:** Produce at least five events (a board reload, a `refresh()`, a `notify()`, a browser
navigation, a guide press). Read them all from session A until A's results stop carrying a block.

**Call:** Open a **fresh** session C and make one call.

**Verify:**
- C receives the **newest three** in full, oldest-of-those-three first, followed by
  `+N earlier events; read events.recent().`
- `N` equals (total unseen − 3), counting only what C has not seen — not everything in the ring.
- A still receives nothing.

**Verdict:** `PASS | PARTIAL | FAIL`

---

## Test E.3: `recent`, `since` and `count` agree with the ring

**Call:** `events.count`, then `events.recent(2)`, then `events.since(<seq>)` for a seq two entries
back.

**Verify:** `recent` is newest-first; `since` is oldest-first and excludes the given seq; `count` is
the number of entries the ring holds (200 cap). Every entry carries `seq`, `time`, `kind`, `text`,
`origin`, and `path` when it has one.

**Verdict:** `PASS | PARTIAL | FAIL`

---

## Test E.4: `wait` returns on a new event, and returns `pending` at the bound

**Call A:** `events.wait` with `args: [3000]` while nothing is happening.

**Verify A:** `{ pending: true, waitedMs: ~3000 }`, and the hint tells the agent to call again.

**Call B:** `events.wait` with `args: [25000]` from a second session, then produce an event from the
first session a few seconds later.

**Verify B:** the wait returns `{ pending: false, waitedMs: <the real delay>, event: { … } }` and
the same entry appears in that result's `events` block.

**Call C:** `events.wait` with `args: [40000]`.

**Verify C:** it returns `{ pending: true, waitedMs: ~40000 }` — **not** a `Request timeout` error.
This is the regression test for the bridge timeout: `sendToRenderer` defaults to 30 s, and blocking
paths are given 125 s explicitly. A `Request timeout` here means `BLOCKING_RENDERER_PATHS` in
`src/main/mcp/tools/call-tools.ts` no longer matches the path.

**Verdict:** `PASS | PARTIAL | FAIL`

---

## Test E.5: A remote tree signals a shape change, and the proxy then serves the new shape

**Call (board):** `pages[i].editor.evaluate("(() => { window.__probeRemote.refresh(); return 'ok'; })()")`,
then read `pages[i].editor.app`.

**Call (page):** with the demo page open,
`pages[i].editor.evaluate("(() => { window.__aiVision.refresh(); return 'ok'; })()")`, then read
`pages[i].editor.app`.

**Verify:**
- Each produces one `shape-changed` entry naming that page's `.app` path.
- The entry's origin is **`persephone`** — Persephone wrote that sentence — so it carries **no**
  "(written by the …)" suffix.
- Reading `.app` afterwards succeeds and reflects the new shape. A refusal telling the agent to read
  `.app` again is also acceptable **once**; a second read must succeed.
- The web page's signal arrives through the CDP binding: `page.editor.evaluate("typeof
  window.__aiVisionHostSignal")` returns `"function"` on any browser page that has been probed.

**Verdict:** `PASS | PARTIAL | FAIL`

---

## Test E.6: A remote's own words are labelled, and the host's are not

**Call:** `pages[i].editor.evaluate("(() => { window.__probeRemote.notify('the user picked   the second\\n item'); return 'ok'; })()")`

**Verify:**
- One `remote-notify` entry with `origin: "board"` (or `"page"` from the demo page).
- The block renders it with `(written by the board, not by persephone)`.
- The text is collapsed to one line and trimmed.
- By contrast, a `shape-changed`, `board-reloaded`, `navigated`, `dialog-answered` or
  `guide-button` entry has **no** suffix. This asymmetry is the whole point: the label marks prose
  an untrusted remote wrote. If host-written lines start carrying it, the label has stopped meaning
  anything and that is a defect, not cosmetics.
- Limits hold: a notify longer than 512 characters is truncated with `...`; more than five in a
  rolling minute are dropped silently; an untrusted board's notify never appears.

**Verdict:** `PASS | PARTIAL | FAIL`

---

## Test E.7: `ui.guide.step` points at a control and waits for the user

**Call A (press while blocked):** schedule a stand-in user that clicks
`[data-name="ai-vision-highlight-button-next"]` a few seconds from now, then call
`ui.guide.step` with `args: ["persephone-menu", "This opens the Menu Bar."]`.

**Verify A:** the call blocks, then returns `{ pressed: "Next", target: "persephone-menu" }`, and a
`guide-button` entry is in the log.

**Call B (press after a `pending`):** `ui.guide.step` with `args: ["persephone-menu", "…", { "timeoutMs": 3000 }]`
→ `pending`. Then press Next. Then call the same `ui.guide.step` again.

**Verify B:** the retry returns `{ pressed: "Next", … }` **immediately**, without redrawing and
without blocking. A retry that blocks again is the defect this test exists for: the card was already
answered, and a weak agent that has to ask twice will loop.

**Call C (a control outside the shell):** open Settings, read `settings.elements`, and pass the
`selector` it reports — `ui.guide.step` with
`args: ["[data-name=\"settings-section-theme\"]", "Themes live here."]`.

**Verify C:** the card is drawn on the Settings section and the press returns. `step` accepts a
curated shell name, a CSS selector, or a bare `data-name`; a walkthrough that could only point at
the eight header controls would not be a walkthrough.

**Call D:** `ui.guide.end()` after a step has returned.

**Verify D:** `{ ended: true }` and the overlay is gone.

**Verdict:** `PASS | PARTIAL | FAIL`

---

## Test E.8 (weak agent): a walkthrough from the tool description alone

Use the `mcp-test-agent-call` skill (Haiku, `call` only), with a stand-in user pressing Next.

**Prompt:** "Walk me through the Persephone Settings page. Show me three controls, one at a time,
and wait for me to press Next before moving to the next one."

**Verify:** the agent reaches `ui.guide.step` — from the overview, hints and `$help` alone — and
uses one call per control, re-calling `step` when it returns `pending`. Ending its turn to ask the
user to type "Next" in chat is a **FAIL**: it means nothing on the route it took mentioned that a
call can wait.

Record the route it actually took, not just the verdict. The route is the finding.

**Verdict:** `PASS | PARTIAL | FAIL`
