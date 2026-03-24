# EPIC-012: Unified Link & Provider Architecture

**Status:** Active
**Priority:** High
**Created:** 2026-03-24

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
│  Responsibilities:                                          │
│    → Resolve target editor (if not specified)               │
│    → Create IProvider for the data source                   │
│    → Build transformer chain (zip, decrypt, gunzip, etc.)   │
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
    /** Read text content */
    readText(encoding?: string): Promise<string>;
    /** Read binary content */
    readBinary(): Promise<Buffer>;
    /** Write text content (not all providers support this) */
    writeText?(content: string, encoding?: string): Promise<void>;
    /** Write binary content */
    writeBinary?(data: Buffer): Promise<void>;
    /** Whether this provider supports writing */
    readonly writable: boolean;
    /** File metadata (size, modified date, etc.) */
    stat?(): Promise<IProviderStat>;
    /** Watch for external changes (file watcher, etc.) */
    watch?(callback: (event: string) => void): ISubscriptionObject;
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
    /** Transform bytes on read (source → editor) */
    read(data: Buffer): Promise<Buffer>;
    /** Reverse-transform bytes on write (editor → source). Undefined = read-only. */
    write?(data: Buffer, original: Buffer): Promise<Buffer>;
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
    /** Read content — provider.read() piped through all transformers */
    readText(encoding?: string): Promise<string>;
    readBinary(): Promise<Buffer>;
    /** Write content — reverse-piped through transformers back to provider */
    writeText?(content: string, encoding?: string): Promise<void>;
    writeBinary?(data: Buffer): Promise<void>;
    /** Whether the full pipe supports writing (provider writable + all transformers reversible) */
    readonly writable: boolean;
    /** Display name for UI */
    readonly displayName: string;
    /** Watch for external changes (delegated to provider) */
    watch?(callback: (event: string) => void): ISubscriptionObject;
    /** Clone this pipe with a different provider, keeping all transformers */
    cloneWithProvider(provider: IProvider): IContentPipe;
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

Opening encrypted file "C:\secrets.enc":
  FileProvider("C:\secrets.enc") → DecryptTransformer(password) → Editor
  - read:  FileProvider reads → DecryptTransformer decrypts
  - write: DecryptTransformer encrypts → FileProvider writes

Opening gzipped log "https://logs.example.com/app.log.gz":
  HttpProvider("https://…/app.log.gz") → GunzipTransformer → Editor
  - read:  HttpProvider downloads → GunzipTransformer decompresses

Chained transformers — gzipped ZIP entry from HTTP:
  HttpProvider("https://…/data.tar.gz") → GunzipTransformer → ZipTransformer("data.csv") → Editor
  - read:  HttpProvider downloads → GunzipTransformer decompresses → ZipTransformer extracts entry
```

#### Caching Strategy: `cloneWithProvider()`

Caching is **not** a content pipe concern — it's a page/editor concern. The pipe is a pure read/write abstraction. The editor creates a cache pipe by cloning the primary pipe with a different provider:

```typescript
// Editor receives primary pipe from Layer 3:
primaryPipe:  HttpProvider("https://data.net/file.zip") → ZipTransformer("test.txt") → DecryptTransformer

// Editor creates cache pipe — same transformers, local cache destination:
cachePipe = primaryPipe.cloneWithProvider(CacheFileProvider(pageId))
cachePipe:    CacheFileProvider(pageId) → ZipTransformer("test.txt") → DecryptTransformer
```

The editor model orchestrates reads and writes:

```
LOAD:       if cacheProvider.exists() → cachePipe.readText()  (restore unsaved work)
            else                  → primaryPipe.readText()    (normal load)
AUTO-SAVE:  cachePipe.writeText(content)                      (encrypt → zip → cache file)
CTRL+S:     if primaryPipe.writable → primaryPipe.writeText(content), cachePipe.delete()
            else                    → "Save As" dialog (provider is read-only)
SAVE AS:    newPipe = primaryPipe.cloneWithProvider(FileProvider(userPath))
            newPipe.writeText(content)
            page.primaryPipe = newPipe   (future Ctrl+S goes to new file)
```

This one primitive — `cloneWithProvider()` — enables three operations:

| Operation | Implementation |
|-----------|---------------|
| **Cache** | `pipe.cloneWithProvider(CacheFileProvider(pageId))` |
| **Save As** | `pipe.cloneWithProvider(FileProvider(userChosenPath))` → replaces primary pipe |
| **Save Copy** | `pipe.cloneWithProvider(FileProvider(path))` → write once, keep original primary |

**Why this works well:**
- The editor never reconstructs transformers — `cloneWithProvider()` preserves the full chain
- Cache stores the same format as the real file (post-transform) — encrypted cache for encrypted files
- Read-only sources (HTTP, FTP) gracefully degrade to "Save As" on Ctrl+S
- On app restart, cache pipe restores content through the same reverse-transform chain
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
| `FileProvider` | Local file path | Yes | Yes (FileWatcher) | Replaces direct `app.fs` usage in editors |
| `HttpProvider` | HTTP/HTTPS URL | No (initially) | No | GET by default. Receives headers/method/body from `ILinkMetadata` (e.g., from cURL parser). |
| `BufferProvider` | In-memory data | Configurable | No | For programmatic content (scripts, MCP) |
| `CacheFileProvider` | Cache directory by page ID | Yes | No | Auto-save destination for `cloneWithProvider()` |

> **Note on cURL:** There is no separate `CurlProvider`. The cURL parser (Layer 1) extracts URL, headers, method, and body from a cURL command string, and stores them in `ILinkMetadata`. Layer 2 creates a standard `HttpProvider` configured with those metadata fields.

#### Virtual Providers (sub-element access)

Virtual providers read/write a piece of data from inside another page's structured content. The source isn't a file or URL — it's a sub-element within an in-memory data model. Write-back updates the parent structure.

| Provider | Source | Writable | Notes |
|----------|--------|----------|-------|
| `NoteItemProvider` | Single note inside `.note.json` | Yes | Opens note content in full Monaco/Markdown editor. Writes back to the note item. |
| `TodoItemProvider` | Single todo item inside `.todo.json` | Yes | Open item description in an editor |
| `GridCellProvider` | Cell value from a grid row | Yes | Open large cell content (JSON blob, long text) in Monaco |
| `JsonPathProvider` | Sub-path inside a JSON document | Yes | Edit `data.json → /users/0/bio` as standalone document |

Virtual providers enable a powerful pattern: **drill into structured data, edit a sub-element in a full editor, write changes back.** For example, a notebook note containing markdown could be opened in the markdown preview editor with full rendering — something not possible when notes are only editable inline.

```
NoteItemProvider(noteId, notebookPage) → Editor (Monaco/Markdown)
  - read:  returns note.content from the notebook model
  - write: updates note.content in the notebook model (triggers notebook save)
```

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
| `app.pages.openFile(path)` (script API) | `openRawLink.sendAsync(event)` (or keep as convenience wrapper) | `openRawLink` |
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
- Encrypted files use `FileProvider + DecryptTransformer` — editor doesn't know about encryption

**Phase 3 — Full pipe ecosystem:**
- HTTP provider enables "open URL as JSON grid", "open URL as markdown"
- Buffer provider enables MCP/script-created content with save-to-file
- Custom providers and transformers via script/extension API
- Composable pipelines: `HttpProvider → GunzipTransformer → ZipTransformer → Editor`

### EventChannel Enhancement

Current `EventChannel` has `subscribe()` (FIFO) + one `subscribeDefault()` (last). One change needed:

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

#### Convenience Methods

```typescript
// Open a link through the pipeline (convenience methods on app object)
app.openLink(rawString);                    // → openRawLink channel (raw string)
app.openLink({ url, target?, metadata? });  // → openLink channel (structured, skip parsing)
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

Tasks are ordered by dependency. Later tasks depend on earlier ones.

| # | Task | Description | Status |
|---|------|-------------|--------|
| 1 | US-260 EventChannel LIFO | `sendAsync()` LIFO order, remove `subscribeDefault()` | Planned |
| 2 | US-261 IProvider & ITransformer interfaces | Define `IProvider`, `ITransformer`, `IContentPipe` interfaces | Planned |
| 3 | US-262 FileProvider & ContentPipe | Implement `FileProvider` wrapping `app.fs`, `ContentPipe` assembler | Planned |
| 4 | US-263 Link event channels | Add `openRawLink`, `openLink`, `openContent` channels to `app.events` | Planned |
| 5 | US-264 Raw link parsers | File, HTTP, archive parsers as handlers on `openRawLink` | Planned |
| 6 | US-265 Pipe resolvers | Provider + transformer assembly as handlers on `openLink` | Planned |
| 7 | US-266 Open handler | Handler on `openContent` — creates/navigates page with content pipe | Planned |
| 8 | US-267 Migrate entry points | Replace all `pagesModel.openFile()` call sites with `openRawLink` | Planned |
| 9 | US-268 Migrate TextFileIOModel | Text editor reads/writes through `IContentPipe` | Planned |
| 10 | US-269 ZipTransformer | Extract/replace ZIP entries — replaces `!`-suffix convention | Planned |
| 11 | US-270 HttpProvider | Open HTTP URLs as text/grid/markdown pages | Planned |
| 12 | US-271 Script API & docs | `io` global, `app.openLink()`, event channel docs, provider/transformer docs | Planned |
| 13 | US-272 BufferProvider | In-memory provider for scripts and MCP | Planned |
| 14 | US-273 cURL parser | Layer 1 parser: extract URL/headers/method/body from cURL strings into `ILinkMetadata` | Planned |
| 15 | US-274 Migrate reference editors | PDF, image, browser editors use content pipe | Planned |
| 16 | US-275 DecryptTransformer | AES-GCM decrypt/encrypt as pipe transformer | Planned |

## Open Questions

1. **`app.openLink()` vs `app.events.openRawLink.send()`** — Should we add a convenience method on `app`, or keep it purely event-based? Convenience method is more discoverable for scripts.

2. **HTTP re-download** — `HttpProvider.readText()` fetches from the network. Should it cache internally (so a second `readText()` returns the same data), or is that the caller's problem? The cache pipe handles crash-recovery, but what about multiple reads during a single session?

3. **Content pipe lifecycle** — When a page is closed, both primary and cache pipes should be disposed. The page model likely owns both — confirm this is the right ownership model.

4. **Backward compatibility** — `app.pages.openFile(path)` is documented API. Keep it as a wrapper around `openRawLink`, or deprecate?

5. **Target resolution** — Currently `editorRegistry.resolve(filePath)` maps file extensions to editors. With content pipes, the URL scheme also matters (e.g., `https://` → browser, but `https://api.com/data.json` with explicit `target: "grid-json"` → grid). How do we layer these?

6. **Transformer discovery** — How does Layer 2 know which transformers to apply? For ZIP it's the `!` in the path, for encryption it could be a file header or extension (`.enc`). Should transformers self-register with a "can I handle this?" method, similar to how editors register `acceptFile()`?

## Related

- **EPIC-005** — Archive File Support (established the `!`-suffix pattern this epic replaces)
- **EPIC-009** — Scriptable Application Events (established the `EventChannel` system this epic extends)
