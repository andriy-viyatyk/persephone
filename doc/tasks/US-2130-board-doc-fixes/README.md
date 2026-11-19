# US-2130: Board docs that disagree with the board

## Goal

Update the five shipped board documents named in EPIC-200 so their claims match current board behavior. This task changes documentation only; each affected board receives the epic's single patch bump and changelog line.

## Background

Epic: [EPIC-200](../../epics/EPIC-200.md).

EPIC-200's **Board docs that disagree with the board** table identifies five rows: `pdf-viewer`, `notebook`, `aivision-explorer`, `wake-word`, and `agent-log-viewer`. The board checkout is `C:\projects\persephone-boards` on `develop`. It was clean at initial inspection; its current changes are limited to other EPIC-200 boards, and `git diff HEAD` for these five board folders is empty, so none has an earlier bump to reuse. Its `CLAUDE.md` says each shipped change needs a version bump and `WHATS-NEW.md` entry, and forbids hand-editing catalog and version history manifests.

### Verified: pdf-viewer priority claim

- `C:\projects\persephone-boards\boards\pdf-viewer\board-manifest.json:7-9,25-31` declares version `1.2.0`, `minAppVersion` `5.0.10`, `fileMasks: ["*.pdf"]`, `editorPriority: 100`, and `editorKind: "simple"`.
- Persephone's `src/renderer/editors/base/editor-matchers.ts:11-13,59-64,65-150` registers Monaco's file fallback at tier `0` and has no built-in `.pdf` matcher. The specialized and exclusive built-in file matchers claim only other file types.
- `src/renderer/editors/base/editor-catalog.ts:116-117,188-193` establishes built-in-first candidate order and replaces a winner only for a strictly greater priority. Thus the board's priority 100 beats Monaco's fallback 0; the old assertion that a built-in PDF editor claims `.pdf` at 100 is false.
- `boards/pdf-viewer/CLAUDE.md:7-8,104-105,119-124` contains two other stale current-state claims: it says the built-in PDF editor still exists and that the manifest's `minAppVersion` is `4.0.18`. The matcher has no PDF editor claim, and the manifest now requires `5.0.10`. Its `resolveId()` note at lines 119-121 is accurate: `src/renderer/editors/base/editorRegistry.ts:312-319` resolves only the built-in registry, so for `.pdf` it returns Monaco's fallback id, not the board editor.

Before:

```text
- `app.editors.resolveId("x.pdf")` returns the BUILT-IN id, not this board — that call consults
  only the built-in registry. To confirm the board actually claimed a file, check the page's
  `editor` field for `board-editor:<root>` (via `list_pages`).
- `editorPriority` is 200 while the built-in PDF editor still exists (it claims `.pdf` at 100,
  and ties go to the built-in). Once the built-in is removed only Monaco's `0` floor remains to
  beat, so this should drop to a low value before publishing.
```

After:

```text
Persephone has no built-in `.pdf` editor; this board wins its file association over Monaco's
fallback.
...
That is why the manifest currently requires Persephone `5.0.10` (`minAppVersion`).
...
- `app.editors.resolveId("x.pdf")` returns Monaco's built-in fallback id, not this board — that
  call consults only the built-in registry. To confirm the board actually claimed a file, check
  the page's `editor` field for `board-editor:<root>` (via `list_pages`).
- `editorPriority` is 100. Persephone has no built-in `.pdf` claim, so this beats Monaco's file
  fallback at tier 0.
```

No additional contradiction was found in `pdf-viewer/CLAUDE.md`: the remaining source-flow, model, security, limitation, and test notes match the implementation or are explicitly scoped as observations.

### Verified: notebook navigation

- `C:\projects\persephone-boards\boards\notebook\CLAUDE.md:3` calls `nav.js` a BT-079 placeholder.
- `boards/notebook/board-manifest.json:34-39` registers a `secondaryViews` entry with id `nav` and title `Categories & Tags`.
- `boards/notebook/nav.js:1,6-37,67-99,118-183,225-263` starts the navigation view, subscribes to hosted content/state, renders category and tag lists, selects filters, supports collapsing and renaming, and persists category/tag changes through the host. It is an implementation, not a placeholder.

Before:

```text
`nav.js` is the BT-079 placeholder.
```

After:

```text
`nav.js` implements the Categories & Tags secondary view: it renders category/tag navigation,
filters the notebook, and supports category collapse, rename and move plus tag rename.
```

No other contradiction was found in `notebook/CLAUDE.md:1-5`; its content-host, file ownership, offline build, reload, bridge-reference, and data-preservation notes match the manifest and source.

### Verified: AiVision Explorer manifest and model surface

- `boards/aivision-explorer/board-manifest.json:7-9` sets version `1.1.0`, `minAppVersion` `5.0.10`, and `appScripting: true`; it declares no file association or editor kind (lines 24-25 end the manifest after the screenshot field).
- `boards/aivision-explorer/CLAUDE.md:50` is stale on both manifest versions (`1.0.5` / `5.0.3`), and lines 62-66 direct the reader into `pages[i].editor.app`.
- The board's `app.js` uses `window.persephone.call` as its adapter (`app.js:7,107-110`) and explicitly describes its own board editor as having no `app` member until a page has published a model (`app.js:288-304`). No code in this board publishes an AiVision model. The board explores the app's live model, but its own board editor does not provide `editor.app`.

Before:

```text
- `board-manifest.json` — public identity, version `1.0.5`, and `minAppVersion` `5.0.3`.
...
Expand root and node rows, walk into `pages[i].editor.app`, select properties and methods, use Read/Assign/Invoke,
```

After:

```text
- `board-manifest.json` — public identity, version `1.1.0`, and `minAppVersion` `5.0.10`.
...
Expand the root and node rows to inspect the live Persephone object model. This board does not
publish its own `editor.app` model. Select properties and methods, then use Read/Assign/Invoke.
```

No additional contradiction was found in `aivision-explorer/CLAUDE.md`: the remaining descriptions of tree projection, operation controls, tabs, caution handling, and event/search behavior match `app.js` and the manifest.

### Verified: wake-word README loudness wording

- `boards/wake-word/README.md:14` says public enrollment gets a speech-detected crop "with a loudness fallback" but does not distinguish that crop fallback from the detection gate.
- `boards/wake-word/CLAUDE.md:15-23,25-30` says Silero VAD is the normal detection gate, rejects synthetic audio as a positive-path test, and the adaptive level gate is retained only when VAD fails. `scripts/service.mjs:198-220` confirms the detection fallback occurs when `vadProbability()` throws and sets `session.vadFailed`; the level gate is used on subsequent chunks.
- Enrollment crop behavior is separately implemented by `scripts/service.mjs:491-508,511-537,723-732`: quality first accepts loudness bounds, then `suggestSpeechBounds()` narrows them using VAD, returning the accepted bounds when VAD fails or finds no speech. Thus README's vague phrase is not precise enough to distinguish the two mechanisms; the correction should preserve the real enrollment crop fallback while explicitly limiting the detection level gate to VAD failure.
- `board-manifest.json:7-9` currently declares version `1.2.0` and `minAppVersion` `5.0.18`, consistent with the README's app-version requirement at lines 6-9.

Before:

```text
Public enrollment uses an automatic speech-detected crop with a loudness fallback.
```

After:

```text
Public enrollment starts with accepted loudness bounds, then Silero VAD suggests a crop. If VAD
fails or detects no speech, enrollment keeps those accepted bounds. Live detection uses Silero VAD;
the adaptive level gate is used only if VAD fails. Synthetic audio may be rejected by Silero VAD,
so it cannot verify the positive path.
```

No other contradictory statement was found in `wake-word/README.md:1-42`; the permissions, enrollment review, stored data, matching threshold, suppression behavior, and Agent Chat configuration claims agree with the manifest and service implementation or are clearly qualified.

### Verified: Agent Log Viewer accepted record formats

- `boards/agent-log-viewer/CLAUDE.md:3,10-13,18-26,30-32` correctly identifies Claude Code and Codex CLI JSONL logs, parser modules, shared session model, streaming behavior, usage handling, unknown-record behavior, settings, and synthetic fixtures; it does not state which line shapes the parsers accept.
- `boards/agent-log-viewer/board-manifest.json:7-9,25-34` identifies current version `1.1.0`, `.jsonl` file association, and the Claude/Codex session folder masks; it does not further constrain the record envelope formats.
- `scripts/parsers/claude-code.mjs:1-11` accepts Claude JSONL records without a `payload` envelope and with at least one of `sessionId`, `parentUuid`, `leafUuid`, or `type: "file-history-snapshot"`.
- `scripts/parsers/codex.mjs:1-9` accepts Codex JSONL records shaped as an envelope with `payload` and a string `type`.
- `scripts/session-model.mjs:1-6,42-68,139-159` defines the shared streaming index/result model and folds matched tool results into their call items; it does not add another input record format.

Before:

```text
## Rules that matter

- **Never read a log whole.** A 400 MB file must stay in Node; the frame asks for `WINDOW` turns
  at a time.
```

After:

```text
## Accepted records

Both formats are JSONL, with one JSON object per line. Claude Code records have no `payload`
envelope and include `sessionId`, `parentUuid`, `leafUuid`, or `type: "file-history-snapshot"`.
Codex CLI records have a `payload` property and a string `type`. Unknown record types within a
recognized format become metadata or are skipped; arbitrary JSONL is not accepted as either format.
```

No other contradictory statement was found in `agent-log-viewer/CLAUDE.md:1-32`; the documented filenames, architecture roles, usage accounting, error handling, and test fixture locations match the parser/model files and manifest.

## Implementation Plan

1. [ ] Update `C:\projects\persephone-boards\boards\pdf-viewer\CLAUDE.md`: remove the obsolete built-in PDF editor claim, state priority 100 beats Monaco fallback tier 0, update `minAppVersion` to 5.0.10, and clarify `resolveId()` returns Monaco's built-in fallback id. Add `- Corrected editor priority, resolution notes and minimum app version.` under `## 1.2.1` in `C:\projects\persephone-boards\boards\pdf-viewer\WHATS-NEW.md`; bump `C:\projects\persephone-boards\boards\pdf-viewer\board-manifest.json` from `1.2.0` to `1.2.1`.
2. [ ] Update `C:\projects\persephone-boards\boards\notebook\CLAUDE.md` to describe the implemented Categories & Tags navigation. Add `- Documented the Categories & Tags navigation view.` under `## 1.0.1` in `C:\projects\persephone-boards\boards\notebook\WHATS-NEW.md`; bump `C:\projects\persephone-boards\boards\notebook\board-manifest.json` from `1.0.0` to `1.0.1`.
3. [ ] Update `C:\projects\persephone-boards\boards\aivision-explorer\CLAUDE.md` to show manifest version `1.1.0` / minimum app `5.0.10` and remove the suggestion to inspect `pages[i].editor.app`. Add `- Corrected manifest version and editor model guidance.` under `## 1.1.1` in `C:\projects\persephone-boards\boards\aivision-explorer\WHATS-NEW.md`; bump `C:\projects\persephone-boards\boards\aivision-explorer\board-manifest.json` from `1.1.0` to `1.1.1`.
4. [ ] Clarify the wake-word README's enrollment crop fallback and detection gate as specified above. Add `- Clarified the enrollment crop fallback and VAD detection gate.` under `## 1.2.1` in `C:\projects\persephone-boards\boards\wake-word\WHATS-NEW.md`; bump `C:\projects\persephone-boards\boards\wake-word\board-manifest.json` from `1.2.0` to `1.2.1`.
5. [ ] Add accepted JSONL record shapes to `C:\projects\persephone-boards\boards\agent-log-viewer\CLAUDE.md` from the two parser `detect()` functions. Add `- Documented accepted Claude Code and Codex JSONL record formats.` under `## 1.1.1` in `C:\projects\persephone-boards\boards\agent-log-viewer\WHATS-NEW.md`; bump `C:\projects\persephone-boards\boards\agent-log-viewer\board-manifest.json` from `1.1.0` to `1.1.1`.
6. [ ] Scan all five target documents against their board sources; findings are recorded in the verified sections above. The additional pdf-viewer contradictions are its built-in-editor statement and stale `minAppVersion` statement.
7. [ ] Do not change Persephone integration tests; this task only corrects board documentation and no test change is expected.

## Concerns

- These documents ship in their board ZIPs, so each of the five boards must get exactly one patch bump for this epic. No earlier task bump is present in the clean `develop` checkout.
- Do not edit `boards-manifest.json` or any `versions-manifest.json`; both are machine-written.
- No test change is expected.

## Acceptance Criteria

- [ ] All five documents agree with their board source and current manifest.
- [ ] Any additional contradictions found while scanning the five documents are included in the plan.
- [ ] Each board with a documentation change has one patch increment and one line under its resulting `WHATS-NEW.md` version heading.
- [ ] No Persephone integration test changes are needed.

## Files Changed

| File | Planned change |
|---|---|
| `C:\projects\persephone-boards\boards\pdf-viewer\CLAUDE.md` | Correct built-in editor, priority, `resolveId()`, and minimum app version claims. |
| `C:\projects\persephone-boards\boards\pdf-viewer\WHATS-NEW.md` | Add one line under `## 1.2.1`. |
| `C:\projects\persephone-boards\boards\pdf-viewer\board-manifest.json` | Bump `1.2.0` → `1.2.1`. |
| `C:\projects\persephone-boards\boards\notebook\CLAUDE.md` | Correct `nav.js` description. |
| `C:\projects\persephone-boards\boards\notebook\WHATS-NEW.md` | Add one line under `## 1.0.1`. |
| `C:\projects\persephone-boards\boards\notebook\board-manifest.json` | Bump `1.0.0` → `1.0.1`. |
| `C:\projects\persephone-boards\boards\aivision-explorer\CLAUDE.md` | Correct manifest version requirements and model availability. |
| `C:\projects\persephone-boards\boards\aivision-explorer\WHATS-NEW.md` | Add one line under `## 1.1.1`. |
| `C:\projects\persephone-boards\boards\aivision-explorer\board-manifest.json` | Bump `1.1.0` → `1.1.1`. |
| `C:\projects\persephone-boards\boards\wake-word\README.md` | Distinguish enrollment crop fallback from the live detection gate. |
| `C:\projects\persephone-boards\boards\wake-word\WHATS-NEW.md` | Add one line under `## 1.2.1`. |
| `C:\projects\persephone-boards\boards\wake-word\board-manifest.json` | Bump `1.2.0` → `1.2.1`. |
| `C:\projects\persephone-boards\boards\agent-log-viewer\CLAUDE.md` | Add the two accepted JSONL record shapes. |
| `C:\projects\persephone-boards\boards\agent-log-viewer\WHATS-NEW.md` | Add one line under `## 1.1.1`. |
| `C:\projects\persephone-boards\boards\agent-log-viewer\board-manifest.json` | Bump `1.1.0` → `1.1.1`. |
| Persephone integration tests | **No change.** |

### Files that need NO change

- `C:\projects\persephone\doc\active-work.md` and `doc/epics/EPIC-200.md` — already updated; explicitly out of scope.
- `C:\projects\persephone-boards\boards-manifest.json` and each board's `versions-manifest.json` — generated by the publish script; never hand-edit.
- `C:\projects\persephone\integration-test\tests\published-boards\` — no test change is expected for documentation corrections.
- `C:\projects\persephone\src\renderer\editors\base\editor-matchers.ts`, `editor-catalog.ts`, and `editorRegistry.ts` — evidence for PDF resolution only; no Persephone code change.
- `C:\projects\persephone-boards\boards\notebook\nav.js`, `aivision-explorer\app.js`, `wake-word\scripts\service.mjs`, and `agent-log-viewer\scripts\parsers\claude-code.mjs`, `codex.mjs`, `session-model.mjs` — inspected source remains unchanged.
