# US-2209: Linux encoding fallback and fonts

[EPIC-213: Linux core parity](../../epics/EPIC-213.md) · Planned

## Goal

Choose a locale-aware last-resort text encoding off Windows and supply Linux font fallbacks while preserving Windows behavior. Check text, Markdown, and board glyphs on Ubuntu 26.04.

## Background

- [WIN-27 and WIN-29](../../reviews/multiplatform-2026-11/inventory.md) and [R-4 and R-10](../../reviews/multiplatform-2026-11/runtime-findings.md) provide the evidence. R-10's Windows-1251 sample decoded correctly without varying locale; it does not establish which detection branch ran. R-4 saw a missing glyph in WSL without an emoji font; stock Desktop was not checked.
- `src/renderer/core/utils/text-encoding.ts` owns `decodeBuffer` and `encodeString`. Decoding tries BOM, a >20 MB UTF-8 shortcut, explicit override, `jschardet` above 0.05, valid UTF-8, then Windows-1251. The large-file shortcut even precedes the explicit override; leave it and all earlier branches unchanged. `src/renderer/api/fs.ts` and `src/renderer/content/ContentPipe.ts` call this owner. The pipe records the returned encoding in `readText()`, persists it in its descriptor, and `writeText()` encodes with it; `src/renderer/editors/content-host/TextFileIOModel.ts` uses the pipe to save. `app.fs.readFile` returns the encoding and `app.fs.write` accepts an explicit one. The status bar displays an encoding label (`src/renderer/editors/base/EditorStatusBarView.ts`), not a chooser. No default-encoding setting was found in the settings implementation/catalog; do not introduce one.
- Renderer `process.env` is available through Node integration: `src/main/open-window.ts` sets `nodeIntegration: true`, `contextIsolation: false`, `sandbox: false`. Locale comes from the inherited process environment, not IPC or necessarily the current desktop locale. `src/shared/platform.ts` exports `isWindows`; use it instead of a new `process.platform` check.
- `src/renderer/theme/p-vars.ts` owns `APP_FONT_FAMILY` and publishes `--p-font-family`, also used for av-grid. `src/renderer/theme/global-styles.ts` gives body that variable and form controls a separate `--vscode-editor-font-family` fallback. `src/renderer/editors/markdown/MarkdownBlock.css` owns prose and code stacks; `src/renderer/ui/app/NativeEditorErrorView.css` owns another Consolas stack. A whole-`src/` search also found generic monospace in settings and `uikit/ImageViewport`, inherited fonts in RadioGroup and HeaderQuickSettingsPopover, and SVG text in `theme/icons.ts`; those are not additional Windows-font stacks.
- The counter buttons in `assets/demo-board/index.html` (`ss-inc`) and `assets/demo-board/app.js` (`ss-frame-inc`) contain `＋` U+FF0B FULLWIDTH PLUS SIGN: a Unicode text character, not an emoji or icon-font character. R-4 did not identify the missing character, so this is a candidate, not proof. Board content is a separate document: `assets/demo-board/style.css` uses `system-ui, sans-serif`; `boards-assets/markdown.css` also has independent stacks. Renderer CSS alone cannot guarantee board glyph coverage.
- No `fontFamily` option or dedicated font-family user setting is passed in `src/` today. Monaco's Linux default is `"Droid Sans Mono", "monospace", monospace`, which falls back through fontconfig to the system monospace (such as DejaVu Sans Mono or Ubuntu Mono). CSS form-control fallback is not the Monaco option.
- Existing UI coverage: `integration-test/tests/core/files/files.test.mjs`, test **“UTF-8 BOM, UTF-16 LE, and Windows-1252 files decode and keep encoding after save”**. It covers detected encodings and write-back, not the final fallback or locale precedence.

## Implementation Plan

- [x] In `src/renderer/core/utils/text-encoding.ts`, make this module the **sole owner** of default fallback selection. Import `isWindows` from `src/shared/platform.ts`. On Windows return `windows-1251` without consulting locale. Else select the first nonempty `LC_ALL`, `LC_CTYPE`, `LANG` in that order; parse only the charset after `.` and before optional `@modifier`, case-insensitively. An absent charset, `C`, `POSIX`, UTF-8 spelling, malformed value or unsupported charset selects `utf-8`. Do not fall through to a lower-priority variable when the selected locale has no usable charset. Normalize legacy aliases using iconv-lite's `encodingExists`, accepting only recognized legacy names; explicitly cover `CP1251` → `windows-1251` and `KOI8-R` → `koi8-r`. Return the selected encoding alongside decoded content. Do not infer charset from language or territory. Verify supported aliases against installed iconv-lite, and exclude Unicode and non-legacy codecs from the legacy path. Update the detection-order comment. No main-process owner, environment mutation, new IPC or setting is needed.

  For a concrete safe mapping, normalize case and punctuation and accept charset families `cp` plus digits, `windows` plus digits, `iso-8859` plus a numeric part, and `koi8-r`/`koi8-u`; require `iconv.encodingExists` for each candidate. Map `cp1251` to `windows-1251`, preserve a normalized supported name for other accepted candidates, and reject all other families to UTF-8. This intentionally does not interpret arbitrary iconv codecs as locale charsets. The installed iconv-lite aliases include `cp1251` and `koi8r` in `node_modules/iconv-lite/encodings/sbcs-data-generated.js`.

  Before → after, schematic (keep earlier branches intact):

  ```ts
  return { content: iconv.decode(buffer, "windows-1251"), encoding: "windows-1251" };
  // →
  const fallback = defaultTextEncoding(); // isWindows or locale environment, owned here
  return { content: iconv.decode(buffer, fallback), encoding: fallback };
  ```

- [x] Make `src/renderer/theme/p-vars.ts` the sole owner of platform font selection and publish CSS variables for each distinct stack. Use `isWindows`; retain the exact Windows values and ordering below. On non-Windows, add `Ubuntu Mono`, `DejaVu Sans Mono`, `Noto Sans Mono`, and `Liberation Mono` before the generic monospace fallback, and `Ubuntu`, `DejaVu Sans`, `Noto Sans`, and `Noto Color Emoji` where appropriate for sans prose and emoji-capable controls. Preserve Markdown's existing non-Windows system font preferences. The consuming files use these variables instead of literal stacks, without platform logic of their own:

  | Consumer | Windows computed `font-family` before → after |
  | --- | --- |
  | `p-vars.ts` / body and av-grid via `--p-font-family` | `Consolas, monospace, "Courier New"` → `Consolas, monospace, "Courier New"` |
  | `global-styles.ts` form controls | With override set: its value → the same value. Without override: `Consolas, monospace, "Courier New"` → `Consolas, monospace, "Courier New"`. Retain the override and use `--p-font-family` for its fallback. |
  | `MarkdownBlock.css` prose | `-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif` → `-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif`; use a dedicated sans variable. |
  | `MarkdownBlock.css` code | `ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace` → `ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace`; use a dedicated Markdown code variable. |
  | `NativeEditorErrorView.css` | `Consolas, "Courier New", monospace` → `Consolas, "Courier New", monospace`; use a dedicated error-view variable because its order differs from `--p-font-family`. |

  These are the resolved font-family lists, subject to CSS serialization; actual glyph selection depends on installed fonts. Follow static/co-located CSS conventions and add no hardcoded colors.
- [x] No unit tests, new harnesses, or test changes. `npm run typecheck` and `npm run lint` pass.
- [ ] Run existing UI areas `npm run test:ui -- --area core/files`, `npm run test:ui -- --area editors/markdown`, and `npm run test:ui -- --area editors/text`, using the documented setup. The named encoding test must pass.
- [ ] Claude performs the live WSL check, not Codex: capture screenshots of a text page, a Markdown page with an emoji and code, and the demo board. Open one disposable CP1251 fixture with `LANG=ru_RU.CP1251` and with `LANG=C.UTF-8`, starting a fresh app each time and clearing higher-priority locale variables. Use a fixture demonstrably reaching the final fallback and record the content and encoding. Open one disposable invalid-UTF-8 fixture under `C.UTF-8` with a fresh app, confirm the encoding label shows UTF-8 and compare source bytes before and after opening to confirm no write occurs. U+FF0B coverage is a font-install question for the Phase 2 VM.

### Live check (Claude, 2026-11-26)

- WSL dev app, `LANG=C.UTF-8`, no `LC_ALL`: a 5-byte file `61 62 ff 63 64` read through `app.fs.readFile` returned
  `{ content: "ab�cd", encoding: "utf-8" }` (Windows-1251 before this task), and the file on disk was unchanged
  after opening.
- Full WSL suite and the Windows areas (`core/files`, `editors/text`, `editors/markdown`, in the full Windows run)
  pass.
- Not done here: the `LANG=ru_RU.CP1251` start and the font screenshots. WSL is not the target desktop for fonts;
  check both in the Phase 2 VM.

## Concerns

- **Data loss:** when the final fallback is UTF-8 and bytes are invalid, decoding produces U+FFFD replacement characters. The pipe records `utf-8`; after editing and saving, `encodeString` writes UTF-8 for replacements, so original bytes are irrecoverably changed. Opening alone does not imply a source-file write, but an edited save can corrupt the original. Explicit `app.fs.readFile(path, encoding)` can recover a known charset from original bytes before saving; preserve a copy. This task does not add a chooser, warning, lossless byte preservation or a new setting. Existing >20 MB UTF-8 decoding already has the same risk. Record this limitation in implementation review and do not claim round-trip safety.
- Locale is a hint and `jschardet` takes precedence. A supported locale charset cannot correct an earlier wrong confident detection. Font coverage depends on installed packages and fontconfig; named fallbacks are not bundled fonts. U+FF0B coverage is a font-install question for the Phase 2 VM.
- No unresolved design questions block implementation; visual results and the open-only byte check remain acceptance work. Epic decision 6 governs Windows compatibility, including fallback ordering and Monaco defaults.

## Acceptance Criteria

- [ ] Windows encoding behavior and font choices remain unchanged; off Windows the last fallback follows locale precedence and supported legacy charset rules above, otherwise UTF-8. Earlier detection and explicit encoding behavior remain unchanged.
- [ ] Existing callers share one fallback owner; no new IPC, encoding setting, direct `process.platform` check, hardcoded color, unit test or harness.
- [ ] Linux app and Markdown stacks use theme-owned variables; Monaco and board documents retain their own defaults. U+FF0B coverage is a Phase 2 VM font-install question.
- [ ] Typecheck, lint and the three named Windows UI areas pass. Claude records the specified WSL screenshots and fixture checks, including the UTF-8 label and unchanged bytes after opening invalid UTF-8.

## Files Changed Summary

| File | Planned change |
| --- | --- |
| `src/renderer/core/utils/text-encoding.ts` | Own locale parsing and fallback selection; preserve detection order. |
| `src/renderer/theme/p-vars.ts` | Own platform-aware font stacks and shared variables. |
| `src/renderer/theme/global-styles.ts` | Preserve form override and consume the shared fallback variable. |
| `src/renderer/editors/markdown/MarkdownBlock.css` | Consume dedicated prose and code variables. |
| `src/renderer/ui/app/NativeEditorErrorView.css` | Consume its dedicated error-view variable. |

**No changes:** `src/renderer/editors/shared/MonacoEditorHostView.ts`, `src/renderer/editors/shared/MonacoDiffEditorHostView.ts`, and `src/renderer/editors/log-view/items/TextOutputView.ts` (Monaco's Linux default falls back to the system monospace via fontconfig); `assets/demo-board/style.css` and `boards-assets/markdown.css` (separate board documents use `system-ui`; U+FF0B coverage is a Phase 2 VM font-install question); `src/shared/platform.ts` (reuse `isWindows`), `src/main/open-window.ts` (existing Node integration), `src/renderer/content/ContentPipe.ts`, `src/renderer/api/fs.ts`, `src/renderer/editors/content-host/TextFileIOModel.ts` (reuse the codec), settings and IPC, `src/renderer/theme/icons.ts`, generic/inherited font declarations, and `integration-test/tests/core/files/files.test.mjs` (existing verification). Do not edit the epic or `doc/active-work.md` for this planning request.
