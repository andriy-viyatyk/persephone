# US-1461: Script `io` exports for `registerProvider` / `registerScheme`

**Status:** Planned  |  **Epic:** [EPIC-105](../../epics/EPIC-105.md)  |  **Depends on:** US-1458 and US-1459 (implemented in the current source)

This document is investigation and planning only. It proposes no production-code, test, or test-harness change. The task is to make the existing provider and scheme registry seams reachable from a user script through `io`, so one script can install a session-only provider and URL scheme and open content through the normal pipeline.

## Goal

Expose `io.registerProvider(type, factory)` and `io.registerScheme(scheme, hooks)` using the registry contracts already used by the renderer. A complete script must be able to register both, open a page through the new scheme, and demonstrate the intended session lifetime and restart boundary.

## Background

### Binding decisions

The plan follows the binding decisions in [EPIC-105](../../epics/EPIC-105.md):

- **D1:** `openRawLink`, `openLink`, and `openContent` remain the existing `EventChannel` pipeline. The script registration API only adds registry entries; it must not create a second page-opening path.
- **D2:** `createPipeFromDescriptor()` continues to throw for an unknown provider type. The provider-missing placeholder and `PendingProvider` remain Phase C work.
- **D8:** Verification is by observations made in the running app, including the scheme open, duplicate registration, and restart behavior. No unit-test framework or test harness is part of this task.

US-1458 and US-1459 are already present in the current source. The epic's historical description of provider duplicates as silent `Map.set` replacement is no longer current: `registry.ts:21-38` and `scheme-registry.ts:35-53` now report duplicates and keep the first entry.

### Current `io` surface and its assembly

The runtime and type surfaces are separate but already follow one clear pattern:

| Concern | Current owner | Verified behavior |
|---|---|---|
| Runtime object | `src/renderer/scripting/api-wrapper/IoNamespace.ts:15-35` | `createIoNamespace()` returns the provider/transformer constructors, `createPipe`, and link helpers. |
| Per-script ownership | `src/renderer/scripting/ScriptContext.ts:54-66` | Each `ScriptContext` creates `readonly io = createIoNamespace()`. The namespace is a wrapper object, not a global registry object. |
| Top-level injection | `src/renderer/scripting/ScriptRunnerBase.ts:6-15` | The script prefix binds `io=this.io`, alongside `app`, `page`, and `ai`. |
| Script typings | `src/renderer/api/types/io.d.ts:1-106` | `IIoNamespace` declares the current `FileProvider`, `HttpProvider`, transformers, link helpers, and `createPipe`. |
| Global declaration | `src/renderer/api/types/index.d.ts:25-32` | `const io: IIoNamespace` is the global script declaration. |
| Monaco copy | `vite.renderer.config.ts:7-39` | The build/dev plugin copies every `src/renderer/api/types/*.d.ts` into `assets/editor-types/` and regenerates `_imports.txt`; `assets/editor-types/io.d.ts` is generated output, not a second hand-authored contract. |
| Existing user documentation | `assets/guides/scripting/api/io.md:1-11` and `assets/guides/scripting/api/index.md:245-252` | The `io` namespace is documented as the content-pipe/link-pipeline API. |

The implementation must extend `IoNamespace.ts` and `io.d.ts` in those locations. `ScriptContext.ts`, `ScriptRunnerBase.ts`, and `index.d.ts` already inject and type the namespace and do not need a new mechanism.

### Registry contracts already in use

The provider registry is in `src/renderer/content/registry.ts`:

- `ProviderFactory` is currently `(config: Record<string, unknown>) => IProvider` (`registry.ts:15`).
- `registerProvider(type, factory)` keeps the first factory and calls `reportDuplicate("provider", type)` for a duplicate (`registry.ts:21-38`). The notification is an asynchronous `ui.notify(..., "error")` (`registry.ts:21-29`).
- `createProviderFromDescriptor()` looks up the descriptor's exact `type`, throws `Error('Unknown provider type: "..."')` when absent, and otherwise calls the factory with `descriptor.config` (`registry.ts:48-54`).
- Built-in provider registrations remain module-load declarations at `registry.ts:72-90`.

The scheme registry is in `src/renderer/content/scheme-registry.ts`:

- `SchemeHookContext` is the existing public-to-the-pipeline shape (`scheme-registry.ts:8-12`): `phase`, `delegate`, and descriptor-based `createPipe`.
- `SchemeHooks` requires both `parse` and `resolve` (`scheme-registry.ts:14-22`). Both hooks may be synchronous or asynchronous.
- `registerScheme()` normalizes by trim/lowercase/removing one trailing colon, keeps the first entry, and reports duplicates (`scheme-registry.ts:26-53`).
- `dispatchRegisteredSchemeParse()` and `dispatchRegisteredSchemeResolve()` preserve the two EventChannel layers and pass `phase: "open"` (`scheme-registry.ts:63-89`).
- `resolveRegisteredSourcePath()` runs the same hooks in `phase: "source-path"` and returns `data.pipe`, or reconstructs from `data.pipeDescriptor` (`scheme-registry.ts:91-118`).

The eleven current built-in scheme declarations are in `src/renderer/content/builtin-schemes.ts:413-425`: `http`, `https`, `data`, `folder-editor`, `git-tree`, `mneme`, `mneme-folder`, `persephone-board`, `persephone-guide`, `persephone-toolset`, and `tree-category`. Their hook bodies are the functions at `builtin-schemes.ts:48-114` and `190-410`. A script registration must use the same parse/delegate/resolve shape; it must not subscribe directly to replace these handlers.

`src/renderer/content/parsers.ts:66-69` dispatches registered parsing, `src/renderer/content/resolvers.ts:77-80` dispatches registered resolving, and `src/renderer/content/rebuild-pipe.ts:19-31` consults the registry before its HTTP/archive/file fallback. This is why a script-registered scheme works both when opened through the normal link pipeline and when a live pipe must be rebuilt from a source path during the same renderer session.

### What a script author actually supplies

`registerProvider` must receive a **factory function**, not an already-created provider and not a class constructor passed directly. The renderer calls the stored value as `factory(descriptor.config)` (`registry.ts:48-53`), without `new`. The factory may return either:

- a plain object implementing the provider shape; or
- an instance of a user-defined class created inside the factory.

The script does not import `IProvider` at runtime. `IProvider` is a TypeScript declaration used for IntelliSense and structural checking (`src/renderer/api/types/io.provider.d.ts:27-59`); a JavaScript script can simply return an object with the required members.

| `IProvider` member | Required? | If omitted or inconsistent |
|---|---:|---|
| `type: string` | Yes | Runtime registration does not validate it. The object is malformed for pipe identity and descriptor use. |
| `displayName: string` | Yes | Runtime registration does not validate it; page/display code may receive `undefined`. |
| `sourceUrl: string` | Yes | The open handler uses `data.pipe.provider.sourceUrl` to derive the opened file identity (`src/renderer/content/open-handler.ts:17-30`); a missing value breaks that identity/title path. |
| `restorable: boolean` | Yes | It is a provider capability declaration. It does not make an absent factory restorable; the factory still has to be registered when a descriptor is reconstructed. |
| `writable: boolean` | Yes | `ContentPipe.writable` reads it (`src/renderer/content/ContentPipe.ts:33-36`). Set `false` for a read-only provider. |
| `readBinary(): Promise<Buffer>` | Yes | `ContentPipe.readBinary()` calls it (`ContentPipe.ts:62-68`); omitting it causes the first read to fail at runtime. |
| `toDescriptor(): IProviderDescriptor` | Yes | `ContentPipe.toDescriptor()` calls it (`ContentPipe.ts:162-169`); omitting it breaks persistence/clone paths even if an initial read succeeded. |
| `createReadStream(range?)` | No | It may be omitted today. `IProvider` marks it optional (`io.provider.d.ts:41-48`), and the current `ContentPipe` does not call it. A consumer requiring ranged/streamed bytes must not assume it exists. |
| `writeBinary(data)` | No | Omit it for read-only providers and set `writable: false`. If a provider incorrectly advertises `writable: true` while omitting it, `ContentPipe._writeBinary()` returns without writing (`ContentPipe.ts:94-99`). |
| `stat()` | No | Optional calls use `?.`; without it, existence/size/mtime information is unavailable and text restore cannot mark deletion from a missing stat (`TextFileIOModel.ts:238-247`). |
| `watch(callback)` | No | `ContentPipe.watch` is `undefined` when the provider has no watcher (`ContentPipe.ts:142-145`); the editor simply does not subscribe to external-change notifications. |
| `dispose()` | No | Pipe disposal calls it conditionally (`ContentPipe.ts:172-176`); omission is a no-op. |

`registerScheme` must receive a **plain hooks object** with mandatory `parse` and `resolve` functions. These are structural callbacks matching `SchemeHooks`; a class can provide the methods, but the author still passes an object/value with both functions. The parse hook should set `data.url`, set `data.handled = false`, await `context.delegate()`, and then mark the layer handled. The resolve hook should set `data.target` as needed, provide a persistable `data.pipeDescriptor`, create `data.pipe` with `context.createPipe()`, and delegate to Layer 3 in `phase: "open"`. In `phase: "source-path"`, it must return after constructing the pipe and must not delegate into page opening.

### Complete runnable example

This is the acceptance script. It uses no imports or unavailable declaration names. The provider is a plain object returned from a factory, and the scheme uses the existing two-phase registry hook contract.

```javascript
const providerType = "script-demo-provider";
const scheme = "script-demo";

io.registerProvider(providerType, (config) => {
    const text = typeof config.text === "string" ? config.text : "";

    return {
        type: providerType,
        displayName: "Script demo",
        sourceUrl: `${scheme}://hello`,
        restorable: true,
        writable: false,
        async readBinary() {
            return Buffer.from(text, "utf8");
        },
        toDescriptor() {
            return {
                type: providerType,
                config: { text },
            };
        },
    };
});

io.registerScheme(scheme, {
    async parse(data, context) {
        data.url = data.href;
        data.handled = false;
        await context.delegate();
        data.handled = true;
    },

    async resolve(data, context) {
        data.target = "monaco";
        data.pipeDescriptor = {
            provider: {
                type: providerType,
                config: { text: "Hello from a script-registered provider." },
            },
            transformers: [],
        };
        data.pipe = context.createPipe(data.pipeDescriptor);

        if (context.phase === "source-path") return;

        data.handled = false;
        await context.delegate();
        data.handled = true;
    },
});

await app.events.openRawLink.sendAsync(
    io.createLinkData(`${scheme}://hello`),
);
```

The descriptor is deliberately created in the scheme resolver, rather than only assigning a live `pipe`: `open-handler.ts:28-30` persists the cleaned link data, and `ContentPipe.toDescriptor()` persists the provider descriptor for the page state. The example's provider omits every optional method, proving that `createReadStream`, `writeBinary`, `stat`, `watch`, and `dispose` are not needed for a read-only text page.

When the example is run again in the same renderer, its provider and scheme registrations are script-owned replacements: each replacement reports an `info` notification naming the prior registration, and a newly opened `script-demo://hello` uses the newest factory/hooks. If the text is edited before the second run, an already-open page keeps the old live pipe and its existing content; opening the scheme again observes the edited value. A renderer reload/restart clears both registrations.

### Lifetime, cleanup, duplicates, and reserved schemes

**Lifetime and unregister decision.** The maps in `registry.ts:18-19` and `scheme-registry.ts:24` are module-level renderer state. A normal `ScriptRunner` run disposes its `ScriptContext` after execution (`src/renderer/scripting/ScriptRunner.ts:79-121`), but `ScriptContext.dispose()` only releases context-owned resources/subscriptions (`ScriptContext.ts:175-188`); it does not and should not unregister registry entries. An autoload reload also disposes the old shared context before loading the files again (`src/renderer/scripting/AutoloadRunner.ts:72-80` and `132-139`), but it is still the same renderer session.

US-1461 should therefore define the lifetime as **the renderer session/window**: registrations survive individual script completion, F5 context disposal, and autoload re-execution; they disappear when that renderer reloads or the application restarts. The provider factory should be self-contained and reconstruct from its descriptor config rather than retaining page/context state. Recommend **no unregister API** in this task. Replacement is enough for script iteration, while unregister would leave the fate of already-open pages and their live pipes undefined; a future task can define that lifecycle if the platform needs it.

**Ownership and duplicate reporting decision.** Registry entries must record an explicit origin/owner at registration time. The `io` wrappers pass `origin: "script"`; platform declarations use `origin: "platform"` explicitly, and no call-stack or timing inference is allowed. A later script registration of the same provider type or normalized scheme replaces an earlier **script-owned** entry and reports an `info` notification naming the replaced registration. A script attempting to claim a platform-owned entry still receives the existing duplicate error and does not take the name. Platform registrations remain first-wins; the built-in registration order continues to establish their ownership before scripts run. The origin field is deliberately the hook for Phase C board ownership; this task does not define the board rule, and a board registration is not script-owned.

This satisfies EPIC-105's "report rather than silently replace" criterion: script replacement is observable at `info`, and platform-owned entries are never replaced by scripts. An already-open page keeps the provider object its live pipe already holds; the replacement applies to subsequent provider resolutions and scheme dispatches. The info report names the replaced provider type or scheme and its recorded `script` origin, making a replacement between independent scripts visible. On a second run of the example in the same renderer, the author sees an info notification naming the previous script-owned provider and another naming the previous script-owned scheme, and newly opened content uses the newest factory/hooks. This makes autoload editing iterable without hiding a collision between independently owned registrations.

**Reserved schemes decision.** Defer the reserved-name enforcement list to Phase C, where the roadmap places the one-owner/reserved-scheme policy (`doc/platform-roadmap.md:226-237` and `437-447`). US-1461 should not add a second, script-only reservation mechanism to `registerScheme`: `http`, `https`, `data`, `mneme`, and the current `persephone-*` entries are already occupied by the eleven built-ins and therefore produce the existing duplicate error; `file` remains the D3 non-scheme fallback (`doc/tasks/US-1458-scheme-registry/README.md:107-110`), and `blob` is not a current registry entry. Phase C should enforce the complete reserved set `http`, `https`, `file`, `data`, `blob`, `mneme`, plus every scheme beginning `persephone-`, with a clear reserved-name error before registration. This task must document that boundary rather than partially implement it. If `file`/`blob` protection is required before Phase C, it should be split out as an explicit policy task instead of hidden in this small export change.

### Persistence boundary

The normal open path stores the scheme source identity and descriptor: `open-handler.ts:17-30` derives `sourceLink` through `cleanForStorage()`, and `src/shared/link-data.ts:55-76` removes transient pipe/event fields but retains persistence-safe link metadata such as `pipeDescriptor`. `TextEditorModel.getRestoreData()` serializes the live pipe descriptor (`src/renderer/editors/text/TextEditorModel.ts:292-305`).

After a renderer restart, the script-registered factory is not present until a script runs, and normal page restoration occurs before delayed autoload loading (`src/renderer/api/app.ts:281-327`). Reconstructing the persisted descriptor therefore reaches `createProviderFromDescriptor()` and throws `Unknown provider type: "script-demo-provider"` at `registry.ts:48-53` under D2. The current text restore boundary catches that error in `TextEditorModel.applyRestoreData()` and sets `restoredPipe = null` (`TextEditorModel.ts:308-315`); it does not show a provider-missing placeholder or create a `PendingProvider`. The page consequently cannot restore the script provider's content through the missing descriptor. Those user-facing recovery behaviors are explicitly Phase C and must not be designed or smuggled into US-1461.

## Implementation Plan

### 1. Record origin and export script-owned registry wrappers through the runtime `io` object

- Extend the entry values in `src/renderer/content/registry.ts:18-53` and `src/renderer/content/scheme-registry.ts:24-53` to retain the registered factory/hooks together with an explicit origin/owner. Keep the origin type extensible for a future board owner, but define only `platform` and `script` behavior in this task. Update lookups and dispatchers to read the factory/hooks from the entry value.
- Keep built-in provider and scheme registrations platform-owned and first-wins. Extend the duplicate path so `platform` remains an error/keep-first case, while `script` followed by `script` replaces the entry and reports an `info` notification that names the previous owner/registration. A script cannot replace a platform-owned entry. The registry must receive this origin explicitly; it must not infer ownership from call stacks or registration timing.
- Edit `src/renderer/scripting/api-wrapper/IoNamespace.ts:1-34`.
- Import the registry functions under internal aliases and expose two small wrappers that call them with `{ origin: "script" }`.
- Do not return a disposer or add a separate lifecycle; the wrapper is the explicit ownership boundary.
- Update the namespace comment to say that it also contributes provider factories and URL scheme hooks for the current renderer session.

Before:

```ts
import { createPipe } from "../../content/ContentPipe";
import { createLinkData, linkToLinkData } from "../../../shared/link-data";

// ...
        createPipe,
        createLinkData,
        linkToLinkData,
```

After:

```ts
import { createPipe } from "../../content/ContentPipe";
import { registerProvider as registerProviderInRegistry } from "../../content/registry";
import { registerScheme as registerSchemeInRegistry } from "../../content/scheme-registry";
import { createLinkData, linkToLinkData } from "../../../shared/link-data";

// ...
const registerProvider = (type, factory) =>
    registerProviderInRegistry(type, factory, { origin: "script" });
const registerScheme = (scheme, hooks) =>
    registerSchemeInRegistry(scheme, hooks, { origin: "script" });

// ...
        createPipe,
        registerProvider,
        registerScheme,
        createLinkData,
        linkToLinkData,
```

No change is needed in `ScriptContext.ts` or `ScriptRunnerBase.ts`; their existing `io` construction and injection automatically expose the added members to every script context, including `script.execute` and autoload scripts.

### 2. Add structural script typings that mirror the current internal contracts

- Edit `src/renderer/api/types/io.d.ts:1-106`.
- Import `IPipeDescriptor` from `./io.pipe`.
- Add public declaration-only types for the provider factory and scheme hook context/hooks. Keep them structural so a script can write a plain object without importing a runtime `IProvider` or `SchemeHooks` value.
- Add `registerProvider(type, factory): void` and `registerScheme(scheme, hooks): void` to `IIoNamespace` with JSDoc examples, session lifetime, script-owned replacement, platform-owned duplicate errors, and live-pipe behavior.
- Keep `IProvider`'s mandatory/optional members in `io.provider.d.ts` unchanged; the task exposes the existing contract rather than changing provider semantics.

Before:

```ts
import type { IContentPipe } from "./io.pipe";
import type { ILinkData } from "./io.link-data";

export interface IIoNamespace {
    // constructors and helpers...
    createPipe(provider: IProvider, ...transformers: ITransformer[]): IContentPipe;
}
```

After:

```ts
import type { IContentPipe, IPipeDescriptor } from "./io.pipe";
import type { ILinkData } from "./io.link-data";

export type IProviderFactory = (config: Record<string, unknown>) => IProvider;

export interface ISchemeHookContext {
    readonly phase: "open" | "source-path";
    readonly delegate: () => Promise<boolean>;
    readonly createPipe: (descriptor: IPipeDescriptor) => IContentPipe;
}

export type ISchemeHook =
    (data: ILinkData, context: ISchemeHookContext) => void | Promise<void>;

export interface ISchemeHooks {
    parse: ISchemeHook;
    resolve: ISchemeHook;
}

export interface IIoNamespace {
    // constructors and helpers...
    registerProvider(type: string, factory: IProviderFactory): void;
    registerScheme(scheme: string, hooks: ISchemeHooks): void;
    createPipe(provider: IProvider, ...transformers: ITransformer[]): IContentPipe;
}
```

The exact public names may be adjusted during implementation only to match the repository's naming convention; the signatures and structural shape above are fixed by the current runtime contracts at `registry.ts:15` and `scheme-registry.ts:8-22`.

### 3. Document the API where scripts and MCP agents already learn `io`

- Extend `assets/guides/scripting/api/io.md` with the registration signatures, the mandatory/optional provider table, the parse/resolve phase rules, the complete example above, session lifetime, script-owned replacement versus platform-owned duplicate behavior, restart limitation, and the rule that existing live pipes keep their objects while subsequent resolutions use replacements.
- Extend the `io` summary in `assets/guides/scripting/api/index.md:245-252` with `io.registerProvider` and `io.registerScheme`.
- Extend `assets/guides/agents/scripting.md` with a short section explaining that these members are available inside `script.execute` and that the script must use `app.events.openRawLink.sendAsync(io.createLinkData(...))` (or the existing `app.openRawLink`) to enter the normal pipeline.
- Extend `SCRIPT_HELP` in `src/renderer/scripting/ai-vision/root.ts:99-133` so the live MCP `$help` says that the `io` global includes session-scoped registry registration, factory/hooks are structural, script-owned re-registration replaces with an info report, platform duplicates are first-wins errors, and restart recovery is not available in Phase A.
- Let the existing `vite.renderer.config.ts:20-39` copy the updated `io.d.ts` into `assets/editor-types/io.d.ts`; do not hand-maintain a divergent generated declaration.

These changes make the API visible to the script editor and to the MCP `script.execute` documentation without adding `io` as a separate `call` object-model node.

### 4. Preserve the pipeline and persistence boundaries

- Do not change the dispatch pipeline in `src/renderer/content/builtin-schemes.ts`, `src/renderer/content/parsers.ts`, `src/renderer/content/resolvers.ts`, or `src/renderer/content/rebuild-pipe.ts`; the registry metadata/replacement changes above are the only registry behavior change.
- Do not add unregister, silent equality comparison, provider validation, reserved-name enforcement, missing-provider recovery, or `PendingProvider` in this task.
- Do not add a script-side page-opening helper. The scheme hooks must continue to delegate through D1's existing event channels, and the descriptor must continue to cross the existing `cleanForStorage()`/`createPipeFromDescriptor()` boundary.

### 5. Verify manually in the app

- Run the complete example in a renderer script context. Observe one new Monaco page containing `Hello from a script-registered provider.` The provider has no optional stream/stat/watch/dispose methods, so a successful read verifies the minimal read-only provider contract.
- Run the same script again without reloading the renderer. Observe an info notification naming the replaced script-owned provider and another naming the replaced script-owned scheme. Open the scheme again and confirm the newest factory/hooks are active; an already-open page continues using its existing live provider/pipe. Edit the example text before the second run to make the replacement visible.
- Close/restart the application with the example page persisted, without first executing the registration script. Observe that the persisted descriptor names `script-demo-provider`, reconstruction follows the D2 unknown-provider throw path, and the page does not receive a provider-missing placeholder or `PendingProvider`. This is the expected Phase A failure boundary, not a failure to fix here.
- Execute the example after restart and open `script-demo://hello` again. Observe that registration is restored for the new renderer session and the page opens successfully through the normal pipeline.
- From the MCP side, run the example through `script.execute` or read `script.$help`; observe that the members are available inside the script global `io`. Do not expect `call("io.registerProvider")` or a new root `io` node: the MCP object model exposes `script.execute`, while `io` remains a script-only namespace.

## Concerns / Open Questions

There are no unresolved design questions for this task. The decisions below are intentional boundaries for implementation:

1. **Autoload reload is not a renderer reload.** `AutoloadRunner.loadScripts()` disposes subscriptions but the registry maps are process/module state, so reloading an autoload file in the same window keeps the session entries and replaces script-owned factories/hooks with an explicit info report. Existing live pipes retain their objects; subsequent resolutions use the replacement. The user guide must say "renderer reload/restart," not imply that the autoload reload button resets registrations.
2. **Factory closures can outlive a script context.** The registry retains the callback. Documentation should recommend descriptor-config-only factories and warn against capturing a page, UI facade, or disposable context resource.
3. **Reserved `file`/`blob` policy is deferred.** Built-in collisions are already reported, but those two names are not both map entries today. Phase C must apply one central reserved/ownership rule before board or other module registration expands.
4. **Unknown provider behavior is deliberately not softened.** The current restore catches the low-level throw at the text-editor boundary, but no placeholder or pending state is authorized by D2. The acceptance run must record that observable limitation rather than treating it as an implementation defect in US-1461.
5. **No automated test files.** The repository's Phase A verification model is live app/MCP observation under D8; adding a test framework or harness would be out of scope.

## Acceptance Criteria

All criteria are observations made by running the complete example script in the app:

- `io.registerProvider` and `io.registerScheme` are callable from a normal renderer script and from `script.execute`; the example creates a provider page through `app.events.openRawLink` and `io.createLinkData`, with Monaco showing `Hello from a script-registered provider.`
- The example provider is a plain object returned by a factory and implements only the mandatory provider members plus `readBinary()`/`toDescriptor()`; the page reads successfully without `createReadStream`, `writeBinary`, `stat`, `watch`, or `dispose`.
- Running the example a second time in the same renderer reports both script-owned replacements at `info`, naming what was replaced; a newly opened page uses the newest factory/hooks, while a page already open keeps its existing live provider/pipe. No replacement is silent.
- The registration survives completion/disposal of the script context and remains usable for another script in the same renderer session; a renderer reload/restart removes it until the script runs again.
- After restart, the persisted page's descriptor names `script-demo-provider`, the current D2 unknown-provider construction path is observable through the failed/unavailable restore, and there is no provider-missing placeholder or `PendingProvider`.
- Running the example after restart registers the factory and scheme again, and a new `script-demo://hello` open succeeds through the existing Layer 1   Layer 2   Layer 3 pipeline.
- The user guide, Monaco declaration source, generated editor declaration, and MCP `script.$help` describe the same signatures, provider shape, lifetime, duplicate behavior, and restart limitation. The MCP object model does not gain a standalone `io` node.
- No source file under `src/` is modified by this planning task, no test/harness file is added, `doc/active-work.md` and `doc/epics/EPIC-105.md` remain unchanged, and no commit is created.

## Files that need no changes

- `src/renderer/scripting/ScriptContext.ts` and `src/renderer/scripting/ScriptRunnerBase.ts`   already construct and inject `io` for every script.
- `src/renderer/api/types/index.d.ts`   already declares the global `io: IIoNamespace`.
- `src/renderer/content/builtin-schemes.ts`   all eleven built-in registrations already occupy their names.
- `src/renderer/content/parsers.ts`, `src/renderer/content/resolvers.ts`, `src/renderer/content/rebuild-pipe.ts`   US-1458/US-1459 pipeline seams are already registry-first and must not be reimplemented here.
- `src/renderer/content/ContentPipe.ts` and `src/renderer/content/providers/*`   the provider contract and optional-method behavior are already defined.
- `src/renderer/content/open-handler.ts`, `src/shared/link-data.ts`, `src/renderer/editors/text/TextEditorModel.ts`   existing descriptor persistence and restore boundaries must be reused, not changed.
- `src/renderer/scripting/ai-vision/root.ts` root/member model   no standalone `io` object-model node is required; only the `script.$help` text is planned for update.
- `vite.renderer.config.ts` - its existing copy plugin already propagates `io.d.ts` to Monaco's generated asset.
- `doc/active-work.md` and `doc/epics/EPIC-105.md`   explicitly excluded by the user, despite the general dashboard/linking rule.

## Files Changed Summary

| File | Planned role in implementation | Changed by this planning task |
|---|---|---:|
| `doc/tasks/US-1461-io-registry-exports/README.md` | Investigation, decisions, implementation checklist, runnable example, and D8 acceptance observations | Yes |
| `src/renderer/scripting/api-wrapper/IoNamespace.ts` | Export script-origin wrappers for `registerProvider` and `registerScheme` on the runtime namespace | No |
| `src/renderer/api/types/io.d.ts` | Add structural factory/hook types and the two `IIoNamespace` methods | No |
| `src/renderer/scripting/ai-vision/root.ts` | Describe the new script-global members in live `script.$help` | No |
| `assets/guides/scripting/api/io.md` | User-facing `io` API documentation and example | No |
| `assets/guides/scripting/api/index.md` | Add the two methods to the script API index | No |
| `assets/guides/agents/scripting.md` | MCP-agent-facing script API guidance | No |
| `assets/editor-types/io.d.ts` | Generated Monaco copy of `src/renderer/api/types/io.d.ts`; update via the existing Vite sync | No |
| `src/renderer/content/registry.ts` | Record origins and implement script-owned replacement with info reporting while preserving platform first-wins and D2 | No |
| `src/renderer/content/scheme-registry.ts` | Record origins and implement script-owned replacement with info reporting while preserving platform first-wins and D1 dispatch | No |
| `src/renderer/content/builtin-schemes.ts` | No behavior change; built-in names remain occupied | No |
| `src/renderer/content/parsers.ts` / `src/renderer/content/resolvers.ts` / `src/renderer/content/rebuild-pipe.ts` | No pipeline rewrite; consume the already-implemented registry | No |
| `doc/active-work.md` / `doc/epics/EPIC-105.md` | Normally dashboard/epic links, but explicitly forbidden for this task | No |

