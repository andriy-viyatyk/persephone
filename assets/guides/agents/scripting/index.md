---
title: "Scripting API"
audience: "agent"
summary: "How do scripts execute, load, type-check, and run in the main process?"
---

# Scripting API — script.execute
The `script.execute` path runs JavaScript or TypeScript in Persephone's renderer context. Inspect
`script.$help` for the live execution contract; this resource keeps longer API examples and
format/reference material.

## Execution model & security

The live execution, privilege, timeout, result, and dialog contract is owned by `script.$help`.
Use this resource for longer API examples and reference material; do not infer a second execution
protocol from the examples below.

## The `io` registry

Renderer scripts can call `io.registerProvider(type, factory)` and
`io.registerScheme(scheme, hooks)` to add a provider and URL scheme for the current renderer
session. Factories return the structural provider shape; scheme hooks can use `context.handoff()`
to continue through the normal pipeline. Scheme matching is case-insensitive, and the pipeline
lowercases only the URL scheme prefix before dispatch while preserving the remainder. Open
registered schemes with `app.events.openRawLink.sendAsync(io.createLinkData(url))`
or the existing `app.openRawLink` helper. Script-owned re-registration replaces the previous entry
with an info report, while platform-owned duplicates remain first-wins errors. Registrations are
cleared by a renderer reload/restart, not by autoload re-execution; existing live pipes keep their
provider objects, and persisted script providers do not recover until the registration script runs.
The first construction from a script-registered factory checks the required provider members and
reports one error naming the provider type and missing members if the shape is invalid; that result
is cached until the script-owned registration is replaced.

## Main-process scripts via `call`

The `call` tree also exposes `main.script.execute(code)`, guarded by Settings → MCP Server →
`Allow main-process scripts`. This runs in Electron's main process and can freeze or terminate the
whole app, so use it only for deliberate diagnostics. The evaluator supplies these scope names:
`electron`, `openWindows`, `torService`, `downloadService`, `boardDownloadService`,
`publishedBoardsService`, `boardProtocol`, and `networkLogger`. Expressions and `await` work, and
the result is shaped as `{ result, isError, timedOut?, consoleLogs }`; console logs use
`{ level, args, timestamp }` entries like renderer script capture.

Main evaluation has a 10-second timeout. A timed-out async promise cannot be cancelled by
`Promise.race`, so it may continue and can still perform side effects. Side effects before an
exception or timeout remain performed. A synchronous `while (true) {}` blocks the main event loop,
defeats the timer, and freezes every window until the code returns or the process is killed; it is
not safely timeout-able.


## TypeScript Support

The `script.execute` path accepts an optional `language` parameter. Set it to `"typescript"` to write scripts with type annotations — types are stripped via sucrase before execution.

```
script.execute("const x: number = 42; x", undefined, "typescript")
```

TypeScript scripts have the same access to `page`, `app`, and Node.js APIs as JavaScript scripts. All type annotations are removed at runtime — no type checking is performed.


## Node.js Access

Scripts have full Node.js access via `require()`:

```javascript
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
```

When using `main.script.execute`, a caught error returns `{ result: <error text>, isError: true,
consoleLogs }` and never escapes as an MCP unhandled rejection. The timeout response sets
`timedOut: true`; an async evaluation may still be running. These semantics are separate from the
renderer `script.execute` lifecycle described below.

Renderer `script.execute` returns before the 30-second bridge deadline. It waits up to 25 seconds;
a long-running script returns `{ pending: true, runId, pendingReason: "running" }`, while a script
blocked by a renderer dialog returns `pendingReason: "dialog"` with attention instructions. Answer
the dialog through `dialogs[0]`, then call `script.result(runId, { timeoutMs })`. Polling waits at
most 25 seconds and returns the same run id while the script continues. A completed result is
consumed once. Pending results expire after five minutes and the renderer keeps at most 32 runs.

## Errors & verification

What failures actually look like in the `script.execute` result (verified against the app):

- **A thrown exception** (or syntax error) returns `isError: true` with the error message and
  submitted-script stack frames in `text`; renderer-internal frames are filtered out. Any
  `consoleLogs` captured before the throw are preserved. There is no partial return value — but side effects the script performed before
  throwing (files written, pages created) **have already happened**.
- **Reserved globals.** `page` and `app` are injected into the script scope — declaring
  `const page = …` fails with `Identifier 'page' has already been declared`. Pick another name.
- **Wrong API guesses fail loudly and cheaply** — e.g. `app.pages.list is not a function` with
  a stack trace. The fix is this guide, not trial-and-error: the `app` surface is exactly what
  this document lists.
- **`Error: Request timeout`** after ~30 s — see "Execution model & security" above: the script
  is still running; only the response was abandoned. A common non-obvious cause:
  `app.pages.closePage()` on a **modified** page shows the user an "Unsaved Changes" dialog and
  blocks until they answer — if you truly don't need the content, it is your responsibility to
  have saved or discarded deliberately, not to assume the close is silent.
- **Verify side effects, not intentions**: after writing a file, `await app.fs.exists(path)`;
  after creating/modifying a page, `pages[i].content` (content) or
  `window.screen.snapshot()` (rendering). A `true`/content response from those is
  ground truth; your script returning without error is not.

## Read next

| What you need | Page (object-model path) |
|---|---|
| The app object | [the-app-object](the-app-object.md) - `guides.agents.scripting["the-app-object"]` |
| Editor facades and practical examples | [editor-facades-and-examples](editor-facades-and-examples.md) - `guides.agents.scripting["editor-facades-and-examples"]` |
