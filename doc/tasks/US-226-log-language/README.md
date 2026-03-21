# US-226: Log Language for Monaco with Syntax Highlighting

## Goal

Add a custom "log" language to Monaco editor with syntax highlighting for `.log` files, similar to VSCode's built-in log highlighting but with customized color choices (strings shown as gray/silver instead of red).

## Background

The project already has 4 custom Monaco languages defined using the Monarch tokenizer pattern:
- `reg` — `/src/renderer/api/setup/monaco-languages/reg.ts`
- `csv` — `/src/renderer/api/setup/monaco-languages/csv.ts`
- `mermaid` — `/src/renderer/api/setup/monaco-languages/mermaid.ts`
- `jsonl` — `/src/renderer/api/setup/monaco-languages/jsonl.ts`

All follow the same 3-step registration pattern:
1. `monaco.languages.register({ id, extensions, aliases })`
2. `monaco.languages.setLanguageConfiguration(id, conf)`
3. `monaco.languages.setMonarchTokensProvider(id, monarchLanguage)`

Custom token colors are added to the `customTokenRules` array in `/src/renderer/api/setup/configure-monaco.ts` (lines 25–69).

Language metadata is listed in `/src/renderer/core/utils/monaco-languages.ts` — extra languages array (lines 3–24).

### Log file format (example from Claude MCP server log)

```
2026-03-21T07:26:14.374Z [js-notepad] [info] Initializing server... { metadata: undefined }
2026-03-21T07:26:14.438Z [js-notepad] [info] Using MCP server command: C:\WINDOWS\System32\cmd.exe with args and path: {
```

Common log patterns to highlight:
- **Timestamps** — ISO 8601 (`2026-03-21T07:26:14.374Z`), date-only (`2026-03-21`), time-only (`07:26:14`), common log format (`21/Mar/2026:07:26:14`)
- **Log levels** — ERROR, WARN/WARNING, INFO, DEBUG, TRACE, FATAL (case-insensitive, often in brackets like `[error]`)
- **Strings** — single-quoted `'...'` and double-quoted `"..."` — should be **gray/silver** (not red)
- **Numbers** — integers and floats
- **Constants** — `true`, `false`, `null`, `undefined`, `NaN`
- **URLs** — `http://`, `https://`, `ftp://`
- **File paths** — Windows (`C:\...`) and Unix (`/path/to/file`)
- **GUIDs** — `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`
- **Exception/stack trace keywords** — `Exception`, `Error`, `at`, `Caused by`, `Traceback`
- **Brackets** — `[...]` sections (common for logger names, levels)

### VSCode's implementation (reference)

VSCode's log highlighting lives in `extensions/log/` and is derived from [emilast/vscode-logfile-highlighter](https://github.com/emilast/vscode-logfile-highlighter). Key design choices:

- **Three patterns per log level**: full word (`ERROR`), bracketed abbreviation (`[err]`, `[e]`), and single-letter at line start for Android logcat (`E`). We'll adopt the first two but skip single-letter matching (too noisy, too many false positives).
- **Reuses TextMate scopes** for theme compatibility (e.g., `markup.inserted` for info). We don't need this — we use explicit token rules in `customTokenRules`.
- **Additional patterns we should adopt**: GUIDs, URLs, hex literals (`0x...`), numbers, booleans, `null`, exception types (`*.Exception`), stack trace lines (`at ...`).
- **Patterns we can skip for now**: git hashes (7/10/40-char hex — too many false positives with log data), MAC addresses, domain names.

### VSCode differences (user-requested)

| Element | VSCode | js-notepad (desired) |
|---------|--------|---------------------|
| Strings `'...'` / `"..."` | Red | **Gray / silver** (lighter than normal text) |
| Error/Fatal | Red | Red (same) |
| Warn | Yellow/orange | Yellow (same) |
| Info | Blue | Blue/cyan (same) |
| Debug/Trace | Green | Green (same) |
| Timestamps | Green | Subtle color (green or muted) |
| Numbers | Light green | Light green (same) |

## Implementation Plan

### Step 1: Create the language definition file

**File:** `/src/renderer/api/setup/monaco-languages/log.ts`

Create `defineLogLanguage(monacoInstance: Monaco): void` following the same pattern as `jsonl.ts`.

**Monarch tokenizer states:**

- **root** state:
  - ISO timestamps: `/\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?/` → `date.log`
  - Time-only: `/\d{2}:\d{2}:\d{2}(\.\d+)?/` → `date.log`
  - Log levels — match both full words and bracketed abbreviations (case-insensitive via `ignoreCase: true`):
    - Error: `\b(ERROR|FATAL|FAIL|FAILURE|CRITICAL|ALERT|EMERGENCY)\b` + `\[(error|eror|err|er|e|fatal|fatl|ftl|fa|f)\]` → `keyword.error.log`
    - Warn: `\b(WARNING|WARN)\b` + `\[(warning|warn|wrn|wn|w)\]` → `keyword.warn.log`
    - Info: `\b(INFO|INFORMATION|NOTICE|HINT)\b` + `\[(information|info|inf|in|i)\]` → `keyword.info.log`
    - Debug: `\b(DEBUG)\b` + `\[(debug|dbug|dbg|de|d)\]` → `keyword.debug.log`
    - Trace: `\b(TRACE|VERBOSE)\b` + `\[(verbose|verb|vrb|vb|v|trace|trc|t)\]` → `keyword.trace.log`
  - Exception types: `/\b[\w.]*Exception\b/` → `keyword.error.log`
  - Exception keywords: `/\b(Stacktrace|Traceback|Caused by)\b/` → `keyword.error.log`
  - Stack trace "at" lines: `/^\s+at\b/` → `keyword.error.log`
  - Double-quoted strings: `/"` → push `@string_double`
  - Single-quoted strings: `/'` → push `@string_single`
  - GUIDs: `/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/` → `constant.guid.log`
  - URLs: `/https?:\/\/[^\s'",)}\]]+/` → `constant.url.log`
  - Hex literals: `/\b0x[0-9a-fA-F]+\b/` → `number.log`
  - Numbers (standalone): `/\b\d+(\.\d+)?\b/` → `number.log`
  - Constants: `/\b(true|false|null|undefined|NaN)\b/` → `constant.log`

- **string_double** state:
  - `\\.` → `string.escape.log`
  - `"` → `string.log`, `@pop`
  - `[^"\\]+` → `string.log`

- **string_single** state:
  - `\\.` → `string.escape.log`
  - `'` → `string.log`, `@pop`
  - `[^'\\]+` → `string.log`

**Language configuration:**
- Brackets: `["`, `"]`, `{`, `}`
- No auto-closing needed for log files (read-only nature)

### Step 2: Register the language in configure-monaco.ts

**File:** `/src/renderer/api/setup/configure-monaco.ts`

1. Add import: `import { defineLogLanguage } from "./monaco-languages/log";`
2. Call `defineLogLanguage(monaco);` after the other language definitions (line ~218)
3. Add token color rules to `customTokenRules` array:

```typescript
// Log file colors
{ token: "date.log", foreground: "6a9955" },          // Green (muted) for timestamps
{ token: "keyword.error.log", foreground: "f44747" },  // Red for error/fatal
{ token: "keyword.warn.log", foreground: "cca700" },   // Yellow for warn
{ token: "keyword.info.log", foreground: "4fc1ff" },   // Cyan/blue for info
{ token: "keyword.debug.log", foreground: "4ec9b0" },  // Teal for debug
{ token: "keyword.trace.log", foreground: "6a9955" },  // Green for trace
{ token: "string.log", foreground: "a0a0a0" },         // Gray/silver for strings ← KEY DIFFERENCE
{ token: "string.escape.log", foreground: "a0a0a0" },  // Same gray for escapes
{ token: "number.log", foreground: "b5cea8" },          // Light green for numbers
{ token: "constant.log", foreground: "569cd6" },        // Blue for true/false/null
{ token: "constant.guid.log", foreground: "b5cea8" },   // Light green for GUIDs
{ token: "constant.url.log", foreground: "4fc1ff" },    // Cyan for URLs
{ token: "bracket.log", foreground: "888888" },          // Dim for brackets
```

### Step 3: Add language metadata

**File:** `/src/renderer/core/utils/monaco-languages.ts`

Add to `extraLanguages` array:
```typescript
{
    aliases: ['Log', 'log'],
    extensions: [".log"],
    id: "log"
}
```

### Files Changed Summary

| File | Action | Description |
|------|--------|-------------|
| `/src/renderer/api/setup/monaco-languages/log.ts` | **Create** | New Monarch tokenizer for log language |
| `/src/renderer/api/setup/configure-monaco.ts` | **Modify** | Import + call defineLogLanguage, add token color rules |
| `/src/renderer/core/utils/monaco-languages.ts` | **Modify** | Add "log" to extraLanguages array |

## Concerns / Open Questions

1. **Timestamp regex breadth** — Log timestamps come in many formats (ISO 8601, syslog, Apache CLF, etc.). Starting with ISO 8601 and basic date/time patterns covers most cases. We can extend later if needed.

2. **Performance on large log files** — Monarch tokenizers operate line-by-line and are fast. No concern here.

3. **String color (gray) readability** — `#a0a0a0` on the dark background should be visible but clearly dimmer than the default white (`#d4d4d4`) text. May need adjustment after visual testing.

4. **Overlap with JSONL** — Files ending in `.log.jsonl` already match JSONL language (more specific extension wins). Plain `.log` files will use this new language. No conflict.

## Acceptance Criteria

- [ ] `.log` files open with syntax highlighting in Monaco
- [ ] Language can be selected manually as "Log" from the language picker
- [ ] Timestamps appear in muted green
- [ ] Error/Fatal levels appear in red
- [ ] Warn levels appear in yellow
- [ ] Info levels appear in blue/cyan
- [ ] Debug/Trace levels appear in green/teal
- [ ] Quoted strings appear in gray/silver (NOT red)
- [ ] Numbers, constants, URLs, GUIDs are highlighted
- [ ] Exception/stack trace keywords highlighted in red
