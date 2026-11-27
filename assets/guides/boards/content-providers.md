---
title: "Boards — content providers and download URL masks"
audience: both
summary: "Service-backed content providers, self-contained provider links, and browserUrlMasks for claiming Browser downloads."
---

# Boards — content providers and download URL masks

## Language packs and service-backed content providers

Boards that declare language packs can show their interface in Persephone's current language. Ask
your AI agent to add a language to a board; changing the app language reloads open boards so they
can use the new language.

Boards can also declare service-backed content providers:

```json
{
  "contentProviders": [{ "type": "example/mem", "schemes": ["mem"] }]
}
```

The provider `type` must contain `/`; un-namespaced types are reserved for the platform. The type
is persisted in page pipe state, so renaming it orphans pages carrying the old descriptor. Provider
types and schemes use one-owner registration: the first trusted board wins, and a losing board is
reported with its owner in Board Info. When a board registration is refused, Persephone shows a
toast the first time that issue appears and lists it in Board Info. This also applies to refused
capability, settings, and browser URL mask registrations. Boards may not claim `http`, `https`,
`file`, `data`, `blob`, `mneme`, or any `persephone-*` scheme. `service: true` is required to run
the declared background service. Provider registration is
controlled by the `contentProviders` declaration itself; it is separate from the permission flags.

### Browse a board-provided tree

A board can make the same content provider available in the Explorer by adding `"tree": true` to
its declaration:

```json
{
  "contentProviders": [{ "type": "example/mem", "schemes": ["mem"], "tree": true }]
}
```

Register the tree from the declared module service with `persephone.treeProviders.register()`.
The type must be declared with `tree: true`; Persephone refuses tree registration for other types.
`list()` and `stat()` are required. `list(config, path, { signal })` returns
`{ items, truncated }`. Each item has a unique single-segment `name`, its child `path`, an `href`
using one of the board's declared schemes, and an `isDirectory` flag; `size` and ISO `mtime` are
optional. `stat(config, path, { signal })` returns `{ exists, isDirectory, size?, mtime? }`.
Optional `mkdir(config, path)`, `rename(config, oldPath, newPath)`, and `delete(config, path)`
enable those Explorer actions. Listing and stat support cancellation and have no timer deadline;
mutations use the service request deadline. Search and moving items between different trees are not
available.

```js
persephone.treeProviders.register("example/mem", {
    async list(config, path, { signal }) {
        const entries = await readFolder(config, path, { signal });
        return {
            items: entries.map(entry => ({
                name: entry.name,
                path: path === "/" ? `/${entry.name}` : `${path}/${entry.name}`,
                href: `mem://${config.root}/${encodeURIComponent(entry.id)}`,
                isDirectory: entry.isDirectory,
            })),
            truncated: false,
        };
    },
    async stat(config, path, { signal }) {
        return readMetadata(config, path, { signal });
    },
});
```

The board can open or focus an Explorer page for its tree with
`persephone.openTree({ type, config, rootPath, title? })`. The calling board must own the accepted
declaration for `type`. `config` is board-owned JSON data saved with the page, so keep credentials
in the board's secure storage and pass only a reference. Repeating the call with the same `type`,
`config`, and `rootPath` focuses the existing page. `openTree()` requires bridge version `1.65.0`;
tree registration requires `1.64.0`.

A board may also pass URLs in its own declared schemes to `persephone.openRawLink()`. Persephone
routes those links through the board's content provider, while continuing to accept absolute paths,
`file:`, `http:`, `https:`, and `mailto:` links. The board cannot use a scheme claimed by another
board.

A web page in a browser tab can also link to a claimed scheme. Treat such a URL as untrusted input:
the page chooses its path and query. Persephone opens it only right after the user clicks or
presses a key in the page, and only after the user allows that site to open the scheme in your
board (asked once per site, remembered until restart).

Register the implementation from the declared module service, not from the board page:

```js
persephone.providers.register("example/mem", {
    readBinary(config) {
        return new TextEncoder().encode(`content for ${config.name}`);
    },
    stat() {
        return { exists: true };
    },
});
```

`readBinary()` must return a `Uint8Array`; `writeBinary()`, `stat()`, and `watch()` are optional.

### Transactional chunked writes

A writable provider may optionally register all four methods `writeBegin(config, { signal })`,
`writeChunk(handle, data, { signal })`, `writeCommit(handle, { signal })`, and `writeAbort(handle)`.
Registering only part of this group is rejected. Keep `writable: true` and `writeBinary()` for
existing buffered callers. A complete group advertises chunk-write capability; providers without
it keep using buffered writes, which remain capped at 256 MiB.

The host supplies a private handle returned by `writeBegin`; it is never sent to the renderer. Each
session accepts sequential awaited chunks of at most 1 MiB, including zero chunks for an empty file.
There are at most 16 open or starting/closing sessions across the service, all leases, and provider
types. Every begin, chunk, commit, and abort request has its own 10-second deadline; there is no
whole-file deadline. Reject writes after termination and make `writeAbort` idempotent. The signal
remains associated with begin, chunks, and commit. Cooperate with it: after cancellation or a failed
write, stop accepting chunks, wait for in-flight work, and discard the staged target. Commit should
publish only after the full write is complete. A successful commit replaces the target; keep an old
target intact until then. Report cleanup failures, and make abort safe to repeat.

Persephone sends abort on renderer cancellation, timeout, provider disposal, and lease loss. If a
begin reply is lost, the renderer still sends `writeAbort` by its generated write ID; host-side
cleanup remains authoritative if that request cannot reach the service. A lease loss cleans up its
sessions after in-flight operations settle. Commit can race cancellation: if rename already
succeeded, the destination is committed and cannot be rolled back. A timed-out commit is never
reported as success, so its outcome may be uncertain.

A killed utility process cannot run `writeAbort`, and Persephone has neither remote credentials nor
the board's temporary names. For persistent targets, use a durable connection-scoped temp journal or
an identifiable exclusive temp namespace, then reconcile uncommitted entries on the next service
start or connection before accepting writes. Detect a completed rename separately from an orphan and
never delete the destination. Recovery is eventual and board-owned; it cannot be guaranteed if the
board or remote host never reconnects. In-memory boards lose their staged session map on process
death. Local file providers also use identifiable exclusive sibling temps; process termination can
leave one behind, so recovery must never sweep unrelated files.

The `1.66.0` bridge adds these optional methods. Set `minBridgeVersion: "1.66.0"` when using them.

Add `readRange(config, range)` to serve ranged reads without buffering the whole resource into
memory first — this is what lets the built-in editors (Monaco, Image, the media player) and a
`stream-host` page's `persephone.host.streamUrl()` seek through a board's own provider. `range` is
`{ start, end }` (inclusive byte offsets); **return a `Uint8Array`, the same as `readBinary()` —
never a stream** (Persephone's own pipe layer has a separate, unrelated streaming concept with a
similarly-named method; `readRange` is not that — it is a bounded, byte-returning read, like
`readBinary()` but for a slice). Return at most `range.end - range.start + 1` bytes, and never more
than 1 MB in one call — the platform pulls a large read as a sequence of bounded requests and asks
again for the next range once the previous one is consumed:

```js
persephone.providers.register("example/mem", {
    readBinary(config) { /* ... */ },
    readRange(config, range) {
        const data = loadFromWherever(config);
        return data.subarray(range.start, range.end + 1);
    },
    stat(config) {
        return { exists: true, size: totalSizeOf(config) };
    },
});
```

`readRange` is optional and detected automatically from what you register — nothing in
`board-manifest.json` declares it. A provider that omits it keeps working exactly as before: every
read still goes through `readBinary()`, buffered and capped at 256 MB. Adding `readRange` also
means `stat()` must now return a `size` — seeking needs a length to seek against, and a resource
over 256 MB can only be opened through the ranged path.

**Content reads and metadata sizing (`readBinary`, `readRange`, and `stat`) have no deadline.**
`content.open()` resolves size eagerly, so its `stat()` call follows the same cancellation-only
rule. `writeBinary()` and `watch*()` retain the 10-second deadline. Release happens instead through
cancellation: closing the page, the board deleting its own backing resource (the read then fails
naturally, from inside your implementation), the service stopping, or the platform abandoning
interest (e.g. a seek superseding a previous chunk request). Each unbounded method receives an
optional trailing `{ signal }` argument — second for `readBinary`/`stat`, third for `readRange` — an
`AbortSignal` that fires when the platform stops waiting:

```js
persephone.providers.register("example/mem", {
    readBinary(config, options) {
        options?.signal?.addEventListener("abort", () => cancelUnderlyingWork());
        return loadFromWherever(config);
    },
    readRange(config, range, options) {
        options?.signal?.addEventListener("abort", () => cancelUnderlyingWork());
        return loadFromWherever(config).subarray(range.start, range.end + 1);
    },
    stat(config, options) {
        options?.signal?.addEventListener("abort", () => cancelUnderlyingWork());
        return { exists: true, size: totalSizeOf(config) };
    },
});
```

**Honoring the signal is optional; tolerating its presence is mandatory.** An implementation
written before this option existed — one or two arguments, no `options` parameter — keeps working
exactly as before; the platform now passes one extra trailing argument it has never declared and
therefore never reads. A well-behaved provider that does inspect `options.signal` can stop real
work early (close a socket, cancel a torrent piece request, abort a `fetch()`); a provider that
ignores it is not broken and not penalized — the platform stops waiting either way, it is only the
underlying work that keeps running until your own code notices.

The service starts when a page first reads from its provider. A saved page keeps its provider
descriptor while the board is absent or untrusted: it reports **Provider missing** and remains
restorable. After you trust or reinstall the declaring board, retry the read in the same page. If the
service is unavailable or does not register the provider, the read can fail; after correcting the
service, retry the read from that page.

### Torrent-style self-contained provider links

A provider that needs to restore a resource without its board page open must put everything needed
to identify that resource in the persisted URL. The torrent viewer uses the `torrent/viewer`
provider and creates links in this form:

```text
torrent://<40-lowercase-hex-infohash>/<encodeURIComponent(normalized-file-path)>?magnet=<encodeURIComponent(magnet-uri)>
```

Normalize the file path to `/` before encoding it as one URL path value. The provider receives the
complete href in `config.url`, not separate `infoHash` and `path` fields; the embedded magnet is
what makes a cold-start restore possible. WebTorrent piece selection and prioritisation belong to
the provider's implementation. `readRange` remains an optional bounded byte-returning method, not
a stream.

### Browser-download URL masks

`browserUrlMasks` is a declaration on `board-manifest.json` that is independent of `fileMasks`.
`fileMasks: ["*.torrent"]` associates a local file name; it does not opt the board into Browser
download interception. A board that wants both claims declares both explicitly:

```json
{
  "fileMasks": ["*.torrent"],
  "browserUrlMasks": ["*://*/*.torrent", "*://*/*.torrent?*"]
}
```

Values are trimmed, lowercased, de-duplicated, and bounded to 64 masks of at most 512 characters
each. They are case-insensitive whole-URL globs anchored at both ends. That anchoring matters:
`*://*/*.torrent` matches `https://example.test/a.torrent` but misses
`https://example.test/a.torrent?dl=1`; declare the query-form mask alongside it.

This contract applies only to Browser downloads, before the save dialog; ordinary navigation is not
captured. A live run confirmed that a matching download is cancelled, creates no save path or
download entry, and opens the source URL in the board that won the claim. Persephone also notifies
you with the board's name.
