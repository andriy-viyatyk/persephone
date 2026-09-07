# Malformed input and error quality

The surface exercised here is not a screen. It is **what `call` says when the caller gets it
wrong** — the axis an external evaluation of Persephone 5.0.0 found to be the weakest thing about
an otherwise good design (EPIC-091, and its
[source report](../../doc/epics/EPIC-091-evaluation-report.md)).

Every other file in this suite asks *can an agent drive this screen?* This one asks the question
that only shows up when something fails:

> When a call is wrong, does the caller learn what was wrong, what would be right, and what it cost
> to find out?

That makes this file different in two ways. Its scenarios deliberately submit bad input, so a
scenario that "works" is one where the call **fails well**. And its assertions are about the *text*
of an error, not about on-screen state — which is exactly why it doubles as a regression suite: an
error message that quietly loses its valid-value list after a refactor is a defect no build or
typecheck will catch.

## Why these scenarios exist

The external evaluation found three clusters (EPIC-091's Overview): one correctness bug in
`logView.push`, hint economics that made six typos cost more context than every successful call in
the session combined, and a class of twelve calls that returned `[]`, `null` or `false` for input
that was simply wrong — indistinguishable from a legitimate empty result. M.1 to M.6 below cover the
fixes; M.7 covers the behaviours the report said were already good and must not regress.

## Rules

- **Scratch pages only.** Several scenarios create a page to get a grid or a dirty close. Close
  every page the scenario created, and **never close, modify, activate or otherwise interact with a
  pinned tab** or any page that existed before the run.
- **The Log View is shared state.** A scenario that pushes entries clears them afterwards with
  `pages.logView.clear()`.
- **Start from discovery.** As everywhere in this suite, the runner's first operation is `call` with
  no `path`. An agent that already knows the answer is not testing the documentation.
- **Do not answer a trust or consent dialog.** An unsaved-changes prompt raised by a scenario's own
  scratch page may be answered with **Don't Save**, because the scenario created the page and its
  content is throwaway. Nothing else.
- **Token cost is a result here.** M.2 asserts response *size*, so record the approximate size of
  the hint blocks rather than only whether the call failed.

## Coverage ledger

| Scenario | Report items | What it proves |
|---|---|---:|
| M.1 the output channel takes one entry | 1.1 | 1 |
| M.2 a typo costs one line, not a member list | 1.2, 3.8 | 2 |
| M.3 wrong arguments fail instead of returning nothing | §2 (12 rows) + `deleteRows` | 13 |
| M.4 numeric bounds | 1.3, 1.7 | 2 |
| M.5 a large structured result can be bounded | 1.6 | 1 |
| M.6 unknown enum-ish values and returned-object paths | 1.4, 1.5, 3.1, 3.2 | 4 |
| M.7 the preserve list | §4 | 9 behaviours |

---

## M.1: The output channel takes one entry, and refuses nonsense

**Request:** "Write the single line `deployment finished` to Persephone's output channel for me,
then tell me how many entries the channel holds."

**Start:** The runner's first operation is `call` with no `path`.

**Why:** `pages.logView.push("deployment finished")` used to iterate the string and write **one
`log.info` entry per character** — twelve characters, twelve log lines, reported as success. It is
the primary documented output channel, and a plain string is documented shorthand for `log.info`,
so this corrupted user-visible output rather than merely erroring badly.

**Expected paths:** Bare overview → `pages` → `pages.logView.push` → `pages.logView.entries`.

**Assert:**
- `push("deployment finished")` returns **exactly one** `entryIds` value and `dialogIds: []`.
- `pages.logView.entries` holds one entry whose text is the whole string, not a character.
- A lone entry *object* — `push({ type: "log.info", text: "one" })` — also produces exactly one
  entry. Passing a single item where a batch is expected is the same mistake by another route.
- `push(123)` **errors**, naming the value and its runtime type and giving an accepted shape. It
  must not return `{ entryIds: [], dialogIds: [] }`: a success-shaped result for input that did
  nothing is the failure this whole file exists to catch.
- `push([{ type: "log.info", text: "ok" }, 123])` writes **nothing at all** — normalization is a
  full first pass, so a bad element cannot leave earlier entries applied and then throw.

**Cleanup:** `pages.logView.clear()`.

---

## M.2: A typo costs one line, not a member list

**Request:** "Read `pagez` for me, then read `Pages`, then read `pages.qqqqqqqq` twice. Tell me what
each one said."

**Start:** The runner's first operation is `call` with no `path`.

**Why:** the `hints` parameter is documented as `auto` / `always` / `never`, but on the error path it
was not consulted at all and `auto`'s once-per-session dedupe was bypassed. In the evaluated session
the complete root member list — about 2,400 tokens — was re-emitted on **six** separate failures.
Near-match suggestions are what make the dedupe safe rather than a trade: the epic keeps the member
list as the surface's self-teaching mechanism, so a suggestion has to be *better* than the dump for
the case it covers, not merely cheaper.

**Assert:**
- `pagez` returns a one-line error naming candidate members — `Did you mean "pages" or "page"?`.
  Both are one edit away, and naming both is right: a tie is not ignorance, and suppressing the
  suggestion would send the full dump for the single most likely typo on the surface.
- `Pages` (case-only) suggests `pages`. Case is special-cased ahead of edit distance.
- The suggestion is part of the **error**, not the hint block, so it survives `hints: "never"`.
- With `hints: "never"`, none of these emits a member list, and the error text plus
  `resolved up to "..."` still appear.
- `pages.qqqqqqqq` — no near match — **does** return the complete `Pages` member list the first
  time. This is report §4's preserve behaviour and the epic's abort criterion for the task.
- The **second** unknown member of the same kind returns only the kind summary and
  `Details: call with path "pages.$help"` — a few lines, not the list again.
- `hints: "always"` repeats the member list for a no-near-match failure.

**Record:** the approximate size of the first `pages.qqqqqqqq` response and of the second. The
point of the scenario is the ratio.

**Cleanup:** none.

---

## M.3: Wrong arguments fail instead of returning nothing

**Request:** "Try each of these and tell me exactly what came back: search the help for the number
123; search the tools for the number 12345; close the page `no-such-page-id`; read `version` while
passing an argument."

**Start:** The runner's first operation is `call` with no `path`.

**Why:** this is the report's biggest systemic finding. Twelve calls returned `[]`, `null` or
`false` for input that was simply wrong, so an agent could not tell "you called it wrong" from
"there was nothing there" and would confidently report a no-op as done.
`tools.search(12345)` was the worst: a malformed query returned the *entire* tool catalogue, which
looks plausible.

**Assert** — every one of these errors, and every message names the rejected value **and its actual
type**:
- `helpSearch` with `args: []` (query required), `helpSearch(123)`, `helpSearch(null)`,
  `helpSearch({query:"grid"})` (positional expected), `helpSearch("grid","not-a-number")`, and
  `helpSearch("grid","x","extra","more")` (too many arguments — a method with wrong arity throws).
- `tools.search(12345)`. It must **not** return the catalogue. `tools.search()` with no argument
  still legitimately returns it, and a valid keyword matching nothing still returns an empty result
  — the scenario must confirm both, or it has proved only that something broke.
- `pages.closePage("no-such-page-id")` errors and **lists the open page ids**, matching its sibling
  `showPage`. It no longer returns `false`.
- On a grid page: `editor.addRows("five")`, `editor.addRows(-3)`,
  `editor.editCell("nocol","norow","x")`, and `editor.deleteRows(["nosuchkey"])` — the last of which
  the report itself missed while praising it.
- `version` with `args: ["unexpected"]` returns **`"5.0.0"` plus a warning**, and `isError` is not
  set. A property's value is unambiguous, so the read succeeds and the caller is told; only a
  *method* given the wrong arity throws.

**Setup/cleanup:** create one scratch grid page (`pages.addEditorPage("grid-json", "json", ...)`)
for the grid rows; close it by its returned id afterwards, answering an unsaved-changes prompt with
**Don't Save**.

---

## M.4: Numeric bounds

**Request:** "Search the help for `grid` with a limit of -5, and tell me how many results that
returns compared with no limit at all. Then read `version` with `maxLength` 0."

**Why:** `limit` reached `slice(0, limit)` unchanged, and a negative slice index drops entries off
the **end** — so `helpSearch("grid", -5)` returned 7 results where the unlimited call returns 12.
Separately, `maxLength` and `windowIndex` were declared as unbounded integers, so the published
schema advertised zod's integer range and `maxLength: 0` reached the resolver.

**Assert:**
- `helpSearch("grid", -5)` returns **1** result, not `12 - 5`. A correctly typed numeric limit has
  an unambiguous intent ("give me at least one"), which is why this clamps rather than throws;
  wrong *types* still error, per M.3.
- `helpSearch("grid", NaN)` does not return `[]`. A non-finite limit falls back to the default —
  `Math.max(1, NaN)` is `NaN`, which would have preserved the same bug in a new disguise.
- `maxLength: 0` and `maxLength: -10` are refused **by the schema**, before the handler runs, with a
  message naming the bound (`expected number to be >=1`).
- `windowIndex: -1` is refused the same way (`>=0`).

**Cleanup:** none.

---

## M.5: A large structured result can be bounded

**Request:** "Search the help for `grid`, but keep the response under about 500 characters."

**Why:** `maxLength` applied only to top-level strings. Its description said so, which made this
as-specified — and as-specified was the problem, because `boards`, `tools.search`, `entries` and
`rows` are exactly where a context blowup comes from and none of them had a caller-controllable
bound.

**Assert:**
- The result is **valid, parseable JSON** — a truncated array of whole elements, never a spliced
  token.
- It reports how much was withheld: `showing N of M items`.
- The same call without `maxLength` returns everything, so the default of 20000 is unchanged and no
  existing caller sees a difference.
- A `maxLength` too small for even one element yields an empty collection of the right kind rather
  than malformed output.

**Cleanup:** none.

---

## M.6: Unknown enum-ish values, and following a hint to a returned object

**Request:** "Make me a JSON grid page called `Lang Check` — but first try it with the language
`nonexistent-language` and tell me what happens. Then, from whatever the successful call returned,
add two rows and change a cell, and tell me the page's final row count."

**Why:** four separate traps. An invalid **language** silently downgraded the requested editor to
monaco and stored the bogus value verbatim, so the call reported success and the mistake only
surfaced later when `editor.addRows` did not exist. The hint for a **returned object** addressed it
by the path of the method that produced it, so following the hint reached a method descriptor
instead of an editor. `addEditorPage`'s fourth `content` argument was **dropped by the wrapper**
while the arity error advertised it. And **row keys** — required by `editCell` and `deleteRows` —
were held in an off-object map and exposed nowhere, so an agent had to guess them.

**Assert:**
- `addEditorPage("grid-json", "nonexistent-language", ...)` **errors**, names the value, and points
  at `editors.languages`. It does not return a monaco page.
- `addEditorPage("grid-json", "typescript", ...)` still returns a **monaco** page, silently. A real
  language the editor does not handle is a legitimate fallback, not an argument error; conflating
  the two is the bug.
- `page.language = "also-nonexistent-language"` errors too — the same mistake by another route.
- The returned page's hint advertises its children under `pages["<the new page id>"]`, and **that
  path resolves**. Following it must reach the editor facade, not a method descriptor.
- `addEditorPage("monaco", "plaintext", "T", "initial text")` puts `initial text` into
  `page.content`. The descriptor, the arity error and the declaration all show four parameters.
- `editor.rowKeys` returns keys in the same order as `editor.rows`, and feeding one straight into
  `editCell` succeeds. This is the loop an agent previously had to guess at.
- `editor.addRows(2)` returns two sparse `{}` rows. This is the grid's intended representation, not
  a defect — assert it so a later change does not "fix" it.

**Cleanup:** close every page the scenario created, by returned id, answering an unsaved-changes
prompt with **Don't Save**. Verify absence from `pages`.

---

## M.7: The preserve list

**Request:** none — this is a checklist run against the calls the scenarios above already made,
plus the two probes named below.

**Why:** report §4 lists the behaviours an outside evaluator found *good*, which makes it the
regression surface for everything EPIC-091 changed. The hint work in M.2 is the most likely thing to
damage it.

**Assert each of these still holds:**
1. **Discovery works.** Bare overview → `children (live)` → `$help` navigates the model with no
   guide read.
2. **`resolved up to "..."`** appears on every error, localizing which segment failed.
3. **An unknown member returns the valid member list** — on first encounter for its kind (M.2).
4. **Valid values are enumerated** for an unknown editor id, an unknown AiVision element name, and
   an unknown tool id.
5. **`args` + `value` together** produces a clear error that carries **no hint block**. That
   restraint is deliberate; check it did not acquire one.
6. **A method path with no `args` returns a descriptor** rather than firing the method — the safe
   default for a destructive surface.
7. **`[CAUTION: ...]`** annotations are still present on mutating members.
8. **The unsaved-changes interception.** Closing a modified scratch page returns the *pending*
   result with its attention text naming the buttons and instructing the agent not to discard the
   user's work unprompted. The report called this the standout behaviour of the whole surface, and
   it is an explicit abort criterion of the epic: `closePage` gained argument validation, and the
   pending path had to survive it untouched.
9. **The `openUrl` / `openUrlInBrowserTab` split** still warns that the page id returns *before* the
   document loads and that a `waitFor` is required.

**Cleanup:** close the scratch page created for check 8 (**Don't Save**).
