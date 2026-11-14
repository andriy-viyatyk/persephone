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
  "contentProviders": [{ "type": "acme/mem", "schemes": ["mem"] }]
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

Register the implementation from the declared module service, not from the board page:

```js
persephone.providers.register("acme/mem", {
    readBinary(config) {
        return new TextEncoder().encode(`content for ${config.name}`);
    },
    stat() {
        return { exists: true };
    },
});
```

`readBinary()` must return a `Uint8Array`; `writeBinary()`, `stat()`, and `watch()` are optional.

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
persephone.providers.register("acme/mem", {
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
persephone.providers.register("acme/mem", {
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
