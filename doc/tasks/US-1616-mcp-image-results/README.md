# US-1616: Screenshots and other image results survive the MCP length limit

## Status

**Status:** Planned
**Priority:** Medium
**Epic:** none (standalone)

## Goal

An image returned through the MCP `call` tool (for example `window.screen.screenshot()`) must arrive
whole with the default `maxLength`, without the agent having to pass `maxLength: 2000000`.
External evaluation finding B1 (2026-10-03).

## Background

- `ai-vision`'s `shapeResult()` (`C:\projects\ai-vision\src\core\result-shaper.ts:32-48`) bounds
  every result at `maxLength` (default 20 000). An image record `{ type: "image", data, mimeType }`
  is a plain object, so `shapeValue()` cuts the `data` string, and `truncateObject()` drops whole
  keys — the evaluator received only `{ type: "image" }` with "showing 1 of 3 items".
- The limit exists to protect the agent's text context. Images are not text there: Persephone's
  main process (`src/main/mcp/tools/call-tools.ts:308-324`, `callImageResult()`, and
  `toCallResult()` line 349-352) turns an image record into an MCP image content block.
- Image records today: `IBrowserScreenshot` (`src/renderer/api/types/browser-editor.d.ts:85-89`,
  used by `window.screen.screenshot()` and `pages[i].editor.screenshot()`) and clipboard image
  entries (`src/renderer/scripting/ai-vision/namespaces/clipboard.ts:64-66,150-152`). Both use the
  top-level `{ type: "image", data: string, mimeType: string }` shape.
- Persephone cannot fix this on its side: the value is shaped inside `resolveCall()` before
  Persephone sees the result. `ai-vision` is the user's own library (repo `C:\projects\ai-vision`,
  current 1.2.0; Persephone depends on `^1.2.0`).

## Implementation plan

### Part A — ai-vision 1.2.1 (`C:\projects\ai-vision`)

1. `src/core/result-shaper.ts`: before the string check in `shapeResult()`, return image records
   untouched:
   ```ts
   /** An image record is sent to the client as an image block, not as text, so the text bound
    *  does not apply; cutting its data only produces a broken image. */
   function isImageRecord(value: unknown): value is { type: "image"; data: string; mimeType: string } {
       if (!value || typeof value !== "object" || !isPlainObject(value)) return false;
       const record = value as Record<string, unknown>;
       return record.type === "image" && typeof record.data === "string" && typeof record.mimeType === "string";
   }
   ...
   if (isImageRecord(value)) return { result: { ...value } };
   ```
   Copy only plain fields (the record must stay JSON-safe); extra metadata fields such as `width`
   pass through as they are.
2. Document the rule in the `shapeResult` comment and `README.md` (result shaping section), and add
   a `## 1.2.1` CHANGELOG entry.
3. `npm run build`; bump version to 1.2.1. Publishing to npm is the user's step — ask before
   `npm publish` and before pushing the ai-vision repo.

### Part B — Persephone

4. Bump `ai-vision` to `^1.2.1` in `package.json` and `package-lock.json` (`npm install ai-vision@1.2.1`).
5. Update the `maxLength` description in `src/main/mcp/tools/call-tools.ts:186` to say image
   results are not bounded by it.
6. Remove any guide or `$help` advice telling agents to raise `maxLength` for screenshots (grep
   `assets/guides/` and `src/renderer/scripting/ai-vision/` for `maxLength`).

## Concerns

- Very large full-page screenshots now always arrive whole. That is the purpose; an agent that
  asked for a screenshot wants the image. JPEG with `quality` stays the way to make it smaller.
- Only a top-level image record is exempt. An image nested in an array or object is still bounded —
  intentionally, so a list of records cannot bypass the limit.
- `app.call()` and `persephone.call()` already run unbounded (`call-limits.ts`); no behavior change there.

## Acceptance criteria

- [ ] `call window.screen.screenshot` with `args: []` and no `maxLength` returns a full, viewable image.
- [ ] A long string result is still truncated at 20 000 characters.
- [ ] ai-vision 1.2.1 built and published (by the user); Persephone depends on it.
- [ ] `npm run typecheck`, `npm run lint`, `npm run build-prod` pass in Persephone.

## Files changed

| File | Change |
|---|---|
| `C:\projects\ai-vision\src\core\result-shaper.ts` | Exempt top-level image records |
| `C:\projects\ai-vision\README.md`, `CHANGELOG.md`, `package.json` | 1.2.1 |
| `package.json`, `package-lock.json` | `ai-vision@^1.2.1` |
| `src/main/mcp/tools/call-tools.ts` | `maxLength` description |

No changes needed: `callImageResult()` / `toCallResult()` already handle image records.
