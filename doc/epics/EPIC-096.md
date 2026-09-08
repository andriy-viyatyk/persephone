# EPIC-096: The `ai-vision` library

## Status

**Status:** Completed (except the npm publish, which needs the user's npm login)
**Created:** 2026-09-08
**Completed:** 2026-09-08

**Repository:** https://github.com/andriy-viyatyk/ai-vision (public, pushed).
**Local:** `C:\projects\ai-vision`. **npm:** `ai-vision` is still unpublished — see "Publishing".

Epic 1 of 3 in the [AiVision library roadmap](../ai-vision-library-roadmap.md). It is independent:
nothing in Persephone changes here. Adoption is EPIC-097.

## Overview

Extract the AiVision engine out of Persephone into its own MIT-licensed npm package, `ai-vision`,
in a new public repository at `C:\projects\ai-vision`. The package is the *only* implementation
from EPIC-097 onward: Persephone will import it and delete `src/shared/ai-vision/`,
`src/renderer/scripting/ai-vision/elements.ts` and `assets/agent/ui-highlight.js`.

The package ships more than the extraction. It adds the two halves the roadmap's remote-tree design
needs: a **remote** entry a board or a web page calls to publish its object model as serializable
data, and a **host-side proxy builder** that turns such a shape into ordinary AiVision nodes the one
resolver can walk. Shape crosses the boundary; the engine does not.

## Goals

- `ai-vision@1.0.0` published, ESM + `.d.ts`, zero runtime dependencies, three entry points.
- Byte-faithful behaviour for the extracted core — Persephone must be able to swap imports in
  EPIC-097 with no observable difference on the AiVision QA surfaces.
- A remote contract with a `schemaVersion` and additive-within-a-major rules, documented well
  enough that an application that is not Persephone can adopt it from the README alone.
- A demo page that proves the loop end to end in a plain browser, and that EPIC-097 uses as its
  browser-transport test surface.

## Repository and package

| Item | Value |
|---|---|
| Local path | `C:\projects\ai-vision` |
| GitHub | `andriy-viyatyk/ai-vision`, public |
| License | MIT, `Copyright (c) 2026 andriy-viyatyk` (identical to Persephone's) |
| Package name | `ai-vision` |
| Version | `1.0.0` |
| Module format | ESM only (`"type": "module"`), `.d.ts` emitted by `tsc` |
| Dependencies | none at runtime; `typescript` the only devDependency |
| Entry points | `ai-vision` (core), `ai-vision/dom`, `ai-vision/remote`, plus the raw overlay file |

Layout:

```
/src
  /core       resolver, types, path-parser, hint, help-search, member-suggestion,
              result-shaper, argument-validation, errMessage, remote-proxy
  /dom        elements.ts (generalized createElements), highlight overlay + injectable source
  /remote     expose(), describe(), the ai:* handler, window.__aiVision publication
/examples
  /demo-page  static page: expose() + in-page proxy + resolver, no build step
/scripts      generate-highlight-source.mjs (overlay .js -> exported string constant)
/dist         tsc output, published
```

## Linked Tasks

Work happens in the `ai-vision` repository; there are no `doc/tasks/` folders for these.

| Task | Title | Status |
|------|-------|--------|
| US-1383 | Repository scaffold, license, build, and core extraction | Done |
| US-1384 | `dom` entry: generalized `createElements` and the highlight overlay | Done |
| US-1385 | `remote` entry: `expose`, `describe`, `ai:*` handlers, `window.__aiVision` | Done |
| US-1386 | Host-side proxy builder over a shape and a `send` function | Done |
| US-1387 | `examples/demo-page` — the browser proof and EPIC-097's test surface | Done |
| US-1388 | README (contract, tool description, versioning), pack check, publish | Done except publish |

## Scope in detail

### Core (`ai-vision`)

The eight files of `src/shared/ai-vision/` move verbatim except for these edits:

1. `errMessage` is inlined as `src/core/errors.ts` (copied from `src/shared/utils.ts`, unchanged
   semantics) and `resolver.ts` imports it from there instead of `../utils`.
2. Every relative import gains an explicit `.js` extension, so the emitted ESM runs unbundled in
   Node and in a browser.
3. Persephone-specific doc comments (references to `doc/epics/EPIC-083.md`, "the renderer's script
   wrappers", `Page.grouped`, `EPIC-087, US-1324`) are rewritten as generic prose. **The rules they
   describe are kept** — in particular the string-coercion rule in `resolveCall` (an MCP client
   parses `value` as JSON, so an object arriving for a string-valued property is re-serialized)
   is behaviour, not a Persephone anecdote.
4. Nothing is renamed. `IAiVisionDescriptor`, `IAiMember`, `resolveCall`, `registerAiVisionFor`,
   `shapeResult`, `helpSearch` and the rest keep their current names so EPIC-097's adoption is an
   import-path change only.

A single barrel `src/core/index.ts` re-exports everything; the internal files stay separate.

### `ai-vision/dom`

- `createElements(declarations, highlightElement, options)` from
  `src/renderer/scripting/ai-vision/elements.ts`, with the three Persephone types replaced by
  package-owned equivalents: `IAiHighlightOptions`, `IAiHighlightResult`, `IAiElementRevealRequest`
  (same fields as `IHighlightOptions` / `IHighlightResult` / `IHighlightRevealRequest` in
  `src/renderer/api/types/ui.d.ts` and `src/renderer/api/ui.ts`). The highlight function stays
  injected, as it already is.
- The overlay from `assets/agent/ui-highlight.js`, ASCII-only and dependency-free as it is today,
  with the Persephone naming generalized (see decision 4).
- `installHighlightOverlay()` — installs the overlay in the current document and returns its API.
- `highlightOverlaySource` — the overlay's source as a string, so a host can inject it into a frame
  it does not own (Persephone does exactly this over CDP today). Generated at build time from the
  `.js` file by `scripts/generate-highlight-source.mjs`; one file, one source of truth.
- `highlightElement(selector, message?, options?, reveal?)` — a ready-made highlight function over
  the installed overlay, so a remote party wiring `createElements` writes no glue.

### `ai-vision/remote`

```ts
expose(root: object, options?: IExposeOptions): IAiVisionRemote
interface IAiVisionRemote {
    readonly schemaVersion: number;
    describe(): IAiVisionShape;
    handle(request: IAiRemoteRequest): Promise<IAiRemoteResponse>;
    refresh(): void;   // re-serialize the shape after the model's members change
    dispose(): void;   // remove window.__aiVision
}
```

`describe()` walks the root and serializes **shape only** — `kind`, `summary`, `members` (with
`signature`, `caution`, `writable`, `node`, `indexable`, `timeoutMs`), `help` (resolved if it is a
function), `overview`, element declarations, and recursively the shape of every `node: true` member.
Values, functions and `children()` results are never serialized; they are fetched per request.

`handle()` answers the six actions of the roadmap's table: `ai:get`, `ai:set`, `ai:invoke`,
`ai:children`, `ai:elements`, `ai:highlight`. Each carries a `path` in the library's own path syntax
and is walked with the package's `parsePath`, so the host and the remote agree on `items[3]` and
`pages["id"]` without a second parser. Results pass through `shapeResult(value, maxLength)` on the
remote side before crossing.

`expose` publishes `window.__aiVision` unless `{ publish: false }`. The object is transport-neutral:
a board shim binds `handle` to `postMessage`, a web page lets the host call it over `evaluate`, and
the demo page calls it in-process.

### Host-side proxy builder (in **core**)

```ts
createRemoteProxy(shape: IAiVisionShape, send: (request: IAiRemoteRequest) => Promise<IAiRemoteResponse>,
                  options?: IRemoteProxyOptions): IAiVisible
```

Returns an object carrying an `aiVision` descriptor built from the shape — `members`, `help`,
`elements`, `index` for `indexable` members, `provide` for every member (properties resolve to a
promise from `ai:get`, methods to a function issuing `ai:invoke`), `children()` issuing `ai:children`,
and `restricted()` delegated to `options.restricted`. Nested `node: true` members produce nested
proxies over the same `send`, so hint paths are correct by construction and nothing rewrites strings.

Writable properties are supported because the resolver assigns with `current[name] = value`: the
proxy exposes them as accessor properties whose setter issues `ai:set` and whose getter issues
`ai:get`. The setter is fire-and-forget from the resolver's point of view; failures surface on the
next read, and `options.onError` is called. This is the one place the remote contract is weaker than
an in-process node, and the README says so.

### Demo page

`examples/demo-page/index.html` + `app.js`, no build step, loaded from the filesystem or any static
server. It holds a small model — a list of items, a text filter, a status filter, `addItem`,
`toggleItem`, `clear` — with `data-name` on the controls, exposes it with `expose()`, and then, in
the same page, mounts `createRemoteProxy` over a loopback `send` and runs `resolveCall` against it
from a path box, rendering result and hint. That is the gate: the library's own resolver walking a
shape that crossed a (degenerate) boundary, in a browser. It also leaves `window.__aiVision` in
place, which is what EPIC-097 probes over CDP.

## Design decisions

**1. The proxy builder lives in core, not remote.** (Roadmap open question, resolved as proposed.)
It is host-side code and must not drag the DOM or `window` into a host that only mounts shapes;
core is DOM-free and stays so. `remote` may depend on `dom` (it runs in a page and needs the overlay);
`core` depends on nothing.

**2. `schemaVersion` is an integer major, `1`.** Additive changes within the major do not bump it —
a consumer feature-detects by field presence, which is what "unknown fields are ignored" already
requires; a minor number would be a second, weaker way to ask the same question. The package version
is carried separately as `AI_VISION_VERSION` for diagnostics. A breaking change bumps the integer and
the package major together.

**3. The library reports declared timeouts; the host enforces them.** A serialized method may carry
`timeoutMs`, and every request the proxy emits carries the declared value, but the library starts no
timers: the roadmap's four-level policy (per-call option, remote-declared, runtime knob, built-in
default) is host policy, and Persephone's level 3 and 4 values live in Persephone. The package
exports `resolveTimeoutMs(perCall, declared, runtime, fallback)` so the precedence rule itself is
not reimplemented per host.

**4. The overlay's global is renamed `window.__aiVisionHighlight`.** A published library must not
install a `__persephoneHighlight` global. The file header's rule survives verbatim: the accent
palette is fixed in every theme and every context so a user can always tell an agent placed the
callout, and the overlay never reads the host's design tokens. EPIC-097 updates Persephone's
`IHighlightApi` declaration and the two call sites; that rename is listed here so it is not a
surprise there.

**5. A remote shape is validated leniently.** `createElements` throws on a duplicate or quoted
element name because a Persephone facade is our own code and a throw is a bug report. A shape
arrives from another party, so `createRemoteProxy` skips the offending element (or member) and
reports it through `options.onWarning`, defaulting to `console.warn`. This pre-answers the roadmap's
EPIC-097 open question in the library, where the behaviour actually lives; EPIC-097 only wires
`ui.log` into `onWarning`.

**6. Nothing is renamed in the extracted core.** Tempting to drop the `IAi*` prefix in a package
already called `ai-vision`, but the rename would touch every Persephone call site in EPIC-097 for
no behavioural gain and would make the adoption diff unreviewable.

**7. ESM only.** Persephone is ESM, the board shim is ESM, browsers are ESM. Shipping CJS as well
would double the build and the surface for one hypothetical consumer.

**8. No test harness.** Per the project's standing rule, verification is the build, `npm pack
--dry-run`, and the demo page in a browser.

### Decided during implementation

**9. An indexable node carries an `item` shape, derived by probing `index(0)` at describe time.**
The first implementation reused the *collection's* shape for `items[3]`, so an indexed item
advertised the collection's members. The resolver requires `members` to be synchronous, so the item
shape must be in the serialized shape — there is nowhere to fetch it lazily. `describeNode`
therefore probes `index(0)` inside a try/catch: if it yields a value carrying a descriptor, that
becomes `IAiNodeShape.item`; if it throws, yields `undefined`, or yields plain data, `item` is
omitted and the host's `index(key)` falls back to an `ai:get` at `path[key]` — which is the right
answer for a list of plain data items anyway. This is the one place the library relies on the
existing rule that `index()` is a cheap, side-effect-free lookup; the probe is commented as such.

**10. `ai:get` on a node path returns `summarize()`, not the object.** Reading a node through the
proxy asks the remote for the node's own path; the remote must run the node's `summarize()` there,
exactly as `shapeResolvedResult` does in the resolver. Otherwise the live model object crosses,
functions are dropped and nested nodes flatten.

**11. A writable proxy member gets a setter and no getter.** `resolveCall` reads `current[name]`
once before assigning (the string-coercion rule for MCP-parsed `value`). Through a proxy that read
would be a stray remote round trip returning a Promise, so the coercion could never apply. The
getter is therefore omitted and the coercion moved to the remote side's `ai:set` branch, which is
the only place the property's real current value exists. Reads still work — the resolver consults
`provide` before the property.

## Gate

1. `npm run build` clean (`tsc` with `strict`), no `any` escapes added during extraction.
2. `npm pack --dry-run` lists `dist/**`, `README.md`, `LICENSE`, `package.json` — and nothing else
   (no `src`, no `examples`, no `.tsbuildinfo`).
3. The demo page, opened in a browser, resolves paths through `resolveCall` over
   `createRemoteProxy`: a property reads, a writable property round-trips, a method invokes,
   `$help` prints, `helpSearch` finds a member, `elements` reports visibility and `highlight`
   draws the overlay.
4. `window.__aiVision` present on the demo page with `schemaVersion === 1`.
5. Optional and non-blocking: a scratch copy of Persephone compiles against a `file:` install with
   `src/shared/ai-vision` replaced by package imports. Persephone itself is left unmodified — the
   roadmap's "Persephone builds against the package" gate is EPIC-097's first step.

**12. Four review findings fixed; one inherited quirk deliberately left.** `/review` compared the
package against this document and the roadmap and found six things. Four were real and are fixed:
dynamic children were unreachable through the proxy (`provide` matched static members only, so a
name validated by `children()` then read as `undefined` — it now falls back to `ai:get` when the
shape declares `hasChildren`); `helpSearch` read `current[name]` directly and so could not descend
into a proxy node, where *every* member is `provide`-backed — it now uses the resolver's precedence;
the remote `resolvePath` walked past a nested `restricted()`; and `sanitizeElements` threw on a
non-string truthy name, the opposite of the lenient policy it exists to implement. The fifth, the
unrun Persephone compatibility compile, is EPIC-097's first step by design. The sixth — `shapeValue`
calls a nested node's `summarize()` without awaiting it, so an async `summarize` can leave a Promise
in a shaped result — is **inherited from the current engine and left unchanged**: this package must
be a drop-in for Persephone, and fixing it here would make the two diverge before adoption. It is a
candidate for a follow-up in EPIC-097, where both copies change together.

## Gate results (2026-09-08)

1. **Build** — `npm run build` and `npx tsc --noEmit` clean under `strict`.
2. **Pack** — `npm pack --dry-run` lists `dist/**`, `README.md`, `LICENSE`, `package.json` and
   nothing else (85 files, 58.1 kB packed).
3. **Browser** — the demo page opened from `file://` in a Persephone browser tab, and every path
   below resolved through the package's own `resolveCall` over `createRemoteProxy` mounted on the
   shape returned by `window.__aiVision.describe()`:

   | Path | Result |
   |---|---|
   | *(empty)* | the root summary plus the `DemoApp` hint with the full member list |
   | `$help` | long-form help |
   | `helpSearch("add")` | three hits: the `addItem` member, the `add-item` element, the `$help` line |
   | `items[0].title` | `"Read the object model"` |
   | `filterText` with `value` then re-read | round-trips |
   | `addItem(title, tag)` | returns the created item |
   | `elements` | five controls, each with a resolved `[data-name=…]` selector and `visible: true` |
   | `highlight("add-item", …)` | `found: true`, and the overlay ring is drawn in the page |
   | `additem` (typo) | `"additem" is not a member of DemoApp. Did you mean "addItem"?` |

4. **`window.__aiVision`** present with `schemaVersion === 1`.
5. Not run: the optional scratch-copy compile of Persephone against a `file:` install. Persephone is
   unmodified, as this epic requires; EPIC-097's first step is that compile.

## Publishing

`npm whoami` reports **not logged in** on this machine (`E401`), so `1.0.0` was not published. The
name is confirmed still free (`npm view ai-vision` → 404). To publish:

```
npm login
cd C:\projects\ai-vision
npm publish --access public
```

`prepublishOnly` rebuilds, so no separate build step is needed.

## Notes

### 2026-09-08

- Epic opened, implemented and closed the same day. Codex wrote the package in two threads
  (core/dom/remote/proxy, then demo page and README); the plan, the four correction findings that
  produced decisions 9–11, and the browser gate run are Claude's. `npm whoami` reports no logged-in user on this machine, so publishing `1.0.0` may
  have to be done by the user; everything else is independent of it.
- The name `ai-vision` was checked free on npm on 2026-09-08 including the punctuation variants npm
  treats as equivalent. Not reserved until published.
- Deliberately out of scope: any Persephone source change, the board bridge protocol, and the
  `windows[i].` hint-prefix tax — all EPIC-097.
