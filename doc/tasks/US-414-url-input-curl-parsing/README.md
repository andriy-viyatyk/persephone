# US-414: URL input with cURL parsing and format detection

## Goal

Update `VideoEditorModel.submitUrl` to call `parseHttpRequest()` so that pasting a cURL or fetch() command extracts the real URL and custom headers for playback.

## Background

### What's already done (US-412 + US-413)

`VideoPlayerEditor.tsx` already contains the full UI shell and player. The current model has a gap: `submitUrl` ignores cURL parsing and always sets `parsedRequest = null`.

**`VideoEditorModel.submitUrl`** — current broken state:
```typescript
submitUrl = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.state.update((s) => {
        s.inputText = trimmed;
        s.url = trimmed;                      // ← wrong when text is a cURL command
        s.format = detectVideoFormat(trimmed); // ← wrong — detects from cURL text, not URL
        s.parsedRequest = null;               // ← always null, never populated
        s.playerState = "loading";
    });
};
```

**`VideoPlayerEditor` component** — already has `UrlInputArea` with Enter key handler calling `model.submitUrl(inputText)`. No UI changes needed.

**`VPlayer` component** — already accepts `parsedRequest` prop and routes it to `NodeFetchHlsLoader`. No changes needed.

### Utilities available (no changes needed)

- `parseHttpRequest(text)` at `src/renderer/core/utils/curl-parser.ts:26` — returns `ParsedHttpRequest | null`. Returns `null` for plain URLs, non-null for `curl ...` and `fetch(...)` commands. The `ParsedHttpRequest` shape: `{ url, method, headers, body }`.
- `detectVideoFormat(src)` at `src/renderer/editors/video/video-types.ts:17` — takes a URL string, returns `"mp4" | "m3u8"`.

## Implementation Plan

### Step 1 — Add `parseHttpRequest` import

**File:** `src/renderer/editors/video/VideoPlayerEditor.tsx`

Add the value import alongside the existing type import:
```typescript
// BEFORE (line ~11):
import type { ParsedHttpRequest } from "../../core/utils/curl-parser";

// AFTER:
import type { ParsedHttpRequest } from "../../core/utils/curl-parser";
import { parseHttpRequest } from "../../core/utils/curl-parser";
```

### Step 2 — Update `submitUrl` to call `parseHttpRequest`

**File:** `src/renderer/editors/video/VideoPlayerEditor.tsx`, `VideoEditorModel.submitUrl`

```typescript
// BEFORE:
submitUrl = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.state.update((s) => {
        s.inputText = trimmed;
        s.url = trimmed;
        s.format = detectVideoFormat(trimmed);
        s.parsedRequest = null;
        s.playerState = "loading";
    });
};

// AFTER:
submitUrl = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const parsed = parseHttpRequest(trimmed);
    const resolvedUrl = parsed ? parsed.url : trimmed;
    this.state.update((s) => {
        s.inputText = trimmed;
        s.url = resolvedUrl;
        s.format = detectVideoFormat(resolvedUrl);
        s.parsedRequest = parsed ?? null;
        s.playerState = "loading";
    });
};
```

**What changed:**
- `parseHttpRequest(trimmed)` — if non-null, it's a cURL/fetch command; extract `parsed.url`
- `resolvedUrl` — the real video URL (whether from plain input or parsed cURL)
- `s.parsedRequest = parsed ?? null` — populated with headers when a cURL command is detected

## Acceptance Criteria

1. Pasting `curl 'https://example.com/stream.m3u8' -H 'Origin: https://example.com'` into the URL bar and pressing Enter:
   - Sets `url` to `https://example.com/stream.m3u8` (not the full cURL command)
   - Sets `parsedRequest.headers` to `{ "Origin": "https://example.com" }`
   - Sets `format` to `"m3u8"`
2. Pasting a plain URL and pressing Enter sets `url`, detects format, leaves `parsedRequest = null`
3. `fetch("https://example.com/video.mp4", { headers: { "Authorization": "Bearer token" } })` — parsed as fetch command, `url` and `headers` extracted correctly

## Files Changed Summary

| File | Change |
|------|--------|
| `src/renderer/editors/video/VideoPlayerEditor.tsx` | Add `parseHttpRequest` import; update `submitUrl` to call it |

## Files That Need NO Changes

- `src/renderer/editors/video/VPlayer.tsx` — already accepts `parsedRequest`, no changes
- `src/renderer/editors/video/NodeFetchHlsLoader.ts` — no changes
- `src/renderer/editors/video/video-types.ts` — already has `detectVideoFormat`, no changes
- `src/renderer/core/utils/curl-parser.ts` — already handles all formats, no changes
- `src/renderer/api/node-fetch.ts` — no changes
- `src/renderer/editors/register-editors.ts` — no changes
