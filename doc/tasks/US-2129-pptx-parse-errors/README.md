# US-2129: PowerPoint Viewer reports parse errors instead of an empty deck

## Goal

When the PowerPoint Viewer cannot read a `.pptx`, expose the failure through the board model and browser console and show a localized error message. Keep a malformed deck distinguishable from a successfully parsed deck with zero rendered slides.

## Background

- The work is in `C:\projects\persephone-boards`, branch `develop`; this task document is tracked in Persephone under EPIC-200. EPIC-200 Notes/Decisions (2026-11-19) require one patch bump per changed board for the entire epic. The PowerPoint board is at `1.2.0`, and `git diff -- boards/powerpoint-viewer` on `develop` is empty, so this task is the first PowerPoint change in the epic: use one `1.2.1` bump and one `## 1.2.1` changelog heading.
- `boards/powerpoint-viewer/app.js:134-164` reads the file, initializes pptx-preview and awaits `previewer.preview(bytes.buffer)`. The outer preview method in `boards/powerpoint-viewer/lib/pptx-preview.umd.js:1` propagates a rejected `i.load(t)` promise to its returned promise. However, `Nr.prototype._loadPresentation` catches exceptions at generator catch case `4` and advances to completion (`case 5`) instead of rethrowing; `_loadContentTypes` does the same at catch case `22`. The latter try block also loads slides: cases `17-20` create `new Pr(m,_,this)`, await `.load()`, and push each slide to `this.slides`. An unconditional rethrow there would discard previously loaded slides. Re-throw from `_loadContentTypes` only when `this.slides.length === 0`; otherwise preserve the partial deck, save the error with its current part name, and warn.
- Verified the previewer retains the parsed object: `preview()` assigns `e.pptx=new Nr` before calling `i.load(t)`. The board can therefore read `previewer.pptx.parseError` after `preview()` resolves and expose a partial-load diagnostic while `isLoaded` is true.
- In `boards/powerpoint-viewer/app.js:187-190`, a preview that resolves with no `.pptx-preview-slide-wrapper` is labeled `state.noSlides` and returned. Rejected previews reach `app.js:208-212`; the catch shows `state.openError` and calls `P.notify`, but it does not call `console.warn` or store the error for the model. The fix should let essential parser failures reject in the vendored code, then capture/report them in the board wrapper. Keep the no-slide message for valid decks that genuinely contain no slides.
- `boards/powerpoint-viewer/app.js:43-50` supplies callbacks to `createAiVisionModel()`. `pptx-aivision.js:82-109` declares model members, `:735-767` defines the exposed app shape and `getStats()`, and `:1032-1042` resets caches on `documentChanged()`. `isLoaded` is derived from rendered slide count (`:748-760`); `getStats()` calls `requireLoaded()` (`:764-767`), so the error must also be available while no deck is loaded. Add a `getError` callback in `app.js` and a readable `error` model property (undefined after a successful load or a fresh load begins; a diagnostic string on a failed or unreadable load), include it in the model summary, and make its member description clear. Keep `getStats()`'s existing successful-deck shape and loaded-deck guard.
- `boards/powerpoint-viewer/lang/en.json` contains `state.noSlides`, `state.openError` and `toast.openError`. The 18 packs under `boards/powerpoint-viewer/lang/` are `be`, `de`, `en`, `es`, `et`, `fr`, `hu`, `it`, `ja`, `ko`, `lt`, `lv`, `pl`, `pt-BR`, `ro`, `sk`, `uk` and `zh-CN`; preserve the same message keys and translate changed/new user-facing text in every pack.
- `boards/powerpoint-viewer/CLAUDE.md:57-59` currently documents a parse failure as an error overlay plus notification, but omits console/model diagnostics. `boards/powerpoint-viewer/guides/agent.md:19-24` documents `getStats()` without a failure member. Update both for the resulting behavior. `guides/index.md:28-30` discusses successful parsing; only change it if the user-facing copy needs to explain the new error state.
- Persephone already has a synthetic two-slide fixture and ZIP writer in `integration-test/tests/published-boards/office-samples.mjs:1-49, 119-169`; its published-board tests live in `integration-test/tests/published-boards/powerpoint-viewer/powerpoint-viewer.test.mjs`. `openPublishedSample()` in `integration-test/tests/published-boards/helpers.mjs:11-45` verifies that the published board checkout is opened. The web-test host contract is documented in `assets/guides/agents/web-app-tests.md` (test descriptors, `ctx.expect`, `ctx.waitFor`, `ctx.script`, and `ctx.fixture`).

## Implementation Plan

- [ ] In `C:\projects\persephone-boards\boards\powerpoint-viewer\lib\pptx-preview.umd.js`, keep `_loadPresentation` catch case `4` as a rethrow. In `_loadContentTypes` catch case `22`, save `u.sent()` as the parser's `parseError` with the current part name `m` (falling back to `[Content_Types].xml`), then rethrow only when `this.slides.length === 0`; when earlier slides loaded, emit `console.warn` with the part and error and return to completion so they remain renderable. Preserve optional thumbnail handling in `_loadThumbnail`. Record the local modification and re-vendor guidance in `C:\projects\persephone-boards\boards\powerpoint-viewer\lib\VERSION.txt` per the vendoring rule.
- [ ] In `C:\projects\persephone-boards\boards\powerpoint-viewer\app.js`, keep the most recent load diagnostic in board state and pass a `getError` callback to `createAiVisionModel()` at the existing context object (`:43-50`). Clear it when `load()` starts. For a rejected preview, including a non-ZIP file rejected by JSZip, preserve the caught message, emit `console.warn`, set the model error, and keep the existing localized `state.openError` overlay/toast behavior. After a resolved preview, read `previewer.pptx.parseError` and set the model error for a partial deck without discarding rendered slides. Keep `state.noSlides` for a successfully parsed deck with zero slides. Do not label a plain board open without a file as a parse error.
- [ ] In `C:\projects\persephone-boards\boards\powerpoint-viewer\pptx-aivision.js`, expose the diagnostic from `ctx.getError()` as a model `error` property that remains readable when `isLoaded` is false. Add it to `MEMBERS`, `app`, and `aiVision.summarize`. Let `app.js` own clearing the error when a new load starts; keep `documentChanged()` focused on cache refresh. Keep successful `getStats()` results unchanged, and document that callers can read `app.error` after a failed load even though deck-reading methods require a loaded deck.
- [ ] Update `C:\projects\persephone-boards\boards\powerpoint-viewer\lang\en.json` and each of the other 17 files in `C:\projects\persephone-boards\boards\powerpoint-viewer\lang\` so the unreadable-deck state has translated user-facing text. Reuse or replace `state.noSlides` only if the resulting wording distinguishes an unreadable deck from a valid empty deck; keep all message catalogs key-compatible.
- [ ] Update `C:\projects\persephone-boards\boards\powerpoint-viewer\CLAUDE.md` and `C:\projects\persephone-boards\boards\powerpoint-viewer\guides\agent.md` to state where load errors are reported and give the `editor.app.error` result shape. Update `guides/index.md` only if its user-facing instructions need a corresponding error-state description.
- [x] **Persephone repo, separate run:** In `C:\projects\persephone\integration-test\tests\published-boards\office-samples.mjs`, add a synthetic broken `.pptx` writer using the existing `makeZip()` / `writeSample()` helpers. It must be a valid ZIP whose `ppt/presentation.xml` is missing or unparsable, so it exercises the patched parser path rather than JSZip's invalid-ZIP rejection. In `C:\projects\persephone\integration-test\tests\published-boards\powerpoint-viewer\powerpoint-viewer.test.mjs`, add a published-board test that asserts `typeof editor.app.error === "string"`, `editor.app.error.length > 0`, and visible `#state` text differs from the localized no-slides message. Do not assert console output. Keep all existing valid-deck assertions unchanged.
- [ ] In `C:\projects\persephone-boards\boards\powerpoint-viewer\WHATS-NEW.md`, add one terse change line under `## 1.2.1`. Bump only `version` in `C:\projects\persephone-boards\boards\powerpoint-viewer\board-manifest.json` from `1.2.0` to `1.2.1`. Do not edit `boards-manifest.json` or any `versions-manifest.json`; the publish script generates them.

### Before → after

`boards/powerpoint-viewer/lib/pptx-preview.umd.js:1`, in `_loadPresentation`, currently consumes a required presentation-XML error and continues:

```js
case 4:return a.sent(),[3,5];
```

Change the parser catch to rethrow (and do the same for `_loadContentTypes` catch case `22`) so `previewer.preview()` rejects instead of returning a zero-slide result:

```js
case 4:throw a.sent();
```

In `_loadContentTypes`, retain partial slides and report the part-level failure:

```js
// before
case 22:return u.sent(),[3,23];

// after (b is already declared in the method's var list)
case 22:b=u.sent(),this.parseError={part:m||"[Content_Types].xml",error:b};if(0===this.slides.length)throw b;console.warn("pptx-preview: part failed",this.parseError.part,b);return[3,23];
```

Add this exact note to `lib/VERSION.txt` under `LOCAL MODIFICATION`:

```text
LOCAL MODIFICATION (pptx-preview.umd.js is patched — not pristine upstream):
  The parser swallowed required-part failures in Nr._loadPresentation and
  Nr._loadContentTypes. _loadPresentation now rethrows its parse error. In
  _loadContentTypes, the error is saved as parseError with the current part name
  and logged; it is rethrown only when no slides have loaded, preserving earlier
  slides in a partially readable deck. Re-apply both catch changes if re-vendoring.
```

The wrapper's existing `app.js:208-212` catch shows an overlay and toast for a non-ZIP JSZip rejection too; this same catch must set the model error for that path. For partial parsing, `preview()` retains the parser as `previewer.pptx`, so the wrapper can read its `parseError` after await and normalize it into a non-empty string containing the part and underlying message. Keep `app.js:187-190` as the valid zero-slide state. On the model surface, `pptx-aivision.js:764-767` currently requires loaded slides before `getStats()` can return, so expose the diagnostic through a separate always-readable `app.error` member rather than weakening that guard or changing successful stats results.

## Concerns / Open Questions

- The vendored parser currently suppresses required-part parse errors. `_loadContentTypes` also parses slides in the same try block, so an error after one or more slides must warn and retain those slides, while an error before the first slide rejects. For partial results, `previewer.pptx.parseError` is reachable and should be exposed by the model even though `isLoaded` is true. A valid zero-slide presentation remains distinct from a rejected parse.
- A non-ZIP file is rejected by JSZip during `previewer.preview()` and reaches the board's existing `app.js:208-212` catch, which already shows the localized `state.openError` overlay and toast. The new `app.error` assignment must cover this catch path as well.
- Because this requires a vendored library change, record the local patch in `lib/VERSION.txt` and preserve it on re-vendor as required by the boards repository rules.
- Board language strings are shipped with the board, so all 18 language packs need the same keys and translated wording in the same board version.
- Integration-test host notes name `ctx.app`, `ctx.call`, `ctx.waitFor`, and `ctx.script`, but do not define a board iframe console capture API. Verify available capture from existing test APIs before adding that optional assertion; model and visible-state assertions are required.

## Acceptance Criteria

- [ ] A generated malformed `.pptx` with a valid ZIP container and missing/unparsable `ppt/presentation.xml` is reported as a read/parse failure, not an empty deck.
- [ ] A failure before any slide loads is available from `pages[pageId].editor.app.error` while `isLoaded` remains false; a later slide failure preserves prior slides and exposes a non-empty `error` while `isLoaded` remains true.
- [ ] The board emits a console warning containing the diagnostic and displays localized user-facing error text.
- [ ] A new load clears a prior error; a successful valid deck still passes the existing slide count, outline, render, text and navigation assertions unchanged.
- [ ] All 18 PowerPoint language packs retain identical message-key sets.
- [ ] Board version is `1.2.1` with one `## 1.2.1` heading and one changelog line; no generated manifests are hand-edited.
- [ ] The synthetic broken-deck test in the separate Persephone repo run passes in the published-board integration suite and does not assert console output.

## Notes

- Source finding: the actual swallow is in vendored parser methods `Nr.prototype._loadPresentation` (catch case `4`) and `_loadContentTypes` (catch case `22`) in `boards/powerpoint-viewer/lib/pptx-preview.umd.js:1`. `_loadPresentation` discards its exception; `_loadContentTypes` can discard an exception after loading zero or more slides. The outer preview method propagates rejected loads. The planned conditional rethrow preserves already-loaded slides and makes the parse diagnostic available through `previewer.pptx`.
- Version finding: the PowerPoint board has no uncommitted changes on `develop` and is currently `1.2.0`, so this task owns the epic's single `1.2.1` patch bump unless another EPIC-200 task changes it before implementation.

## Files Changed

| File | Change |
|------|--------|
| `C:\projects\persephone-boards\boards\powerpoint-viewer\lib\pptx-preview.umd.js` | Re-throw parser failures from required presentation and content-type parts. |
| `C:\projects\persephone-boards\boards\powerpoint-viewer\lib\VERSION.txt` | Record the local parser patch and re-vendor guidance. |
| `C:\projects\persephone-boards\boards\powerpoint-viewer\app.js` | Retain parse/load diagnostics, warn, and show unreadable-deck UI state. |
| `C:\projects\persephone-boards\boards\powerpoint-viewer\pptx-aivision.js` | Add always-readable `error` member and summary value. |
| `C:\projects\persephone-boards\boards\powerpoint-viewer\lang\en.json` and `lang\be.json`, `de.json`, `es.json`, `et.json`, `fr.json`, `hu.json`, `it.json`, `ja.json`, `ko.json`, `lt.json`, `lv.json`, `pl.json`, `pt-BR.json`, `ro.json`, `sk.json`, `uk.json`, `zh-CN.json` | Add/update localized error-state text in all 18 language packs. |
| `C:\projects\persephone-boards\boards\powerpoint-viewer\CLAUDE.md` | Document model/console/UI load error behavior. |
| `C:\projects\persephone-boards\boards\powerpoint-viewer\guides\agent.md` | Document how agents read the load diagnostic. |
| `C:\projects\persephone-boards\boards\powerpoint-viewer\guides\index.md` | Change only if user-facing error-state instructions are needed. |
| `C:\projects\persephone-boards\boards\powerpoint-viewer\WHATS-NEW.md` | Add one line under the epic's single `1.2.1` release heading. |
| `C:\projects\persephone-boards\boards\powerpoint-viewer\board-manifest.json` | Bump `version` once from `1.2.0` to `1.2.1`. |
| `C:\projects\persephone\integration-test\tests\published-boards\office-samples.mjs` | Add a generated synthetic broken `.pptx` fixture helper. |
| `C:\projects\persephone\integration-test\tests\published-boards\powerpoint-viewer\powerpoint-viewer.test.mjs` | Add a test asserting model and visible parse-error reporting for the broken fixture. |

### Files that need no change

| File | Reason |
|------|--------|
| `C:\projects\persephone-boards\boards-manifest.json` | Machine-written by the publishing script. |
| `C:\projects\persephone-boards\boards\powerpoint-viewer\versions-manifest.json` | Machine-written by the publishing script. |
| `C:\projects\persephone\integration-test\tests\published-boards\helpers.mjs` | Existing `openPublishedSample()` already checks that the exact published-board checkout is opened. |
| `C:\projects\persephone\doc\active-work.md` | The epic/task entry is already present and the user explicitly said not to edit the dashboard. |
| `C:\projects\persephone\doc\epics\EPIC-200.md` | Epic decisions are already recorded and the user explicitly said not to edit the epic. |
