# EPIC-010: Rest Client

## Status

**Status:** Active
**Created:** 2026-03-23

## Overview

A built-in REST Client editor for js-notepad — a lightweight alternative to Postman for sending HTTP requests and organizing them in collections. Data is stored in `.rest.json` files that can be opened, saved, and shared like any other file.

## Motivation

Developers frequently need to test APIs — check endpoints, inspect headers, debug responses. Currently this requires switching to a separate tool (Postman, Insomnia, curl). Having a REST Client built into js-notepad means:

- API testing available alongside code editing, script execution, and data viewing
- Collections stored as plain JSON files — version-controlled, shareable, portable
- Full header control via Node.js HTTP (no Chromium interference with headers)
- Scriptable via the existing js-notepad scripting system (`app`, `page` API)

## Goals

- Simple, focused tool — collections and requests, no environments/variables/scripts/auth presets
- `.rest.json` file format — open/save like any file, registered in the editor system
- Node.js HTTP backend (`nodeFetch`) — full header control, no Chromium header injection
- `nodeFetch` available globally for scripts — useful beyond the REST Client editor

## Non-Goals (intentionally excluded from initial implementation)

- Environments / variables
- Pre-request / post-request scripts
- Authentication presets (OAuth, Bearer, etc.)
- Import from Postman/Insomnia/Swagger
- WebSocket / GraphQL support
- Cookie management

These can be added in future epics if needed.

## Architecture

### Two main components

1. **`nodeFetch`** — Node.js HTTP client function in the renderer process (`nodeIntegration: true`). Returns a standard `Response` object. Full header control, streaming support, redirect handling, decompression.

2. **Rest Client Editor** — A new editor registered for `.rest.json` files. Displays a collection of requests with a request builder UI and response viewer.

### nodeFetch (infrastructure — used by Rest Client and scripts)

Based on the proven implementation in `D:\projects\av-player\src\main\network\nodeHttpFetch.ts`.

**Location:** Renderer process (`src/renderer/api/node-fetch.ts`). No IPC needed — `nodeIntegration: true` gives direct access to Node.js `http`/`https`.

**Features:**
- Pure Node.js `http`/`https` — no Chromium headers added
- Full header control — headers sent exactly as specified
- Redirect handling (301, 302, 303, 307, 308) with proper method/header adjustments
- Automatic decompression (gzip, deflate, br, zstd)
- Streaming response body via `ReadableStream`
- Configurable timeout
- Returns standard web `Response` object

**Script API access:** Available as `app.fetch(url, options)` — scripts can make HTTP requests with full header control.

### .rest.json File Format

```json
{
    "version": 1,
    "name": "My API Collection",
    "requests": [
        {
            "id": "req-1",
            "name": "Get Users",
            "method": "GET",
            "url": "https://api.example.com/users",
            "headers": {
                "Authorization": "Bearer token123",
                "Accept": "application/json"
            },
            "body": null
        },
        {
            "id": "req-2",
            "name": "Create User",
            "method": "POST",
            "url": "https://api.example.com/users",
            "headers": {
                "Content-Type": "application/json"
            },
            "body": "{ \"name\": \"John\", \"email\": \"john@example.com\" }"
        }
    ]
}
```

### Rest Client Editor UI

**Layout:** Two-panel — request list on the left, request builder + response on the right.

**Request List (left panel):**
- TreeView component displaying collection/requests hierarchy
- Add / delete / rename / reorder requests
- Click to select and edit

**Request Builder (right panel, top):**
- Method selector (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS)
- URL input
- Headers editor — AVGrid with editable key-value rows and combobox dropdown for known header names (Accept, Authorization, Content-Type, etc.)
- Body editor (Monaco Editor for JSON/text)
- Send button wired to `nodeFetch`

**Response Viewer (right panel, bottom):**
- Status code + status text + timing
- Response headers (key-value display)
- Response body (Monaco Editor — auto-detect JSON for formatting)
- Context menu: "Open as JSON page", "Open as Grid", "Open as HTML"

### Paste from browser

Support pasting requests copied from browser DevTools network tab:
- **Copy as cURL** — parse cURL command into method, URL, headers, body
- **Raw HTTP** — parse raw header block format

Note: adding a custom context menu item to Chromium DevTools is not possible (DevTools is sandboxed). Users use the existing "Copy as cURL" in DevTools, then paste into the Rest Client.

## Implementation Plan

### Phase 1: Core Editor

| Task | Title | Delivers |
|------|-------|----------|
| US-242 | nodeFetch — Node.js HTTP Client | `app.fetch()` — Node.js HTTP with full header control (done) |
| US-243 | Rest Client editor — basic shell | Editor registered for `.rest.json`, two-panel layout, collection tree (TreeView), file load/save, add/delete/rename requests |
| US-244 | Request builder | Method selector, URL input, headers with combobox + auto-add, body textarea, Send button, response caching (done) |
| US-245 | Response viewer | Status/timing, response headers, response body (Monaco, auto-detect JSON) |

### Phase 2: Enhancements

| Task | Title | Delivers |
|------|-------|----------|
| US-246 | Paste request from browser | Parse "Copy as cURL" and raw HTTP format from clipboard into a new request |
| US-247 | Result integration | Open response body in new js-notepad page (JSON/grid/HTML). Context menu on response with "Open as..." |
| US-248 | Request body types & enhancements | Body type selector (JSON, raw, x-www-form-urlencoded). Form-data key-value editor (reusable component from headers). Refactor header inputs into shared KeyValueEditor component. |

## Design Decisions

### DevTools integration (not feasible)

Chromium DevTools is a sandboxed component — no Electron API exists to add context menu items to it. Instead, we rely on DevTools' built-in "Copy as cURL" which our paste feature can parse.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-242 | nodeFetch — Node.js HTTP Client | Done |
| US-243 | Rest Client editor — basic shell | Done |
| US-244 | Request builder | Done |
| US-245 | Response viewer | Done |
| US-246 | Paste request from browser | Done |
| US-247 | Result integration | Done |
| US-248 | Request body types & enhancements | Done |
| US-249 | Requests management | Done |
| US-250 | MCP & API integration | Done |
| US-251 | Binary data support | Done |
| US-252 | Header view switch (Table/JSON) | Done |
