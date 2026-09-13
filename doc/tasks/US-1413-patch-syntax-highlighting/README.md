# US-1413: Syntax highlighting for `.patch` / `.diff` files

## Goal

Give unified-diff files (`.patch`, `.diff`) their own Monaco language with general,
structural highlighting — added lines green, removed lines red, hunk and file headers
distinct — rather than colouring them as some other programming language.

## Background

Persephone already ships five custom Monaco languages, and this task is a sixth repetition
of an established four-part pattern. `log` is the closest model: a pure Monarch tokenizer
with no language services.

**The four wiring points** (verified against the source, not assumed):

1. **Tokenizer module** — `src/renderer/api/setup/monaco-languages/<id>.ts`, exporting
   `define<Name>Language(monacoInstance)`. That function calls, in order,
   `languages.register({ id, extensions, aliases })`,
   `languages.setLanguageConfiguration(id, conf)`, and
   `languages.setMonarchTokensProvider(id, monarchLanguage)`.
   See `monaco-languages/log.ts` — the whole file is the template.
   (`csv.ts` uses `setTokensProvider` with a hand-written stateful tokenizer instead,
   because rainbow columns need carried state. Patch does not; use Monarch.)

2. **Registration call** — `src/renderer/api/setup/configure-monaco.ts:227-231` calls each
   `define…Language(monaco)` in a block. Add the new call there, and the import at the top
   of the file (`configure-monaco.ts:6-10`).

3. **Theme token colours** — `customTokenRules` in `configure-monaco.ts:23-82`, a single
   `ITokenThemeRule[]` consumed by `defineMonacoTheme` (line ~85) for **every** theme.
   The `.log` block at lines 69-81 is the shape to copy.

4. **Extension → language map** — `extraLanguages` in
   `src/renderer/core/utils/monaco-languages.ts:3-29`. This is what populates the tab
   Language dropdown and maps a file extension to a language id on open; the
   `languages.register({ extensions })` call in step 1 is **not** sufficient on its own.
   The two lists must agree on id, extensions, and aliases.

**What does not need touching:**

- `src/renderer/components/icons/language-icon-resolver.ts` — only `csv` among the custom
  languages has a dedicated icon (line 120); `log`, `reg`, `jsonl` and `mermaid` have none
  and fall through to the default file icon. Patch does the same. No new icon.
- `src/renderer/editors/base/editor-matchers.ts` — matchers exist to route a file to a
  *non-text* editor (grid, log-view). A patch file stays in the Monaco text editor, which
  is the default. No matcher.

## Implementation plan

### 1. `src/renderer/api/setup/monaco-languages/patch.ts` (new)

Export `definePatchLanguage(monacoInstance: Monaco): void`, modelled on `log.ts`
(including the `type Monaco = typeof monaco;` alias and the doc comment).

- `languageId = "patch"`
- `register({ id: "patch", extensions: [".patch", ".diff"], aliases: ["Patch", "patch", "Diff", "diff"] })`
- Language configuration: unified diff has no bracket or comment semantics worth declaring.
  Supply `{}` or, at most, a `wordPattern`. Do **not** declare brackets or auto-closing
  pairs — a patch is not source, and bracket matching across `+`/`-` lines is noise.
- `ignoreCase` must be **false** (the default). Diff markers are case-sensitive.

**Monarch tokenizer.** One `root` state, whole-line rules, no pushed states. Order is
load-bearing — `---`/`+++` must be tested before the bare `-`/`+` rules, or every file
header is mis-coloured as a removed or added line:

| # | Pattern (anchored with `^`, consuming to end of line) | Token |
|---|---|---|
| 1 | `^diff --git .*$`, then `^diff .*$` | `meta.header.patch` |
| 2 | `^(index\|old mode\|new mode\|new file mode\|deleted file mode\|similarity index\|dissimilarity index\|rename from\|rename to\|copy from\|copy to\|GIT binary patch\|Binary files) .*$` | `meta.patch` |
| 3 | `^--- .*$` | `meta.file.patch` |
| 4 | `^\+\+\+ .*$` | `meta.file.patch` |
| 5 | `^@@.*$` | `meta.range.patch` |
| 6 | `^Index: .*$`, and `^[=*-]{3,}$` (context-diff separators) | `meta.patch` |
| 7 | `^-.*$` | `deleted.patch` |
| 8 | `^\+.*$` | `inserted.patch` |
| 9 | `^\\.*$` (`\ No newline at end of file`) | `meta.patch` |

Anything unmatched — context lines beginning with a space, and blank lines — falls through
to the default foreground, which is correct: unchanged context should read as ordinary text.

Rule 6's separator pattern must not swallow a `---` file header. Rule 3 runs first and
requires a space after `---`, so a bare `-----` line reaches rule 6 as intended. Verify this
ordering against the real file `patches/monaco-editor+0.55.1.patch`.

### 2. `configure-monaco.ts`

- Import `definePatchLanguage` alongside the other four (lines 6-10).
- Call it in the registration block, after `defineLogLanguage(monaco)` (line 231).
- Add a `// Patch/diff colors` block to `customTokenRules`, after the log block:

```ts
{ token: "inserted.patch", foreground: "2fa84f" },
{ token: "deleted.patch", foreground: "e5534b" },
{ token: "meta.range.patch", foreground: "c586c0" },
{ token: "meta.file.patch", foreground: "569cd6" },
{ token: "meta.header.patch", foreground: "569cd6", fontStyle: "bold" },
{ token: "meta.patch", foreground: "808080" },
```

These are mid-tone green and red, chosen to stay legible on both the `vs-dark` and `vs`
theme bases — see Concerns.

### 3. `src/renderer/core/utils/monaco-languages.ts`

Append to `extraLanguages`, matching the registration in step 1 exactly:

```ts
{
    "aliases": ['Patch', 'patch', 'Diff', 'diff'],
    "extensions": [".patch", ".diff"],
    "id": "patch"
}
```

### 4. `doc/architecture/folder-structure.md`

Line ~197 lists the `monaco-languages/` files individually (`jsonl.ts  # JSONL (JSON Lines)
syntax highlighting`). Add the `patch.ts` row in the same style.

## Concerns / Open questions

**Token colours are global across all nine themes.** `customTokenRules` is passed to
`defineMonacoTheme` for every theme, and three of the nine (`light-modern`, `quiet-light`,
`solarized-light`) use `base: "vs"` with a light background. Every existing custom language
already has this limitation — the log palette is tuned for dark and washes out on Quiet
Light. Rather than extend the problem, the green and red above are picked mid-tone so they
read on both. Making `customTokenRules` per-theme is a real improvement, but it is a
separate task touching all nine theme files; **do not do it here.**

**Not highlighting the patched content.** The user asked for this explicitly: a `.patch`
containing JavaScript must not be coloured as JavaScript. Structural diff colouring only —
no embedded-language tokenizer, no attempt to infer the target file's type from the header.

**`.diff` is included** alongside `.patch`; it is the same format under a second
conventional extension, and nothing else in the app claims it (verified against both
language lists in `monaco-languages.ts`).

## Acceptance criteria

- [ ] Opening `patches/monaco-editor+0.55.1.patch` shows added lines green, removed lines
      red, `@@` hunk headers distinct, `diff --git`/`index`/`---`/`+++` as headers, and
      context lines in the ordinary foreground.
- [ ] No line of that file is mis-tokenized — in particular no `---`/`+++` header appears
      as a removed or added line, and no context line is coloured.
- [ ] "Patch" appears in the tab Language dropdown, and is selected automatically when a
      `.patch` or `.diff` file is opened.
- [ ] Colours remain readable on both a dark theme (Default Dark) and a light one
      (Light Modern).
- [ ] `npm run typecheck`, `npm run lint`, `npm run build-prod` all pass.
