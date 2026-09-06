# EPIC-091 source — external MCP evaluation of the `call` surface

> Preserved verbatim from an independent evaluation run by an agent with no prior knowledge of
> this project. The only edit is the removal of the user's page titles from the appendix.
> EPIC-091 ([EPIC-091.md](EPIC-091.md)) is the response to this report; the "Report items not
> acted on" table there records every claim this epic deliberately left alone, and section 4
> ("What works well") is the list of behaviours the epic must not regress.

---

# Persephone MCP — Evaluation Report

**Date:** 2026-09-07
**Version tested:** Persephone 5.0.0
**Surface:** single tool `mcp__persephone__call` (path / args / value / hints / maxLength / windowIndex)
**Method:** discovery from the root overview, then deliberate malformed calls — unknown members, typos, wrong arg types, wrong arity, out-of-range indices, bad enum values, invalid paths, conflicting parameters.

---

## Overall impression

The path-based single-tool design is genuinely good. Discovery works: the overview plus `$help` plus live `children` made the whole model navigable without reading a single guide, exactly as the tool description promises. The best error messages here are better than most MCP servers ship — `logView.push`, `addEditorPage`, `tools.execute`, `deleteRows`, `highlight` and `showPage` all name the invalid value, list the valid ones, and give a copy-paste example.

The problems are not in the design; they cluster in three places:

1. **A real correctness bug in `logView.push`** — the primary documented output channel.
2. **Hint economics** — error responses ignore the `hints` setting and re-send full member lists, which dominates token cost.
3. **Inconsistent input validation** — roughly half the surface validates beautifully; the other half silently swallows bad input and returns an empty/null result that is indistinguishable from a legitimate "nothing found".

---

## 1. Bugs

### 1.1 `logView.push("...")` splits a string into one entry per character — HIGH

`push` is documented as accepting entries where "A plain string is shorthand for log.info". Passing a bare string to `push` itself iterates it as characters.

```
path: "pages.logView.push", args: ["not-an-array"]
→ { "entryIds": ["1","2",...,"12"], "dialogIds": [] }
```

`pages.logView.entries` confirmed 12 separate `log.info` entries: `"n"`, `"o"`, `"t"`, `"-"`, `"a"`, … Twelve characters, twelve log lines.

Cause is almost certainly a spread/`Array.from` over the argument without an `Array.isArray` guard — a string is iterable, so it splats. This is the one finding that corrupts user-visible output rather than just returning an unhelpful error.

**Suggested fix:** in `push`, guard explicitly — `Array.isArray(entries) ? entries : [entries]`. That also makes `push("done")` do the intuitive thing (one info line) instead of failing, which fits the documented string shorthand.

### 1.2 `hints: "never"` is ignored on error responses — HIGH (cost, not correctness)

The parameter is documented as `auto` (member list once per session), `always`, `never`. On the error path the setting is not consulted at all:

```
path: "nosuch", hints: "never"
→ Error: "nosuch" is not a member of Persephone.
  --- hint (Persephone) --- <full ~2,400-token member list>
```

Worse, `auto`'s once-per-session dedupe is also not applied to errors. In this session the complete root member list was re-emitted on **six** separate failures (`pagez`, `Pages`, `version` not-writable, `pages..logView`, `pages[0`, `pages[1.5]`). Each is ~2.5k tokens, so a handful of typos cost more context than all the successful calls combined.

**Suggested fix:** route error hints through the same dedupe/`hints` gate as success hints. On a repeat failure for an already-seen kind, emit only the one-line summary plus `Details: call with path "$help"`. Even better for the not-writable and unknown-member cases: emit only the *relevant* subset (writable members / near-matches), not all 22.

### 1.3 Negative `limit` in `helpSearch` truncates from the end — MEDIUM

```
helpSearch("grid")      → 12 results
helpSearch("grid", -5)  →  7 results
helpSearch("grid", 0)   →  0 results
```

12 − 5 = 7. The limit is being passed straight into `slice(0, limit)`, so a negative value silently drops entries off the *end* of the result set. Should be clamped to ≥ 1 or rejected.

### 1.4 An invalid `language` silently downgrades the requested editor — MEDIUM

```
pages.addEditorPage("grid-json", "nonexistent-language", "Bad Lang Test")
→ { "editor": "monaco", "language": "nonexistent-language", ... }
```

I asked for `grid-json` and got `monaco`, with no warning. The bogus language was stored verbatim. The same call with `"json"` correctly yields `grid-json`, so the language lookup failing is what silently overrides the explicit editor choice.

This is the worst kind of failure for an agent: the call reports success, and the mistake only surfaces later when `editor.addRows` doesn't exist. Note the contrast — an invalid **editor** id produces an excellent error listing all 32 registered editors. Invalid **language** should do the same (or at minimum keep the requested editor and warn).

Assigning a bogus language directly is equally unvalidated: `page.language = "also-nonexistent-language"` → `{ ok: true }`.

### 1.5 Hints for a returned object use the call path, producing a dead path — MEDIUM

`addEditorPage` returns a Page, and the hint advertises its child as:

```
children (live):
  pages.addEditorPage.editor — GridEditor: facade for the current editor (grid-json)
```

Following that path does not reach the editor — it re-describes the method:

```
path: "pages.addEditorPage.editor"
→ { "kind": "method", "signature": "addEditorPage(editor, language, title)", ... }
```

The hint should address the object by its real identity, `pages["<new-page-id>"].editor`. As written it actively misleads: an agent that trusts the hint follows a path that silently returns the wrong kind of thing rather than erroring.

### 1.6 `maxLength` does not apply to array/object results — MEDIUM

`maxLength: 400` on `helpSearch("grid")` returned the full ~4,000-character array with no `truncated` flag. The description does say "Cut **string** results", so this is arguably as-specified — but it leaves no way to bound the cost of a large structured result, which is exactly where the blowup risk lives. `boards`, `tools.search`, `entries` and `rows` can all be large.

**Suggested fix:** apply `maxLength` to the serialized JSON, truncating the array and reporting `shown: n, total: m`.

### 1.7 `maxLength: 0` and negatives are accepted — LOW

```
path: "version", maxLength: 0   → [truncated: showing 0 of 5 chars — raise maxLength]
path: "version", maxLength: -10 → [truncated: showing 0 of 5 chars — raise maxLength]
```

The JSON schema declares `minimum: -9007199254740991` for both `maxLength` and `windowIndex`. Neither can meaningfully be negative — `minimum: 1` and `minimum: 0` would let the MCP layer reject these before they reach the resolver.

---

## 2. Silent no-ops — bad input returns an empty result instead of an error

This is the biggest *systemic* issue. These all return `[]`, `null` or `false` — indistinguishable from a valid empty result — so an agent cannot tell "you called it wrong" from "there was nothing there", and will confidently report a no-op as done.

| Call | Result | Expected |
|---|---|---|
| `helpSearch` with `args: []` | `[]` | error: `query` is required |
| `helpSearch(123)` | `[]` | error: `query` must be a string |
| `helpSearch(null)` | `[]` | error: `query` is required |
| `helpSearch({query:"grid"})` | `[]` | error: positional args expected |
| `helpSearch("grid","not-a-number")` | `[]` | error: `limit` must be a number |
| `helpSearch("grid", "x", "extra", "more")` | `[]` | error/warn: too many arguments |
| `grid.addRows("five")` | `[]` | error: `count` must be a number |
| `grid.addRows(-3)` | `[]` | error: `count` must be ≥ 1 |
| `grid.editCell("nocol","norow","x")` | `null` | error: unknown column/row key |
| `tools.search(12345)` | **all 5 tools** | error: `query` must be a string |
| `version` with `args: ["unexpected"]` | `"5.0.0"` | warn: property takes no arguments |
| `pages.closePage("no-such-page-id")` | `false` | error listing open page ids |

The `closePage` row is the sharpest illustration of the inconsistency: **`showPage("no-such-page-id")` returns a first-class error that lists every open page id, while its sibling `closePage` with the identical bad input just returns `false`.** Two methods, same argument, same failure, completely different diagnostic quality.

`tools.search(12345)` deserves separate mention — silently returning the *entire* tool catalog for a malformed query is worse than returning nothing, because the result looks plausible.

**Suggested fix:** you already have an argument-validation helper producing excellent messages (`addEditorPage`, `deleteRows`, `openUrl`, `highlight` all use it). Apply it uniformly. The pattern in `deleteRows` — *"rowKeys must be an array of row keys — what getRowKey returns, not row objects or indices"* — is the standard the rest of the surface should meet.

---

## 3. Documentation and consistency issues

### 3.1 `addEditorPage` signature disagrees with itself
Hints and the method descriptor both say `addEditorPage(editor, language, title)`. The arity error says `(editor, language, title, content?)` and its example passes four arguments. A fourth parameter that is useful (initial content, avoiding a second round-trip) is documented only in an error message you have to trigger deliberately.

### 3.2 Row keys are required but never exposed
`deleteRows` and `editCell` take row keys. `grid.rows` returns `[{ "a": null }, {}, {}]` and `addRows(2)` returns `[{}, {}]` — no key in either. The error message points at `getRowKey`, which is not reachable through the MCP surface, and `GridEditor.$help` never defines what a row key is.

Empirically they are index strings (`deleteRows(["0"])` dropped `rowCount` 3 → 2), but I had to guess. Either return keys alongside rows, or state the key format in `$help`.

Also inconsistent: rows added via `addRows` come back as `{}` while the pre-existing row is `{ "a": null }` — new rows don't carry the declared columns.

### 3.3 Broken quoting in the `output.grid` examples
Three separate `logView.push` errors show:

```
Example: { type: "output.grid", content: "[{"name":"A","value":1}]", title: "My Table" }
```

The nested double quotes are unescaped, so the example is not valid JS or JSON. Since these examples exist precisely to be copied, they should use single quotes outside or escaped quotes inside.

### 3.4 `settings` is described as read/write but `theme` is read-only
Root hint: `settings - read or persist application configuration; e.g. settings.theme`, and the member line says "Application settings (read/write)". The one property used as the example is `readonly` (correctly refused on assignment). Using a writable key in the example would avoid sending agents down a dead end.

### 3.5 Return shapes are inconsistent across mutations
`page.language = x` → `{ ok: true }`; `closePage` → `true`/`false`; `logView.clear()` → `null`; `editCell` → `null`; `dialogs[0].click()` → `true`. Four shapes for "it worked". A uniform `{ ok: true }` (or uniform `null`) for void operations would make results machine-checkable.

### 3.6 `script.execute` reports failures two different ways
A bad `code` **parameter type** is an MCP error:
```
script.execute(42) → Error: Missing or invalid 'script' parameter
```
A **syntax or runtime error inside the code** is a *successful* MCP result carrying `isError: true`:
```
script.execute("1 +")                     → { text: "Error: Unexpected token ')'", isError: true }
script.execute("throw new Error('boom')") → { text: "Error: boom", isError: true }
```
The second form is defensible (you want `consoleLogs` alongside the failure) but it should be documented, because a caller checking only for tool errors will treat a thrown exception as success.

### 3.7 Stack traces leak dev-server internals
Script errors return full traces containing `http://localhost:5273/src/renderer/scripting/ScriptRunnerBase.ts:74:14` and `src/shared/ai-vision/resolver.ts:127`. Fine in a dev build; worth trimming to the user frames in a packaged build — the resolver frames are noise for the caller and cost tokens on every failure.

### 3.8 No "did you mean" for near-miss names
`pagez`, `Pages` and `page.contnet` are all one edit away from a real member, and all three produce a full member-list dump with no suggestion. A Levenshtein-1/2 hint (`"pagez" is not a member of Persephone. Did you mean "pages"?`) would resolve the common case in one line instead of 2,400 tokens. Case-only mismatches (`Pages`) are worth special-casing.

---

## 4. What works well (worth preserving)

- **Discovery.** The root overview → `children (live)` → `$help` chain genuinely makes the model self-teaching. `helpSearch` finding `pages.addEditorPage()` from the word "grid" is a nice touch.
- **`resolved up to "..."`** on every error — immediately localizes which segment failed. Excellent.
- **Unknown member returns the valid member list** rather than failing blindly — right instinct, just too verbose on repeat (see 1.2).
- **Enumerating valid values.** `Editor 'not-an-editor' is not registered. Available editors: monaco, grid-json, …` and `Unknown AiVision element "no-such-control". Valid element names: …` and `Unknown toolId … Valid tool ids: …` are model-perfect errors.
- **`args`/`value` mutual exclusion** — clear, correct, and notably the one error that does *not* dump a hint block. That restraint is right.
- **Method-path-without-args returns a descriptor** instead of firing the method. Safe default for a destructive surface.
- **`[CAUTION: ...]` annotations** on mutating members are consistently applied and genuinely useful for deciding what is safe to probe.
- **The unsaved-changes dialog interception** is the standout. Closing a modified page returned:
  > *"This is the app asking the USER a question… If they did not say which, do NOT choose one that discards work or data — report the question and its options and let them decide."*

  Pausing the action, surfacing the dialog, naming the buttons, and explicitly instructing the agent not to discard user work unprompted is better agent-safety design than I see in most MCP servers. Keep it.
- **The `openUrl` / `openUrlInBrowserTab` split**, including the warning that the page id returns *before* the document loads and that you must `waitFor` — that is exactly the kind of race an agent would otherwise hit blind.

---

## 5. Recommendations, in priority order

| # | Change | Why |
|---|---|---|
| 1 | Guard `push` against a non-array argument | Fixes silent corruption of the main output channel (1.1) |
| 2 | Apply `hints` + dedupe to error responses; add near-match suggestions | Largest single token cost in the whole surface (1.2, 3.8) |
| 3 | Validate arguments uniformly using the existing helper | Removes the entire silent-no-op class (§2) |
| 4 | Validate `language`, or keep the requested editor and warn | Stops silent editor downgrade reported as success (1.4) |
| 5 | Address returned objects by real identity in hints | Removes a hint that leads to a dead path (1.5) |
| 6 | Clamp `limit`; add schema `minimum` to `maxLength`/`windowIndex` | Cheap; kills a real off-by-slice bug (1.3, 1.7) |
| 7 | Expose row keys in `rows`/`addRows`, or document the format | `deleteRows`/`editCell` currently need a guess (3.2) |
| 8 | Fix the nested quoting in `output.grid` examples | They exist to be copied verbatim (3.3) |
| 9 | Extend `maxLength` to structured results | Only current defence against a large-result blowup (1.6) |
| 10 | Unify mutation return shapes; document `isError` | Consistency (3.5, 3.6) |

---

## Appendix — test coverage

Exercised: unknown root member; wrong-case member; misspelled nested member; numeric index out of range; negative index; unknown string key; malformed paths (`..`, unterminated `[`, fractional index); empty and whitespace-only path; member access on a primitive; method descriptor vs. invocation; zero, wrong-type, `null`, object-instead-of-positional, and excess arguments; negative and zero numeric limits; assignment to a read-only property; assignment of an unvalidated enum-ish value; `args` + `value` together; invalid `hints` enum; out-of-range and negative `windowIndex`; zero and negative `maxLength`; script syntax error, thrown exception, and wrong parameter type; unknown editor id, language, tool id, page id, dialog element, and grid column/row key; non-array where an array is required; empty-string and non-string URLs.

State restored: both scratch pages (`Bad Lang Test`, `Good Grid Test`) closed, Log View cleared. The user's three pre-existing pages were never read, modified or closed.
