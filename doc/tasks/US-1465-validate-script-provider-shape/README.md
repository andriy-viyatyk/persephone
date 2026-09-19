# US-1465: Validate a script-registered provider's shape

## Goal

When a script registers a content provider whose object is missing a required `IProvider` member,
say so clearly and name the member, instead of failing later with an opaque
`this.provider.toDescriptor is not a function` unhandled rejection.

## Background

US-1461 opened `io.registerProvider(type, factory)` to scripts. The factory is not called at
registration time — it runs when a descriptor is materialised into a provider
(`createProviderFromDescriptor` in `src/renderer/content/registry.ts`). So a malformed provider
object does not fail where it was written; it fails at first use, in pipeline code, as a
`TypeError` on whichever member is missing.

**Observed 2026-09-20**, registering this provider from a script and opening a page on it:

```js
io.registerProvider('demo-mem', (config) => ({
    async readBinary() { return Buffer.from('hello', 'utf-8'); },
    get sourceUrl() { return 'demo://' + config.key; },
}));
```

The page content loaded, and the user got three error toasts reading
`Unhandled promise rejection: TypeError: this.provider.toDescriptor is not a function`. Nothing in
that message names the provider, the registration, or the script that wrote it.

**The guide is not at fault.** `assets/guides/scripting/api/io.md:39-49` documents the contract
with a Required column, lists `toDescriptor(): IProviderDescriptor` as required, and its example
implements it. This is not a documentation gap — it is that a hand-written object is easy to get
wrong and the platform currently says nothing useful when it is.

**The contract** (`src/renderer/api/types/io.provider.d.ts`):

| Member | Required |
|---|---|
| `type`, `displayName`, `sourceUrl`, `restorable`, `writable` | yes (properties) |
| `readBinary(): Promise<Buffer>` | yes |
| `toDescriptor(): IProviderDescriptor` | yes |
| `writeBinary?(data)` | only when `writable` is true |
| `createReadStream?(range)`, `stat?()`, `watch?(cb)`, `dispose?()` | optional |

**US-1461 already gives us the discriminator.** Registry entries now record an explicit `origin`
of `"script"` or `"platform"`. That is what lets this validation apply to script-registered
providers without adding a check to the hot path for the seven built-ins, whose shapes are
guaranteed by the compiler.

## Implementation plan

1. **Validate on first construction, not at registration.** The factory is not invoked at
   registration, so there is nothing to inspect then. Wrap a script-origin factory so that the
   **first** provider it returns is shape-checked; cache the verdict per registered `type` so the
   check costs nothing on subsequent constructions.
2. **Where.** In `src/renderer/content/registry.ts`, at the point where a script-origin factory is
   stored or invoked. Built-in (`platform`) factories are not wrapped at all.
3. **What is checked.** The required properties and the two required methods from the table above,
   plus `writeBinary` when the returned object reports `writable: true`. Presence and callability
   only — do not call the methods, do not validate return types.
4. **The error.** Throw a single `Error` naming the provider type and every missing member at
   once, so one round trip fixes the object:

   ```
   Provider "demo-mem" is missing required member(s): toDescriptor(), displayName.
   See the io guide: scripting/api/io.md
   ```

   It must list *all* missing members, not the first — a hand-written object usually misses more
   than one.
5. **How it surfaces.** The throw travels the existing path that produced the current toast, so
   the user sees one clear error instead of a `TypeError`. Confirm the message reaches the alerts
   bar rather than only the console, and that it does so once per registered type, not once per
   page open.
6. **Optional members stay optional.** A provider without `createReadStream`, `stat`, `watch` or
   `dispose` must validate cleanly — those absences are normal and are how the pipeline already
   feature-detects.

## Concerns

- **Do not extend this to transformers in the same change** unless the same failure is reachable
  there; check `registerTransformer` and say so either way rather than widening silently.
- **Do not validate platform providers.** Adding a runtime check for shapes TypeScript already
  guarantees is cost for no benefit, and it would fire during bootstrap.
- **Duck-typing limits.** A member that is present but wrong (a `toDescriptor` that returns
  nonsense) still fails later. That is acceptable; this task closes the common, cheap case —
  a member simply not written.
- **Phase C boards.** When a board registers a provider across the bridge, it will need the same
  validation with a message naming the board rather than a script. Keep the check in one function
  so Phase C reuses it instead of writing a second one.

## Acceptance criteria

- [ ] Registering a provider whose object omits `toDescriptor` and opening a page on its scheme
      produces one error naming the provider type and `toDescriptor()`, and no
      `this.provider.toDescriptor is not a function` toast.
- [ ] An object missing two required members names both in a single message.
- [ ] A provider declaring `writable: true` without `writeBinary` is reported; one declaring
      `writable: false` without it is not.
- [ ] A provider with only the required members, and none of `createReadStream`, `stat`, `watch`
      or `dispose`, works exactly as it does today with no error.
- [ ] Opening several pages on a valid script provider validates once, not once per page.
- [ ] The eleven built-in providers and the app's own startup are unaffected — no new error, no
      measurable startup cost.

## Files changed

| file | change |
|---|---|
| `src/renderer/content/registry.ts` | Shape validation for script-origin provider factories |
| `assets/guides/scripting/api/io.md` | Note that a malformed provider is reported by name on first use |
