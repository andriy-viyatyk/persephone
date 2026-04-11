# EPIC-012: Unified Link & Provider Architecture

**Status:** Active
**Priority:** High
**Created:** 2026-03-24

> **Note:** This is a design document. The core pipeline (providers, transformers, pipes, 3-layer link pipeline) is implemented. Some items described below are **not yet implemented** and marked accordingly: `BufferProvider`, `GunzipTransformer`, `EncodingTransformer`, `ITreeProvider` (FileSystemTreeProvider, ZipTreeProvider), `io.tree.d.ts`. Encoding is handled directly by `ContentPipe` (not via a transformer).
>
> **Historical note (EPIC-023):** The event types described in this document (`IRawLinkEvent`, `IOpenLinkEvent`, `IOpenContentEvent`, `ILinkMetadata`) were replaced by a unified `ILinkData` type in EPIC-023. All three pipeline channels now carry `ILinkData`. See [EPIC-023](EPIC-023.md) for details.

## Goal

Replace the scattered file/URL opening paths with a unified, event-driven link pipeline and introduce Provider + Transformer abstractions that decouple editors from data sources. Every link in the application — file paths, HTTP URLs, archive entries, cURL commands, magnet links, custom protocols — flows through one pipeline: **parse → resolve provider + transformers → assemble content pipe → open in editor**.

## Motivation

**Current problems:**
- File opening logic is scattered across 10+ entry points (pipe-server, will-navigate, file explorer, recent files, script API, browser, etc.) — all eventually calling `pagesModel.openFile()` but with different preprocessing
- Editors are tightly coupled to `app.fs` and file paths — a grid editor can't display data from an HTTP endpoint without saving it to a file first
- Archive support required special `!`-suffix path conventions that leak into editor code
- No extensibility — scripts can't intercept or customize link opening behavior
- Adding a new link type (e.g., ftp://, magnet://) requires changes across multiple unrelated files

**What this epic enables:**
- Single entry point for all navigation — `app.events.openRawLink.sendAsync(event)` or `app.events.openLink.sendAsync(event)`
- Content pipe abstraction — editors receive `IContentPipe` (provider + transformers) instead of a file path, enabling file/HTTP/buffer sources with ZIP/decrypt/gzip transforms
- Script extensibility — autoload scripts can register custom link parsers, providers, transformers, and open handlers
- Future protocols — ftp, magnet, custom app:// protocols are just new parsers + providers
- Extension-like architecture — third-party scripts can add new data sources, transformers, and viewers

## Architecture Overview

### Three-Layer Pipeline

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: RAW LINK PARSING                                  │
│  Channel: app.events.openRawLink                            │
│                                                             │
│  Input:  raw string (file path, URL, cURL command, etc.)    │
│  Output: handler fires openLink event directly              │
│                                                             │
│  Handlers (LIFO, first match wins):                         │
│    → cURL parser     "curl -H 'Auth: ...' https://..."      │
│    → HTTP parser     "https://example.com/data.json"        │
│    → archive parser  "C:\docs.zip!readme.txt"               │
│    → file parser     "C:\data\report.csv"  (fallback)       │
└──────────────────────────┬──────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│  Layer 2: PROVIDER + TRANSFORMER RESOLUTION                  │
│  Channel: app.events.openLink                               │
│                                                             │
│  Input:  IOpenLinkEvent { url, target?, metadata }          │
│  Output: handler fires openContent event directly           │
│                                                             │
│  Responsibilities (per handler):                            │
│    → Resolve target editor (if not specified)               │
│    → Create IProvider for the data source                   │
│    → Build transformers if needed (e.g., zip from "!")      │
│    → Assemble IContentPipe (provider + transformers)        │
└──────────────────────────┬──────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│  Layer 3: OPEN IN EDITOR                                    │
│  Channel: app.events.openContent                            │
│                                                             │
│  Input:  IOpenContentEvent { pipe, target, metadata }       │
│  Output: page opened in the resolved editor                 │
│                                                             │
│  Handler (opener):                                          │
│    → If metadata.pageId: navigate existing page             │
│    → Else: create new page with resolved editor             │
│    → Pass IContentPipe to editor for content loading        │
└─────────────────────────────────────────────────────────────┘
```

### Pipeline Wiring

There is no orchestration layer between channels. Each handler is self-contained — it does its work and fires the next event directly:

```
openRawLink handler (e.g., httpParser):
  1. Recognize "https://..." in event.raw
  2. await app.events.openLink.sendAsync(new OpenLinkEvent(url, { metadata }))
  3. event.handled = true

openLink handler (e.g., fileResolver):
  1. Build FileProvider + transformers → assemble IContentPipe
  2. await app.events.openContent.sendAsync(new OpenContentEvent(pipe, target, metadata))
  3. event.handled = true

openContent handler (opener):
  1. If metadata.pageId → navigate existing page with pipe
     Else → create new page with resolved editor and pipe
  2. event.handled = true
```

No controller, no post-processing, no output properties on the event. Each handler owns its full responsibility — parse, resolve, or open — and fires the next channel when ready.

**`sendAsync()` execution:** handlers run in LIFO order (newest → oldest), short-circuit on `event.handled = true`.

**Bootstrap registration order** (general → specific):
1. **Opener** (Layer 3): `openContent.subscribe(openHandler)` — registered first, runs last (LIFO)
2. **Resolvers** (Layer 2): `openLink.subscribe(fileResolver)`, then `openLink.subscribe(httpResolver)` — http runs before file (LIFO)
3. **Parsers** (Layer 1): `openRawLink.subscribe(fileParser)`, then `openRawLink.subscribe(archiveParser)`, then `openRawLink.subscribe(httpParser)`, then `openRawLink.subscribe(curlParser)` — curl checked first, file last (LIFO)

**After bootstrap, scripts subscribe** — their handlers are newest, so they run first. A script can:
- Set `event.handled = true` to fully intercept (skip all app handlers)
- Modify event properties (e.g., override `target`) without setting `handled` — app handlers still run after

### Key Interfaces

```typescript
// === Layer 1: Raw Link ===

interface IRawLinkEvent extends IBaseEvent {
    /** The raw link string (file path, URL, cURL, etc.) */
    readonly raw: string;
}

// === Layer 2: Structured Link ===

interface IOpenLinkEvent extends IBaseEvent {
    /** Normalized URL (file path, https://, archive path, etc.) */
    readonly url: string;
    /** Target editor ID — optional, auto-resolved by handler if omitted */
    target?: string;
    /** Open hints and pass-through metadata */
    metadata?: ILinkMetadata;
}

interface ILinkMetadata {
    /** Open in this specific page instead of a new tab */
    pageId?: string;
    /** Scroll to this line after opening */
    revealLine?: number;
    /** Highlight occurrences of this text after opening */
    highlightText?: string;
    /** HTTP headers (from cURL parser, etc.) */
    headers?: Record<string, string>;
    /** HTTP method (from cURL parser) */
    method?: string;
    /** HTTP body (from cURL parser) */
    body?: string;
    /** Additional custom data (for script/extension use) */
    [key: string]: unknown;
}

// === Layer 3: Open Content ===

interface IOpenContentEvent extends IBaseEvent {
    /** Assembled content pipe (provider + transformers) */
    readonly pipe: IContentPipe;
    /** Resolved editor ID */
    readonly target: string;
    /** Pass-through metadata (pageId, revealLine, etc.) */
    readonly metadata?: ILinkMetadata;
}

// === Provider Interface ===

interface IProvider {
    /** Provider type identifier (e.g., "file", "http", "buffer") */
    readonly type: string;
    /** Display name for UI (filename, URL, etc.) */
    readonly displayName: string;
    /** Original URL/path that created this provider */
    readonly sourceUrl: string;
    /** Whether this provider can be restored from a descriptor after app restart.
     *  Non-restorable providers (e.g., BufferProvider) return empty content after restore. */
    readonly restorable: boolean;
    /** Read binary content */
    readBinary(): Promise<Buffer>;
    /** Write binary content (not all providers support this) */
    writeBinary?(data: Buffer): Promise<void>;
    /** Whether this provider supports writing */
    readonly writable: boolean;
    /** File metadata (size, modified date, etc.) */
    stat?(): Promise<IProviderStat>;
    /** Watch for external changes (file watcher, etc.) */
    watch?(callback: (event: string) => void): ISubscriptionObject;
    /** Serialize to descriptor for persistence */
    toDescriptor(): IProviderDescriptor;
    /** Release resources (file handles, connections, etc.) */
    dispose?(): void;
}

interface IProviderStat {
    size?: number;
    mtime?: string;
    exists: boolean;
}
```

### Providers vs. Transformers

A key architectural distinction: **Providers** know *where* to get bytes (I/O source), **Transformers** know *how to process* bytes (stream transformation). These are separate concepts with separate interfaces.

```
Provider (source)  →  [Transformer → Transformer → ...]  →  Editor (display)
```

This is analogous to Unix pipes: `curl url | gunzip | tar -xO file | editor`

#### ITransformer Interface

```typescript
interface ITransformer {
    /** Transformer type identifier (e.g., "zip", "decrypt", "gunzip") */
    readonly type: string;
    /** Configuration used to construct this transformer (e.g., entry path for zip) */
    readonly config: Record<string, unknown>;
    /** Whether this transformer should be included in saved pipe descriptor.
     *  false for DecryptTransformer (contains password — must not persist). */
    readonly persistent: boolean;
    /** Transform bytes on read (source → editor) */
    read(data: Buffer): Promise<Buffer>;
    /** Reverse-transform bytes on write (editor → source). Undefined = read-only. */
    write?(data: Buffer, original: Buffer): Promise<Buffer>;
    /** Serialize to descriptor for persistence */
    toDescriptor(): ITransformerDescriptor;
}
```

**`read(data)`** — Transforms bytes flowing from provider to editor (e.g., extract ZIP entry, decrypt, decompress).

**`write(data, original)`** — Reverse-transforms bytes flowing from editor back to provider (e.g., replace ZIP entry in original archive, re-encrypt, recompress). Receives both the new content and the original source bytes (needed by ZIP to rebuild the archive with one entry replaced). If `write` is undefined, the transform is read-only.

#### Content Pipe

The pipeline is assembled during provider resolution (Layer 2). The result passed to editors is an `IContentPipe` — a composed view of provider + transformers:

```typescript
interface IContentPipe {
    /** The root provider (data source) */
    readonly provider: IProvider;
    /** Ordered list of transformers applied after reading */
    readonly transformers: ReadonlyArray<ITransformer>;
    /** Insert a transformer at a specific position (default: end).
     *  Typically used on a cloned pipe, not the active one (clone-and-try pattern). */
    addTransformer(transformer: ITransformer, index?: number): void;
    /** Remove a transformer by type. Returns the removed transformer or undefined.
     *  Typically used on a cloned pipe, not the active one (clone-and-try pattern). */
    removeTransformer(type: string): ITransformer | undefined;
    /** Serialize pipe to a descriptor (only includes persistent transformers) */
    toDescriptor(): IPipeDescriptor;
    /** Read content — provider.readBinary() piped through all transformers */
    readBinary(): Promise<Buffer>;
    /** Read as text — readBinary() then decode (encoding handled internally via BOM/jschardet detection) */
    readText(): Promise<string>;
    /** Write content — reverse-piped through transformers back to provider */
    writeBinary?(data: Buffer): Promise<void>;
    /** Write text — encode then writeBinary() (encoding handled internally) */
    writeText?(content: string): Promise<void>;
    /** Whether the full pipe supports writing (provider writable + all transformers reversible) */
    readonly writable: boolean;
    /** Display name for UI */
    readonly displayName: string;
    /** Watch for external changes (delegated to provider) */
    watch?(callback: (event: string) => void): ISubscriptionObject;
    /** Clone this pipe with a different provider, keeping all transformers */
    cloneWithProvider(provider: IProvider): IContentPipe;
    /** Clone this pipe with same provider and transformers (deep copy) */
    clone(): IContentPipe;
    /** Dispose provider and transformers */
    dispose(): void;
}
```

#### Pipeline Examples

```
Opening "C:\docs.zip!data/report.csv":
  FileProvider("C:\docs.zip") → ZipTransformer("data/report.csv") → Editor
  - read:  FileProvider reads ZIP bytes → ZipTransformer extracts entry
  - write: ZipTransformer replaces entry in archive → FileProvider writes ZIP back

Opening "https://api.example.com/archive.zip!sheet.csv":
  HttpProvider("https://…/archive.zip") → ZipTransformer("sheet.csv") → Editor
  - read:  HttpProvider downloads → ZipTransformer extracts entry
  - write: not supported (HttpProvider is read-only)

Opening encrypted file "C:\secrets.enc" (after user enters password):
  FileProvider("C:\secrets.enc") → DecryptTransformer(password) → Editor
  - Layer 2 builds: FileProvider only (no DecryptTransformer)
  - Page detects encrypted content, user enters password
  - Page adds DecryptTransformer via clone-and-try
  - read:  FileProvider reads → DecryptTransformer decrypts
  - write: DecryptTransformer encrypts → FileProvider writes
```

#### Caching Strategy: `cloneWithProvider()`

Caching is **not** a content pipe concern — it's a page/editor concern. The pipe is a pure read/write abstraction.

**Save As / Save Copy** use `cloneWithProvider()` to redirect output to a new file while preserving the transformer chain:

```
CTRL+S:     if primaryPipe.writable → primaryPipe.writeText(content)
            else                    → "Save As" dialog (provider is read-only)
SAVE AS:    newPipe = primaryPipe.cloneWithProvider(FileProvider(userPath))
            newPipe.writeText(content)
            page.primaryPipe = newPipe   (future Ctrl+S goes to new file)
```

**Auto-save cache** stores the editor-facing content directly via a simple `CacheFileProvider` — no transformers. The page model handles cache encryption separately if needed (like today's `mapContentToSave`). Exact caching strategy details to be finalized during US-268 (Migrate TextFileIOModel).

Two cloning primitives enable pipe operations:

| Operation | Implementation |
|-----------|---------------|
| **Save As** | `pipe.cloneWithProvider(FileProvider(userChosenPath))` → replaces primary pipe |
| **Save Copy** | `pipe.cloneWithProvider(FileProvider(path))` → write once, keep original primary |
| **Try transformer** | `pipe.clone()` → add transformer to clone → try read → keep or dispose (see [encryption flow](#transformer-management-design)) |

**Why this works well:**
- The editor never reconstructs transformers — cloning preserves the full chain
- Clone-and-try keeps the active pipe safe — failed attempts are disposed without side effects
- Read-only sources (HTTP, FTP) gracefully degrade to "Save As" on Ctrl+S
- `IContentPipe` stays stateless — no cache logic inside the pipe itself

#### Known Transformer Candidates

| Transformer | Read (source→editor) | Write (editor→source) | Config |
|-------------|---------------------|----------------------|--------|
| `ZipTransformer` | Extract entry from ZIP bytes | Replace entry in archive, return full ZIP | `{ entryPath: string }` |
| `DecryptTransformer` | AES-GCM decrypt | AES-GCM encrypt | `{ password: string }` |
| `GunzipTransformer` | Decompress gzip | Compress gzip | — |
| `Base64Transformer` | Decode base64 → binary | Encode binary → base64 | — |
| `EncodingTransformer` | Convert encoding to UTF-8 | Convert UTF-8 to target encoding | `{ encoding: string }` |

### Provider Implementations

| Provider | Source | Writable | Watch | Notes |
|----------|--------|----------|-------|-------|
| `FileProvider` | Local file path (binary) | Yes | Yes (FileWatcher) | Reads/writes raw bytes. Replaces direct `app.fs` usage in editors. |
| `HttpProvider` | HTTP/HTTPS URL | No (initially) | No | GET by default. Receives headers/method/body from `ILinkMetadata` (e.g., from cURL parser). |
| `BufferProvider` | In-memory data | Configurable | No | For programmatic content (scripts, MCP) |
| `CacheFileProvider` | Cache directory by page ID | Yes | No | Auto-save destination for `cloneWithProvider()` |

> **Note on cURL:** There is no separate `CurlProvider`. The cURL parser (Layer 1) extracts URL, headers, method, and body from a cURL command string, and stores them in `ILinkMetadata`. Layer 2 creates a standard `HttpProvider` configured with those metadata fields.

#### Virtual Providers (future)

Virtual providers (e.g., `NoteItemProvider`, `GridCellProvider`, `JsonPathProvider`) that read/write sub-elements from another page's structured content are a future possibility. Their design will be finalized when specific editor needs arise — not planned as part of this epic.

#### Internal Protocols — No Provider Needed

The app has two custom Electron protocols that do NOT need content pipe integration:

- **`app-asset://`** — Serves bundled application resources (Monaco type definitions, PDF.js viewer HTML, Excalidraw fonts). These are internal infrastructure loaded by editors, not user content. Never "opened as pages."
- **`safe-file://`** — Serves user files to editors that need URL-based access (PDF viewer iframe, image viewer `<img src>`). Exists because Electron blocks direct `file://` access. Will be phased out when PDF/image editors migrate to content pipes (US-274) — they'll use `pipe.readBinary()` instead.

Neither protocol needs a Layer 1 parser or a provider. They're internal URLs constructed by editors, not user-facing links.

### ITreeProvider (browsable sources)

`IProvider` delivers content for ONE resource. `ITreeProvider` enumerates children — it's a separate interface for browsable sources (directories, ZIP archives, FTP servers, etc.).

```typescript
interface ITreeProvider {
    readonly type: string;
    readonly displayName: string;
    readonly sourceUrl: string;

    /** List children at a path */
    listDir(path?: string): Promise<ITreeEntry[]>;
    /** Get metadata for a specific path */
    stat(path: string): Promise<ITreeStat>;

    /** Resolve a child entry to a raw link for the open pipeline */
    resolveLink(path: string): string;

    /** Whether this tree supports write operations */
    readonly writable: boolean;
    /** Optional write operations */
    mkdir?(path: string): Promise<void>;
    delete?(path: string): Promise<void>;
    rename?(oldPath: string, newPath: string): Promise<void>;

    dispose?(): void;
}

interface ITreeEntry {
    name: string;
    isDirectory: boolean;
    size?: number;
    mtime?: string;
}

interface ITreeStat {
    exists: boolean;
    isDirectory: boolean;
    size?: number;
    mtime?: string;
}
```

**Key design decision:** `resolveLink(path)` returns a **raw link string**, not an `IContentPipe`. The tree doesn't need to know about transformers — it just builds URLs.

NavigationPanel calls **`openLink`** (not `openRawLink`) because it already has a structured link and needs to pass `metadata.pageId` to navigate the current page instead of opening a new tab:

```typescript
// NavigationPanel double-click handler
onFileDoubleClick(entry: ITreeEntry) {
    const url = treeProvider.resolveLink(entry.path);
    app.events.openLink.sendAsync(new OpenLinkEvent(url, {
        metadata: { pageId: currentPage.id },  // navigate THIS page
    }));
}

// Examples of resolveLink output:
FileSystemTreeProvider("C:\\projects").resolveLink("src/index.ts")
  → "C:\\projects\\src\\index.ts"

ZipTreeProvider("C:\\docs.zip").resolveLink("data/report.csv")
  → "C:\\docs.zip!data/report.csv"

FtpTreeProvider("ftp://server/share").resolveLink("logs/app.log")
  → "ftp://server/share/logs/app.log"
```

#### Tree Provider Implementations

| TreeProvider | Source | Writable | Notes |
|--------------|--------|----------|-------|
| `FileSystemTreeProvider` | Local directory | Yes | Replaces current file explorer logic |
| `ZipTreeProvider` | ZIP archive | Yes (write-back) | Replaces current archive NavPanel |
| `FtpTreeProvider` | FTP/SFTP server | Yes | Future |
| `WebDavTreeProvider` | WebDAV server | Yes | Future |

**Resolved:** `ITreeProvider` produces raw link strings via `resolveLink()`. NavigationPanel calls `openLink` (Layer 2) directly — skipping raw parsing since the link is already structured — and passes `metadata.pageId` to navigate the current page.

### Event Channels on `app.events`

```typescript
interface IAppEvents {
    // ... existing channels ...

    /** Layer 1: Raw string → parsed link. Parsers subscribe here. */
    readonly openRawLink: IEventChannel<IRawLinkEvent>;
    /** Layer 2: Structured link → provider + transformers. Resolvers subscribe here. */
    readonly openLink: IEventChannel<IOpenLinkEvent>;
    /** Layer 3: Content pipe + target → open page. Openers subscribe here. */
    readonly openContent: IEventChannel<IOpenContentEvent>;
}
```

### How Current Flows Map to New Architecture

| Current Flow | New Flow | Channel |
|---|---|---|
| Main process `will-navigate` → IPC `eOpenFile` | IPC → `openRawLink.sendAsync(event)` | `openRawLink` |
| File explorer double-click | `openRawLink.sendAsync(event)` | `openRawLink` |
| Recent files click | `openRawLink.sendAsync(event)` | `openRawLink` |
| Pipe server `OPEN path` → IPC | IPC → `openRawLink.sendAsync(event)` | `openRawLink` |
| `app.pages.openFile(path)` (script API) | Kept as backward-compat wrapper — routes through `openRawLink` internally | `openRawLink` |
| Browser `window.open(url)` → IPC `eOpenUrl` | `openRawLink.sendAsync(event)` | `openRawLink` |
| NavigationPanel double-click (file/archive) | `openLink.sendAsync(new OpenLinkEvent(url, { metadata: { pageId } }))` | `openLink` — skip raw parsing, navigate current page |
| `navigatePageTo(pageId, path, opts)` (script API) | `openLink.sendAsync(new OpenLinkEvent(url, { metadata: { pageId, ... } }))` | `openLink` |

### Editor Migration Strategy

Editors currently read from `page.state.content` (text) or `page.state.filePath` (reference). The migration is gradual:

**Phase 1 — Content pipe exists alongside current system:**
- Editors still work with content/filePath as before
- New `page.pipe` property added (optional `IContentPipe`)
- `FileProvider` is auto-created from `filePath` for compatibility
- New sources (HTTP, buffer) and transforms (zip, decrypt) work through the pipe

**Phase 2 — Editors migrate to content pipe:**
- `TextFileIOModel` reads/writes through `page.pipe` instead of direct `app.fs`
- FileWatcher becomes part of `FileProvider.watch()`
- Archive paths use `FileProvider + ZipTransformer` instead of `!`-suffix hack
- PDF viewer gets content from `pipe.readBinary()` instead of `safe-file://` protocol
- Encrypted files use `FileProvider + DecryptTransformer` — page model adds `DecryptTransformer` via clone-and-try when user enters password

**Phase 3 — Full pipe ecosystem:**
- HTTP provider enables "open URL as JSON grid", "open URL as markdown"
- Buffer provider enables MCP/script-created content with save-to-file
- Custom providers and transformers via script/extension API
- Composable pipelines: `HttpProvider → GunzipTransformer → ZipTransformer → Editor`

### EventChannel Enhancement

**Done.** `EventChannel` was updated: `subscribeDefault()` removed, `sendAsync()` now uses LIFO order. Original design:

**LIFO execution order for `sendAsync()`** — newest subscriber runs first, oldest runs last. This eliminates `subscribeDefault()` entirely. The app registers its handlers first during bootstrap (most general first, most specific second). Scripts subscribe later and automatically run before app handlers.

```
Registration order (bootstrap → scripts):    sendAsync execution order (LIFO):

1. fileHandler     (first registered)         ← runs last  (fallback)
2. zipHandler      (second registered)        ← runs third
3. httpHandler     (third registered)         ← runs second
   ... scripts load ...
4. scriptHandler   (last registered)          ← runs first
```

When a handler sets `event.handled = true`, remaining (older) handlers are skipped.

```typescript
interface IEventChannel<T extends IBaseEvent> {
    /** Register a handler. In sendAsync: newest subscriber runs first (LIFO). */
    subscribe(handler): ISubscriptionObject;
}
```

> **Note:** `send()` (fire-and-forget, used for observe-only events) remains FIFO and ignores `handled` — all handlers always run. Only `sendAsync()` uses LIFO with short-circuit. Existing event channels (`itemContextMenu`, `onBookmark`) use `sendAsync()` — their execution order reverses, but since their handlers don't set `handled` (they collect menu items / modify bookmark data) and order doesn't matter for the collect pattern, behavior is unchanged in practice.

**`sendAsync()` execution order:** LIFO handlers (newest → oldest), short-circuit on `event.handled = true`. Each handler is self-contained — it fires the next channel's event directly when ready (see [Pipeline Wiring](#pipeline-wiring)).

### Folder Structure

Providers and transformers form a new **content delivery** layer between `api/` (object model) and `editors/` (display):

```
/src/renderer/content/          ← NEW: implementation
  ContentPipe.ts                ← IContentPipe implementation (assembles provider + transformers)
  /providers/
    FileProvider.ts
    HttpProvider.ts
    BufferProvider.ts
    CacheFileProvider.ts
  /transformers/
    ZipTransformer.ts
    DecryptTransformer.ts
    GunzipTransformer.ts
  /tree/
    FileSystemTreeProvider.ts
    ZipTreeProvider.ts

/src/renderer/api/types/        ← Script-facing type definitions (existing folder)
  io.d.ts                       ← io namespace declaration (the global)
  io.provider.d.ts              ← IProvider, IProviderStat
  io.transformer.d.ts           ← ITransformer
  io.pipe.d.ts                  ← IContentPipe
  io.tree.d.ts                  ← ITreeProvider, ITreeEntry, ITreeStat
  io.events.d.ts                ← IRawLinkEvent, IOpenLinkEvent, IOpenContentEvent, ILinkMetadata
```

Type definitions go in `api/types/` with the `io.` prefix — this folder is already auto-copied by the Vite `editorTypesPlugin` to `assets/editor-types/` for Monaco IntelliSense. No Vite config changes needed. The `io.` prefix groups them visually and avoids collisions with existing type files.

### Script API: `io` Global

Providers, transformers, and pipe assembly are exposed to scripts via the **`io`** global namespace — alongside the existing `page`, `app`, `ui` globals:

| Global | Purpose |
|--------|---------|
| `page` | Current page content and editor facades |
| `app` | Application services (pages, fs, settings, events) |
| `ui` | Log View output and inline dialogs |
| `io` | Content pipe building: providers, transformers, assembly |

```typescript
// The io namespace
globalThis.io = {
    // Providers
    FileProvider,
    HttpProvider,
    BufferProvider,
    CacheFileProvider,

    // Transformers
    ZipTransformer,
    DecryptTransformer,
    GunzipTransformer,

    // Pipe assembly
    createPipe(provider: IProvider, ...transformers: ITransformer[]): IContentPipe,
};
```

#### Script Examples

```javascript
// Read a CSV from inside a ZIP on an HTTP server
const pipe = io.createPipe(
    new io.HttpProvider("https://data.net/archive.zip"),
    new io.ZipTransformer("data.csv"),
);
const csv = await pipe.readText();
page.grouped.content = csv;
page.grouped.editor = "grid-csv";

// Read an encrypted local file
const pipe = io.createPipe(
    new io.FileProvider("C:\\secrets\\data.enc"),
    new io.DecryptTransformer(password),
);
const text = await pipe.readText();

// Destructure for convenience
const { FileProvider, ZipTransformer } = io;
const pipe = io.createPipe(
    new FileProvider("C:\\docs.zip"),
    new ZipTransformer("readme.md"),
);
```

#### Event Subscription (autoload scripts)

```typescript
// Layer 1: Custom parser — scripts subscribe last, run first (LIFO)
app.events.openRawLink.subscribe(async (event) => {
    if (event.raw.startsWith("myapp://")) {
        // Handle it ourselves — fire openLink directly, skip app parsers
        await app.events.openLink.sendAsync(
            new OpenLinkEvent(event.raw, { target: "browser" })
        );
        event.handled = true;
    }
});

// Layer 2: Modify routing — runs before app resolvers (LIFO)
app.events.openLink.subscribe((event) => {
    if (event.url.endsWith(".csv")) {
        event.target = "grid-csv";
    }
    // Don't set handled — let the app resolver build the pipe and fire openContent
});

// Layer 3: Observe opens — runs before the app open handler (LIFO)
app.events.openContent.subscribe((event) => {
    ui.log(`Opening: ${event.pipe.displayName}`);
    // Don't set handled — let the app handler open the page
});
```

## Tasks

Tasks are ordered by dependency and grouped into phases. After each phase, run `/review`, `/document`, and `/userdoc` to validate and update documentation for the batch.

### Phase A: Foundation

Core abstractions and building blocks. No changes to existing app behavior.

| # | Task | Description | Depends on | Status |
|---|------|-------------|------------|--------|
| 1 | US-260 EventChannel LIFO | `sendAsync()` LIFO order, remove `subscribeDefault()` | — | Done |
| 2 | US-261 Interfaces & types | `IProvider`, `ITransformer`, `IContentPipe`, `IPipeDescriptor`, `IProviderDescriptor`, `ITransformerDescriptor` type definitions | — | Done |
| 3 | US-262 FileProvider & ContentPipe | `FileProvider` (binary I/O), `ContentPipe` assembler, `createPipeFromDescriptor()` factory | US-261 | Done |

> **Review checkpoint A:** review + document after US-262. Foundation code is in place, nothing wired yet.

### Phase B: Link Pipeline

Event channels, parsers, resolvers, and the open handler. Wires the three-layer pipeline.

| # | Task | Description | Depends on | Status |
|---|------|-------------|------------|--------|
| 4 | US-263 Link event channels | Add `openRawLink`, `openLink`, `openContent` channels to `app.events` | US-260 | Done |
| 5 | US-264 Raw link parsers | File and archive parsers as handlers on `openRawLink` | US-263 | Done |
| 6 | US-265 Pipe resolvers | File resolver on `openLink` — builds `FileProvider`, resolves target via `extractEffectivePath()` | US-262, US-263 | Done |
| 7 | US-266 Open handler | Handler on `openContent` — creates/navigates page with content pipe | US-263 | Done |
| 8 | US-267 Migrate entry points | Replace all `pagesModel.openFile()` call sites with `openRawLink`. `app.pages.openFile()` kept as backward-compat wrapper routing through `openRawLink` | US-264, US-265, US-266 | Done |

> **Review checkpoint B:** review + document after US-267. Full pipeline working for plain files. App opens files through the new link pipeline.

### Phase C: Core Migration

Transformers, pipe serialization, and the big TextFileIOModel rewrite. After this phase, editors use content pipes.

| # | Task | Description | Depends on | Status |
|---|------|-------------|------------|--------|
| 9 | US-269 ZipTransformer | Implement `ZipTransformer`, update file resolver to detect `!` and build archive pipes | US-265 | Done |
| 10 | US-275 DecryptTransformer | AES-GCM decrypt/encrypt transformer, `persistent: false` | US-261 | Done |
| 11 | US-276 Pipe serialization | `IPageState.pipe` field, `getRestoreData`/`applyRestoreData` changes, restore flow with `createPipeFromDescriptor` | US-262 | Done |
| 12 | US-268 Migrate TextFileIOModel | Page owns pipe, reads/writes via `IContentPipe`, dual pipe model (primary + cache), encoding detection in pipe, encryption via clone-and-try | US-267, US-269, US-275, US-276 | Done |

> **Review checkpoint C:** review + document after US-268. Text editors fully migrated to content pipes. Archives and encryption work through pipe. This is the most critical checkpoint.

### Phase D: Extensions & Polish

Additional providers, parsers, reference editor migration, and script API.

| # | Task | Description | Depends on | Status |
|---|------|-------------|------------|--------|
| 13 | US-270 HttpProvider | `HttpProvider`, HTTP raw link parser, HTTP resolver with content-vs-browser decision, URL entry point migration | US-265 | Done |
| 14 | US-273 cURL parser | Layer 1 parser: extract URL/headers/method/body from cURL strings into `ILinkMetadata`, Open URL dialog (Ctrl+O) | US-270 | Done |
| 15 | US-274 Migrate reference editors | PDF, image editors use content pipe instead of `safe-file://` protocol | US-268 | Done |
| 16 | US-271 Script API & docs | `io` global, event channel send/sendAsync, provider/transformer docs | US-268 | Done |

> **Review checkpoint D:** final review + document after US-271. Full epic complete.

## Resolved Questions

1. **`app.openLink()` vs `app.events.openRawLink.send()`** — **Event-based only.** All event channels go into `app.events` namespace. No convenience method on `app`. Scripts use `app.events.openRawLink.sendAsync()` or `app.events.openLink.sendAsync()` directly.

2. **HTTP re-download** — **No caching in provider.** Providers and transformers should be simple. If caching is needed, the consumer (page/editor) handles it via `cloneWithProvider(CacheFileProvider)`. Architecture can be revisited for specific cases if needed.

3. **Content pipe lifecycle** — **Page model owns the pipe.** Currently page model owns `FileWatcher`; after this epic it owns the content pipe instead. When page is closed, pipe is disposed.

4. **Backward compatibility** — **Kept `app.pages.openFile()` as backward-compat wrapper** that routes through `openRawLink` internally. Simple convenience for scripts.

5. **Target resolution** — See [Target Resolution Design](#target-resolution-design) below for full design.

6. **Transformer discovery** — See [Transformer Management Design](#transformer-management-design) below for full design.

---

### Target Resolution Design

**Problem:** Currently `editorRegistry.resolve(filePath)` maps file extensions to editors. With content pipes, the input is a URL string that could be a file path, HTTP URL, or archive path. Target resolution needs access to the resolved link and its file extension.

**Solution: "Effective path" extraction**

Layer 2 (`openLink` handler) extracts an **effective path** from the URL — the portion that carries the file extension — and passes it to `editorRegistry.resolve()`. This reuses the existing editor resolution system without changes.

**Extraction rules:**

| URL type | Example | Effective path | Resolved editor |
|----------|---------|----------------|-----------------|
| File path | `C:\data\report.csv` | `C:\data\report.csv` | Monaco (csv) |
| Archive path | `C:\docs.zip!data/report.grid.json` | `data/report.grid.json` | grid-json |
| HTTP URL | `https://api.com/data.json` | `data.json` | Monaco (json) |
| HTTP URL (no ext) | `https://api.com/endpoint` | `endpoint` (no ext) | Monaco (plaintext) |
| HTTP URL (query) | `https://api.com/file.csv?token=x` | `file.csv` | Monaco (csv) |

**Utility function:** `extractEffectivePath(url: string): string`
- Archive paths (`!` separator): returns the inner path (after `!`)
- HTTP/HTTPS URLs: returns the pathname's last segment (before query string)
- File paths: returns the path as-is

**Resolution order in Layer 2:**
1. If `event.target` is already set → use it (caller or script handler specified the editor)
2. Extract effective path from `event.url`
3. Call `editorRegistry.resolve(effectivePath)` → returns best editor
4. If no editor matches → default to `"monaco"`

**Why this works:**
- `editorRegistry.resolve()` already handles compound extensions (`.grid.json`, `.note.json`, `.rest.json`)
- Editor `acceptFile()` hooks only look at file extensions/patterns — they don't care about the full path prefix
- Scripts can override `event.target` in a Layer 2 handler before the app resolver runs (LIFO)
- HTTP Content-Type is deliberately NOT used for resolution — it adds complexity, requires a preflight request, and the URL extension is sufficient for most cases. If a specific case needs it later, a script handler can inspect headers from `metadata` and set `event.target`.

**Concern:** Some HTTP endpoints return data without a useful file extension (e.g., REST APIs). In that case, the default is Monaco with plaintext. The user or script can always specify `target` explicitly. This is acceptable — we don't want to add HTTP HEAD requests or content sniffing to the resolution pipeline.

---

### Transformer Management Design

**Principle:** Providers, transformers, and pipe are **passive and simple**. The pipe owner (page model) holds all orchestration logic and can manipulate transformers as needed.

**How Layer 2 determines initial transformers:**

Only **structurally detectable** transformers are applied during pipe construction:
- **ZipTransformer**: Applied when the URL contains `!` separator (archive path). Config: `{ entryPath }` from the inner path.
- **No other transformers are auto-applied.** No `.enc` extension detection, no content sniffing.

**Clone-and-try pattern — page modifies transformers on a cloned pipe:**

The active pipe is never mutated directly. To add/remove a transformer, the page clones the pipe, modifies the clone, tests it, and swaps if successful. `addTransformer()` and `removeTransformer()` exist on `IContentPipe` but are intended for use on clones:

```typescript
// Clone-and-try to add a transformer
const candidate = activePipe.clone();
candidate.addTransformer(new DecryptTransformer(password));
try {
    const content = await candidate.readText();
    // Success — swap pipes
    activePipe.dispose();
    activePipe = candidate;
} catch {
    // Failed — discard clone, active pipe unchanged
    candidate.dispose();
}
```

**Encryption flow (unchanged UX, new internals):**

```
1. User opens "secrets.txt" (encrypted content)
   → Layer 2 builds pipe: FileProvider("secrets.txt") → (no transformers)
   → Page loads content via pipe.readText()
   → Content is "ENC-v001:..." (raw encrypted text shown in Monaco)

2. Page detects encrypted content (isEncrypted check on loaded text)
   → Shows 🔒 lock icon on tab toolbar

3. User clicks 🔒 icon
   → Page shows password dialog
   → User enters password

4. Page attempts decryption via clone-and-try:
   → Clone existing pipe (same provider, same transformers)
   → Add DecryptTransformer(password) to the cloned pipe
   → Try clonedPipe.readText()
   → If decryption FAILS: dispose cloned pipe, show error, original pipe unchanged
   → If decryption SUCCEEDS: dispose original pipe, keep cloned pipe as new active pipe
   → Shows plaintext, icon changes to 🔓

5. User saves (Ctrl+S)
   → pipe.writeText(content) reverse-pipes through DecryptTransformer (encrypts)
   → FileProvider writes encrypted bytes to disk

6. User clicks 🔓 to re-encrypt and lock
   → Clone pipe without DecryptTransformer
   → Dispose old pipe, keep new pipe
   → Re-reads from provider: shows encrypted text again
   → Icon back to 🔒
```

**Why clone-and-try instead of mutating:**
- The active pipe is never in a broken state — if decryption fails, the original pipe is untouched
- No need to undo a failed transformer insertion
- Clean ownership: dispose the one you don't need

**Why no auto-detection of transformers:**
- Encryption is content-based (detected by `"ENC-v001:"` prefix), not link-based — Layer 2 can't know without reading the content
- The page already has this detection logic today; it just switches from calling `encryption.decrypt()` directly to inserting a `DecryptTransformer` into the pipe
- Future transformers (gzip, base64) are similar — the page or a script decides when to apply them
- Keeps Layer 2 simple: it only builds what's structurally obvious from the URL

**Why no self-registration:**
- "Can I handle this?" requires reading content or making network requests during resolution — too heavy for Layer 2
- Only one transformer (ZIP) is deterministic from URL structure alone
- The pipe owner (page) has access to the content and can make informed decisions
- Scripts can add custom transformers to any pipe via the mutable API

---

### Pipe Serialization & Restore Design

#### Problem

Currently `IPageState.filePath` is the sole persistence handle — the page uses it to recreate `FileWatcher` and reload content on app restart. With content pipes, a page's data source is richer: provider type + config + transformer chain. This must survive app restart.

#### Pipe Descriptor (serializable JSON)

```typescript
interface IPipeDescriptor {
    /** Provider descriptor */
    provider: IProviderDescriptor;
    /** Transformer descriptors (ordered) — only persistent transformers */
    transformers: ITransformerDescriptor[];
}

interface IProviderDescriptor {
    type: string;                     // "file", "http", "buffer"
    config: Record<string, unknown>;  // e.g. { path: "C:\\file.txt" } or { url: "https://..." }
}

interface ITransformerDescriptor {
    type: string;                     // "zip", "gunzip", "base64"
    config: Record<string, unknown>;  // e.g. { entryPath: "data/report.csv" }
}
```

Each provider implements `toDescriptor()` and each transformer implements `toDescriptor()`. The `ContentPipe` assembles a `IPipeDescriptor` by collecting descriptors from its provider and persistent transformers.

A factory function reconstructs the pipe from a descriptor:

```typescript
function createPipeFromDescriptor(descriptor: IPipeDescriptor): IContentPipe
```

#### IPageState Changes

```typescript
interface IPageState {
    id: string;
    type: PageType;
    title: string;
    modified: boolean;
    language?: string;
    filePath?: string;       // KEPT — derived from pipe for backward compat, UI, recent files
    pipe?: IPipeDescriptor;  // NEW — serializable pipe definition
    editor?: PageEditor;
    hasNavPanel?: boolean;
    pinned?: boolean;
}
```

During migration, both `filePath` and `pipe` exist. If `pipe` is present, it takes precedence. If only `filePath` exists (legacy state), the restore flow auto-creates a `FileProvider` from it. Eventually `filePath` becomes a computed value derived from the pipe's provider.

#### Provider Persistence

| Provider | `restorable` | Behavior after restore |
|----------|-------------|----------------------|
| `FileProvider` | `true` | Reads file from disk — normal restore |
| `HttpProvider` | `true` | Re-fetches from URL — like a browser reloading tabs |
| `BufferProvider` | `false` | Returns empty content — page must use cache |
| `CacheFileProvider` | `true` | Reads from cache directory — internal use only |

**Non-restorable providers:** When a provider has `restorable: false`, the page model immediately caches content on first load (marks page as `modified=true`). After app restart, the pipe descriptor still contains the `BufferProvider` descriptor (for metadata/display purposes), but the page restores from cache because `modified=true`. The restored `BufferProvider` returns empty content — the cache is authoritative.

#### Transformer Persistence

| Transformer | `persistent` | Why |
|-------------|-------------|-----|
| `ZipTransformer` | `true` | Structural — part of the data path |
| `GunzipTransformer` | `true` | Structural — needed to read content |
| `Base64Transformer` | `true` | Structural — needed to read content |
| `EncodingTransformer` | `true` | Structural — carries encoding config, needed to read content correctly |
| `DecryptTransformer` | `false` | Contains password — must not be saved to disk |

When serializing a pipe, only transformers with `persistent: true` are included in the descriptor. Non-persistent transformers are stripped — after restore, the page sees raw (encrypted) content and the user must re-authenticate.

#### Restore Flow

```
1. Load IPageState from openFiles.json

2. If pipe descriptor exists:
   a. createPipeFromDescriptor(descriptor)
      → Reconstruct provider by type + config
      → Reconstruct persistent transformers by type + config
      → Assemble ContentPipe
   b. If modified=true AND cache exists:
      → Restore content from cache (unsaved work)
      → Page shows modified indicator
   c. If modified=false:
      → pipe.readText() to load content from source
      → Page detects encrypted content → shows 🔒 (user re-enters password)

3. If no pipe descriptor (legacy state):
   a. Fall back to filePath-based restore (current behavior)
   b. Auto-create FileProvider from filePath (compatibility bridge)
```

#### Encryption After Restart

```
App restarts
  → Pipe restored: FileProvider("secrets.txt") → (no DecryptTransformer — it was non-persistent)
  → pipe.readText() returns "ENC-v001:..." (raw encrypted text)
  → Page detects encryption → shows 🔒
  → User clicks 🔒 → enters password
  → Clone-and-try: clone pipe → add DecryptTransformer(password) → try read
  → Success → swap pipes → 🔓
```

#### filePath Derivation

For UI purposes (tab title, recent files, "Save As" default path), `filePath` is derived from the pipe:

| Pipe | Derived filePath |
|------|-----------------|
| `FileProvider({ path: "C:\\file.txt" })` | `C:\file.txt` |
| `FileProvider({ path: "C:\\doc.zip" }) + ZipTransformer({ entryPath: "readme.md" })` | `C:\doc.zip!readme.md` |
| `HttpProvider({ url: "https://api.com/data.json" })` | `undefined` (no local file) |
| `BufferProvider(...)` | `undefined` (no file) |

---

## Related

- **EPIC-005** — Archive File Support (established the `!`-suffix pattern this epic replaces)
- **EPIC-009** — Scriptable Application Events (established the `EventChannel` system this epic extends)
