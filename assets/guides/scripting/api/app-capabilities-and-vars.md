---
title: "app: Capabilities and Variables"
audience: user
summary: "How do scripts call capabilities, access board variables, and manage menu folders?"
---

# app: Capabilities and Variables

## capabilities

Discover and invoke capabilities supplied by Persephone or eligible Boards; see [Capabilities](../../agents/capabilities/index.md) for `app.capabilities.get`, providers and method kinds. Discovery is
read-only and does not open a handler page. The new `get` method uses the same provider selection
rules as Board `getCapability`; it defaults to major version 1. An unpinned `invoke()` selects an
eligible provider using `capabilities.preferredProviders` and can use any available major version.
Pass `id@major` or `options.version` to pin it. See
[Boards — capability handlers and in-memory intents](../../boards/capability-handlers.md#capability-handlers-and-in-memory-intents)
for the manifest and handler-side contract.

The following `handlers`, `list` and `invoke` examples use legacy discovery and wrappers:

```javascript
const handlers = app.capabilities.handlers("content.view", { representation: "markdown" });
const available = app.capabilities.list();

const opened = await app.capabilities.invoke("text.open", {
    content: "# Report",
    language: "markdown",
    title: "Report",
});
console.log(opened.pageId);
```

Well-known capability ids include `http.request.open` (open a REST request collection), `image.edit`
(open an image in an editor), and `certificate.view` (render a site's certificate chain). A
`certificate.view` v1 payload has a hostname `title`, a non-empty leaf-first `certificates` array
of base64 DER strings, and optional `source: { url }`. Persephone validates the certificate data
and limits decoded chains to 256 KiB before invoking a handler:

```javascript
// Assuming pages[0] is a browser page.
const certificate = await pages[0].editor.getCertificate();
if (certificate) {
    await app.capabilities.invoke("certificate.view", {
        title: new URL(certificate.url).hostname,
        certificates: certificate.certificates,
        source: { url: certificate.url },
    }, { version: 1 });
}
```

### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `list()` | `readonly CapabilityInfo[]` | List all indexed platform and trusted-Board capability candidates. |
| `handlers(id, filter?)` | `readonly CapabilityInfo[]` | List candidates for one id; `filter` may specify a MIME type with `{ mime }` or a content representation with `{ representation }`. |
| `invoke(id, payload, options?)` | `Promise<unknown>` | Select and invoke an eligible handler. Without a version pin, provider preference and priority choose among available major versions; use `id@major` or `options.version` to pin one. |

`invoke()` options are `version`, `filter: { mime, representation }`, `pageId`, `signal`, and `deadlineMs`.
`pageId` preserves the originating page when an invocation is part of a page workflow;
`signal` cancels it and `deadlineMs` bounds how long the caller waits. Built-in open/edit
capabilities normally return a page result; `diagram.edit` can instead return
`{ status: "conversion-failed", message }`. Board handlers commonly return
`{ pageId?, result? }`.

Failures reject with a typed capability error. Its `code` is one of `no-handler`, `untrusted`,
`handler-closed`, `crashed`, `cancelled`, `timeout`, `cycle`, `payload-too-large`, `busy`, or
`rejected`. Error codes remain stable; limit errors use concise messages. A timeout or cancellation
stops waiting and sends a best-effort cancellation to the handler; it cannot stop work that the
handler has already started.

---

## boardVars

Admin-level access to the [board environment-variables store](../../boards/env-vars.md#environment-variables--secrets-outside-the-board-folder) (a single, optionally password-encrypted `.env.json` file kept outside every board folder). A board's own `persephone.var.*` bridge is locked to its own namespace; `app.boardVars` is unrestricted — since scripts already run with the same trust as `app.fs`/`app.settings`, the agent may target **any** namespace. The typical use is to provision a board's secrets ahead of time, right after scaffolding it, so the board finds its variables already in place the first time it calls `persephone.var.get(...)`.

```javascript
// Scaffold a board, then provision its connection secrets before the user ever opens it
const root = await app.boards.createBoard("Snowflake Viewer", "C:/work/boards");
const namespace = await app.boardVars.namespaceFor(root);
await app.boardVars.set(namespace, "SNOWFLAKE_SERVER", "abc123.snowflakecomputing.com");
await app.boardVars.set(namespace, "SNOWFLAKE_USER", "my-user");
await app.boards.openBoard(root);
```

Every method may show the user a one-time **"Create environment variables storage"** dialog (no `.env.json` configured yet) or a decrypt-password prompt (the file is encrypted and locked this session) — both are real UI, so the call resolves only after the user responds, and rejects if they decline/cancel.

### Methods

| Method | Returns | Description |
|--------|---------|--------------|
| `namespaceFor(boardRoot)` | `Promise<string>` | Resolves `boardRoot`'s vars namespace exactly as the board itself would see it — its manifest's `author`/`name` when both are explicitly set, otherwise the board's root path. Always use this instead of constructing the namespace string by hand. |
| `get(namespace, name, env?)` | `Promise<string \| undefined>` | A single value from `namespace`'s profile (`default` when `env` is omitted), or `undefined` if unset. |
| `set(namespace, name, value, env?)` | `Promise<void>` | Write one value into `namespace`'s profile (`default` when `env` is omitted), creating the namespace/profile if needed. Persisted immediately — re-encrypted on save if the file is encrypted. |
| `list(namespace, env?)` | `Promise<string[]>` | Key names (not values) in `namespace`'s profile (`default` when `env` is omitted). |
| `listNamespaces()` | `Promise<string[]>` | Every namespace currently present in the configured `.env.json`, including ones a board wrote to itself. |
| `show(namespace?)` | `Promise<void>` | Open the built-in `.env.json` editor. Focused on `namespace` when given; opens the whole file unscoped when omitted. |

---

## menuFolders

Manage sidebar folders (persisted to `menuFolders.json`).

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `folders` | `IMenuFolder[]` | Current list of configured folders. |

### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `add({ name, path?, files? })` | `string` | Add a folder. Returns the generated ID. |
| `remove(id)` | `void` | Remove a folder by ID. |
| `find(id)` | `IMenuFolder \| undefined` | Find a folder by ID. |
| `move(sourceId, targetId)` | `void` | Reorder folders. |

### IMenuFolder

| Property | Type | Description |
|----------|------|-------------|
| `id` | `string` | Unique folder ID. |
| `name` | `string` | Display name. |
| `path` | `string?` | Folder path on disk. |
| `files` | `string[]?` | Explicit list of file paths (virtual folders). |

```javascript
// List all sidebar folders
app.menuFolders.folders.forEach(f => console.log(f.name, f.path));

// Add a project folder
app.menuFolders.add({ name: "My Project", path: "C:/projects/my-app" });
```
