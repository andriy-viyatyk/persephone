# EPIC-020: Browser Network Request Logging & Resource Discovery

## Status

**Status:** Active
**Created:** 2026-04-05

## Overview

Add HTTP request/response logging to the browser editor's webview sessions. Electron's `session.webRequest` API intercepts all network traffic per partition — capturing URL, method, headers, request body, response status, and resource type. Logs are stored in a circular buffer in the main process and exposed to the renderer via IPC. "Show Resources" merges network-logged requests with DOM-extracted resources, producing cURL-formatted `ILink[]` items. GET requests open normally; POST/PUT/etc open in the RestClient editor.

## Goals

- Capture all HTTP/HTTPS requests made by browser webviews (including fetch, XHR, script-initiated)
- Provide network logs to the renderer on demand via IPC
- Merge network resources into "Show Resources" output
- Open non-GET requests in RestClient editor via cURL link integration

## Technical Context

### Electron webRequest API

`session.webRequest` provides non-blocking interceptors per session partition:

- **`onBeforeSendHeaders`** — fires before request is sent. Provides: `id`, `url`, `method`, `requestHeaders`, `uploadData[]`, `resourceType`, `referrer`, `timestamp`
- **`onCompleted`** — fires when response is complete. Provides: `id`, `url`, `method`, `responseHeaders`, `statusCode`, `statusLine`, `fromCache`, `resourceType`
- **`onErrorOccurred`** — fires on network error. Provides: `id`, `url`, `method`, `error`, `resourceType`

Requests are correlated by numeric `id` (unique per session).

`uploadData[]` contains `{ bytes: Buffer, blobUUID?: string, file?: string }`. For `fetch()` POST with JSON body, `bytes` contains the raw body. For form submissions, it contains URL-encoded form data. `blobUUID` requires `session.getBlobData(uuid)` to retrieve.

### Partition structure

Browser partitions follow the pattern (from `BrowserEditorModel.getPartitionString()`):
- Regular: `persist:browser-${profileName}` (persistent)
- Incognito: `browser-incognito-${uuid}` (ephemeral)
- Tor: `browser-tor-${uuid}` (ephemeral)

The `session-created` hook in `browser-service.ts` already processes every new session (currently for User-Agent cleanup). This is the natural place to attach webRequest listeners.

### Existing cURL pipeline

Persephone already handles cURL links end-to-end:
- `curl-parser.ts` — `parseHttpRequest()` parses cURL strings → `{ url, method, headers, body }`
- Layer 1 parser in `parsers.ts` — detects `curl ...` strings, extracts metadata, fires `openLink`
- Layer 2 resolver — `resolveHttpPipeDescriptor()` creates `HttpProvider` with method/headers/body
- RestClient editor — `.rest.json` format with `RestRequest[]`, openable via `addEditorPage("rest-client", ...)`

### What "Show Resources" currently does

1. Collects full DOM (including iframes) via `BrowserChannel.collectDom` IPC
2. Passes HTML to `extractHtmlResources()` which finds `<img>`, `<script>`, `<link>`, etc.
3. Opens results as `ILink[]` via `pagesModel.openLinks()`

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-362 | Network request logging in main process | Done |
| US-363 | Merge network logs into Show Resources | Done |
| US-364 | Open non-GET network requests in RestClient | Planned |

## Notes

### 2026-04-05
- Epic created based on observation that "Show Resources" only sees DOM-referenced resources, missing fetch/XHR requests
- Key insight: Electron's `session.webRequest` API is the right tool — no DevTools Protocol needed
- `uploadData.bytes` provides raw POST body as Buffer — straightforward to convert to string for cURL generation
- `blobUUID` case (large uploads) may need `session.getBlobData()` — consider skipping blob bodies for simplicity
- Request `id` is per-session, monotonically increasing — perfect for correlating request/response pairs
