# US-1462 — Adding an `App` service in one place

**Status:** In progress · **Epic:** [EPIC-105](../../epics/EPIC-105.md) · **Depends on:** none

This document records the reviewed implementation decisions and verification expectations. No test
harness or test file is added by this task.

## Goal

Make adding a script-facing `App` service two typed edits: the `IApp` member and its descriptor
row. Compile-time checks enforce both edits, while the descriptor table drives service loading,
assignment, and `AppWrapper` delegation. Add an always-on startup check that reports a named
missing service immediately, instead of allowing a failed load to become `undefined` only when a
script first uses it.

The design must preserve the current bootstrap order and the special registration behaviours. It
must not adopt Vitest or any other test framework: EPIC-105 D7 explicitly rejects that backlog
proposal.

## Background

### Binding context

EPIC-105 D7 rules out a test framework and assigns this failure coverage to a startup assertion and
the QA surface set. D8 requires app-observable verification. The epic's stated risk is the existing
three-place edit: `src/renderer/api/app.ts:149-200`,
`src/renderer/api/types/app.d.ts:26-70`, and
`src/renderer/scripting/api-wrapper/AppWrapper.ts:65-196`.

The backlog entry at `doc/tasks/backlog.md:355-370` describes the exact runtime gap: the wrapper's
member-name assertion catches an omitted getter, but it cannot tell that a getter's backing service
was never assigned after `initServices()`.

The normal bootstrap is `src/renderer.ts:10-20`: `initServices()` is awaited before
`initPages()`, `initEvents()`, and `windowReady()`. `startRenderer()` at
`src/renderer.ts:23-27` has no `try/catch`, and the file ends with `void startRenderer()` at
line 29. Therefore a rejection from `initServices()` rejects `bootstrap()`, skips mounting, and
has no application-level error presentation. This is verified current behaviour from the source;
whether Electron's host console additionally renders an unhandled-rejection diagnostic is
runtime-dependent and unverified here.

### Current three surfaces

`src/renderer/api/app.ts` holds typed-but-undefined backing fields at lines 31-46 and individual
getters at lines 48-105. `initServices()` at lines 149-200 currently:

1. guards on `_servicesInitialized` and sets it before any import (`:150-151`);
2. awaits one `Promise.all` tuple of 13 dynamic imports (`:153-167`);
3. assigns 12 public service values (`:168-179`);
4. awaits `loadUiPreferences()` (`:181`);
5. awaits `this._downloads.init()` (`:183-184`); and
6. starts three non-blocking background hydrations (`:186-200`).

`src/renderer/api/types/app.d.ts:26-70` declares the script-facing `IApp` service members. It
also declares `version`, `pages`, `events`, `call`, `fetch`, `openRawLink`, and `runAsync`; those
are not all initialized by `initServices()` and must not be included in its service-ready check.

`src/renderer/scripting/api-wrapper/AppWrapper.ts:65-177` manually delegates each `IApp` member.
`pages` is a `PageCollectionWrapper`, `events` is a lazy subscription-tracking proxy, `call` has
wrapper-specific validation, `fetch` and `openRawLink` are copied functions, and `runAsync` uses
a worker wrapper. The name-only assertion at `:179-196` exists because a structural
`implements IApp` is intentionally impossible with those richer concrete types. It catches an
omitted property name, not a property whose backing `app` getter returns `undefined`.

`src/renderer/scripting/ScriptContext.ts:54-76` creates `new AppWrapper(...)` for the actual
script path. This confirms that checking only the singleton is insufficient: the smoke path is
`ScriptContext` → `AppWrapper` → `app`.

### Complete current `initServices()` inventory

The following is the complete awaited registration tuple and assignment inventory from
`src/renderer/api/app.ts:153-184`.

| Script member / operation | Current import and assignment | Actual module shape and initialization | Planned classification |
|---|---|---|---|
| `settings` | `import("./settings")` → `{ settings }`; `this._settings = settings` (`:154`, `:168`) | `settings.ts:196-212,341` constructs a singleton whose constructor starts `this.init()` and exposes `wait()`; the app later waits for it in `initEvents()` at `:276-279`. | Uniform service descriptor; retain the later readiness wait. |
| `editors` | `import("./editors")` → `{ editors }`; assignment (`:155`, `:169`) | `editors.ts:13-41` exports a singleton `IEditorRegistry` object. No separate init call. | Uniform service descriptor. |
| `recent` | `import("./recent")` → `{ recent }`; assignment (`:156`, `:170`) | `recent.ts:15-65` exports a singleton; `load()` is an on-demand data operation, not bootstrap initialization. | Uniform service descriptor. |
| `fs` | `import("./fs")` → `{ fs }`; assignment (`:157`, `:171`) | `fs.ts:13-36,608` starts `_init()` in its constructor and exposes `wait()`; `initPages()` explicitly waits for it at `app.ts:211-215`. | Uniform service descriptor; retain the pages readiness wait. |
| `window` | `import("./window")` → namespace `win`; assignment is `win.appWindow` (`:158`, `:172`) | `window.ts:34-60,164` exports both the `Window` class and the named singleton `appWindow`; the app needs the named sub-export, not the module namespace. | Descriptor with a selector/loader returning `appWindow`. |
| `shell` | `import("./shell")` → `{ shell }`; assignment (`:159`, `:173`) | `api/shell/index.ts:6-19` exports a singleton composed from encryption, version, and shell-call helpers. | Uniform service descriptor. |
| `ui` | `import("./ui")` → `{ ui }`; assignment (`:160`, `:174`) | `ui.ts:37-154` exports a singleton `UserInterface`; individual dialog/highlight helpers remain internal or separately exported. | Uniform service descriptor. |
| `downloads` | `import("./downloads")` → `{ downloads }`; assignment plus `await this._downloads.init()` (`:161`, `:175`, `:183-184`) | `downloads.ts:19-35,95` exports a singleton model. `init()` performs IPC hydration and subscribes to download events. | Descriptor with an `initialize(service)` hook; assign before initializing so a failed hydrate does not erase the service object. |
| `menuFolders` | `import("./menu-folders")` → `{ menuFolders }`; assignment (`:162`, `:176`) | `menu-folders.ts:25-38,117` starts its private async `init()` from the constructor; it is not awaited by `initServices()`. | Uniform descriptor; do not invent a second init call. |
| `proc` | `import("./proc")` → `{ proc }`; assignment (`:163`, `:177`) | `proc.ts:54-75` exports a typed object literal at `:66`; no init method. | Uniform service descriptor. |
| `boards` | `import("./boards")` → `{ boards }`; assignment (`:164`, `:178`) | `boards.ts:245-270` exports a typed object literal; catalog/trust work is lazy and method-specific. | Uniform service descriptor. |
| `boardVars` | `import("./board-vars/admin-api")` → `{ boardVarsAdmin }`; assignment (`:165`, `:179`) | `board-vars/admin-api.ts:14-76` exports a singleton admin object at `:76`; its first public operation performs its own readiness/dialog flow. | Descriptor with the public key `boardVars` and an export selector returning `boardVarsAdmin`. |
| UI preferences | `import("./ui-preferences")` → `{ load: loadUiPreferences }`; `await loadUiPreferences()` (`:166-167`, `:181`) | `ui-preferences.ts:41-47` exports a loader that catches snapshot errors and falls back to `{}`; `uiPreferences` at `:79-84` is not assigned to `App` or declared in `IApp`. | Keep as an explicit bootstrap operation after service loading; it is not an `App` service descriptor. |

The tuple is therefore not uniformly “module namespace → same-named export”. A proposed table that
only stores import paths would silently break `window`, `boardVars`, and `ui-preferences`, and a
table that blindly calls `init()` would break every service except `downloads`.

### Current post-tuple registrations that are not `IApp` members

The three operations at `src/renderer/api/app.ts:186-200` are deliberately fire-and-forget:

- `published-boards` imports `publishedBoards` and calls `load()` (`:186-189`; implementation
  `published-boards.ts:63-91,190`).
- `board-install-registry` imports `boardInstallRegistry` and calls `load()` (`:191-193`;
  implementation `board-install-registry.ts:55-74,159`).
- `tools/registered-tools` imports `registeredTools` and calls `ensureInitialized()` (`:195-200`;
  implementation `tools/registered-tools.ts:68-92,182`).

They are process-level/background models, not `IApp` members: none has a corresponding private
field, getter, `IApp` property, or `AppWrapper` getter in the three target files. They should stay
hand-written after the service-table loop because their non-blocking/fail-closed semantics are
different from making a script-facing member available. The current source attaches no rejection
handler despite comments describing failures as silent; an implementation of this task should add
named `.catch(...)` logging to these three background chains if the runtime check is being made the
startup diagnostic convention. That is a small robustness correction, not a conversion of them
into `App` services.

`pages` is another deliberate non-table member: `initPages()` dynamically imports `pages` and
assigns it at `app.ts:207-221`, after `initServices()`. `events` is constructed synchronously at
`app.ts:46`, and the remaining callable members are class methods/properties. The end-of-
`initServices()` check must therefore assert the descriptor keys only, not every `keyof IApp`.

## Implementation Plan

### Decision: recommend the single descriptor table

Recommend a new central registry module, `src/renderer/api/app-service-registry.ts`, rather than
only replacing the tuple in `app.ts`. A tuple-only refactor would still require a new private
field/getter in `app.ts`, a new `IApp` property, and a new `AppWrapper` getter; it would reduce
typing but would not remove the three omission points.

The registry should contain one typed descriptor per current `initServices()` service. Each
descriptor has:

```ts
interface AppServiceDescriptor<TKey extends string, TValue> {
    readonly key: TKey;
    readonly load: () => Promise<TValue>;
    readonly initialize?: (value: TValue) => Promise<void> | void;
}
```

The concrete list should use explicit public return types through `IApp["service"]`, not inferred
concrete implementation types. The list should be `as const` and checked with
`satisfies`, so its key union and value types become the source for an `AppServiceSurface` mapped
type. The `window` and `boardVars` entries use loaders that select `appWindow` and `boardVarsAdmin`.
The `downloads` entry is the only current descriptor with `initialize: (downloads) =>
downloads.init()`.

The same descriptor list should drive the runtime property definitions on the internal `App`
object. The implementation can keep a typed service-value record and define the service getters
from the descriptors during construction; the public `app` value is typed as the fixed App API
plus the mapped `AppServiceSurface`. This removes one manually maintained backing-field/getter
pair per service while preserving the current fixed methods and lifecycle members.

`src/renderer/api/types/app.d.ts` must remain unchanged and must not import the registry. It is a
leaf declaration copied as a flat sibling set into `assets/editor-types/`; the runtime registry
imports `IApp` type-only instead. `AppServiceKey` excludes the fixed `IApp` members that are not
populated by `initServices()`. The remaining service keys form a descriptor union whose loaders
are checked against `IApp[key]`, and an `AssertNever<Exclude<...>>` check makes a service member
missing from the table a type error. The existing member-level JSDoc therefore remains intact.

`AppWrapper` should define the service properties from the same descriptors at runtime, delegating
to `app[key]`, while retaining its explicit special handling for `pages`, `events`, `call`,
`fetch`, `openRawLink`, and `runAsync`. Its exported type should be the fixed wrapper surface
intersected with `AppServiceSurface`, so `ScriptContext` still sees typed service properties.
This is the invasive portion: TypeScript does not create class members merely from
`Object.defineProperty`, so the class/runtime shape and exported type need to be separated or
intersected carefully.

The result is two edits when adding a service: the `IApp` member and the descriptor row. Both are
compile-time enforced; the runtime hole is closed by the named `console.error` check. The fixed
AppWrapper assertion remains a third-place guard only for non-service members, so it does not
duplicate the descriptor service exhaustiveness check.

### Before → after: ordinary service (`editors`)

Current code in `src/renderer/api/app.ts:153-170`:

```ts
const [{ settings }, { editors }, { recent }, { fs }, win, ...] = await Promise.all([
    import("./settings"),
    import("./editors"),
    import("./recent"),
    import("./fs"),
    import("./window"),
    // ...more imports
]);
this._settings = settings;
this._editors = editors;
this._recent = recent;
// ...more assignments
```

Planned shape (illustrative; the implementation must add the failure settlement and diagnostics
described below):

```ts
export const appServiceDescriptors = [
    {
        key: "editors",
        load: async (): Promise<IEditorRegistry> => (await import("./editors")).editors,
    },
    // ...the other App-service descriptors
] as const satisfies readonly AppServiceDescriptor<string, unknown>[];

// initServices(): load every descriptor, store each successful value, and define the same
// descriptor-backed getter on App. The key and value types come from this list.
```

Adding another ordinary service means adding its `IApp` member and descriptor row; the table
exhaustiveness check requires the row, and the service map, App runtime getter, and wrapper
delegation consume it.

### Before → after: awkward named sub-export (`window`)

Current code in `src/renderer/api/app.ts:158,172`:

```ts
const [..., win, ...] = await Promise.all([
    // ...
    import("./window"),
    // ...
]);
this._window = win.appWindow;
```

Planned descriptor row:

```ts
{
    key: "window",
    load: async (): Promise<Window> => (await import("./window")).appWindow,
},
```

The selector is part of the one registration entry, so the table does not assign the module
namespace to `app.window`. `boardVars` uses the same selector pattern for `boardVarsAdmin`.

The other awkward case is represented explicitly rather than hidden: `downloads` has a loader plus
an `initialize` hook for `init()`, and `ui-preferences` remains a post-load `await load()` operation
because it is not a public member. The three background hydrations remain explicit for the reasons
above.

### Runtime gap and failure policy

Replace the all-or-nothing `Promise.all` registration path with per-descriptor settlement. For each
descriptor, load the value, assign it before running its optional `initialize` hook, and record the
descriptor key plus phase (`load` or `initialize`) if either step rejects. Use the repository's
`errMessage()` helper when converting an `unknown` rejection to diagnostic text.

At the end of `initServices()`, inspect every descriptor key in the typed service-value record.
Report every missing key with an always-on `console.error`, including the public name (for example,
`[App] Service "downloads" failed to initialize`) and the original failure when available. Do not
throw from this check and do not use a toast: throwing is what currently prevents the renderer from
mounting. The reason is not that `ui` itself may have failed: `ui.notify` writes directly to the
`alertsBarModel` singleton imported from `uikit`, and alerts raised before mount are retained and
rendered when the UI mounts. The stronger reason is that a user cannot act on a failed service, so
a startup toast for an unactionable failure is noise. Always-on logging is required because the
historical `boardVars` failure shipped to users; a dev-only assertion would leave the release gap.

This policy is intentionally “continue and name the failure” for a service that can legitimately
be unavailable. A failed `downloads.init()` leaves the assigned singleton available in its default
state and reports the failed initialization; a failed optional module import leaves that member
absent and reports its exact key immediately. The remaining descriptors and the rest of the
bootstrap are allowed to continue, so one non-foundational service does not make `initServices()`
itself reject or turn the window blank.

There is a verified boundary: `initPages()` later imports and waits on `fs` (`app.ts:211-215`),
and `initEvents()` later waits on and reads `settings` (`app.ts:276-279`). If either foundational
module is deliberately made unavailable, later bootstrap code can still fail because those are
hard dependencies; making the entire renderer mount a degraded shell would require a separate
bootstrap/error-screen design. The acceptance failure injection should therefore use a
non-foundational service or the `downloads.init()` hook to verify the requested non-blank behavior,
and should separately confirm that a foundational failure is named at the first diagnostic point.

The three post-tuple background calls should gain key-specific rejection logging rather than
unhandled promises. They remain non-blocking and do not participate in the service-member check.

### Type safety and `AppWrapper`

The descriptor list can keep the public surface honest at compile time in ways the current code
cannot:

- a descriptor key is checked against the service map and cannot silently become an untyped string;
- each loader's explicitly declared public return type catches selecting the wrong export or
  returning a module namespace instead of a service;
- an `initialize` callback is typed to its service, so only `downloads` can call `init()` under the
  current declarations;
- the table's exhaustive key check requires every `IApp` service member to have a row, while the
  wrapper service type and runtime delegation consume the table; adding a service therefore
  takes two edits, both enforced at compile time; and
- the runtime end check catches a loader that compiles but returns `undefined`, rejects, or fails to
  assign a value—precisely the case the current `Exclude<keyof IApp, keyof AppWrapper>` assertion
  cannot observe.

The existing `AppWrapper` member-name assertion cannot survive unchanged if service getters become
descriptor-defined: TypeScript will not see runtime-defined properties on the class declaration.
Replace it with a narrower assertion for the fixed, hand-written members (excluding the descriptor
key union), while the descriptor-derived wrapper type covers service names. Do not retain the old
full assertion as a second service mechanism. The fixed assertion still protects `pages`, `events`,
`call`, `fetch`, `openRawLink`, and `runAsync`, whose wrapper behavior is intentionally not a simple
service delegation.

The current `AiRoot` object-model surface is a separate explicit list and getter set at
`src/renderer/scripting/ai-vision/root.ts:56-83,198-260`. This task's two-edit guarantee is for
the script-facing `IApp`/`AppWrapper` surface named by the epic; both edits are compile-time
checked. If a new service is also required
through `app.call(...)`, the implementation must add the corresponding AiRoot descriptor/getter as
a separately scoped object-model exposure; it cannot be claimed to be derived from `IApp` today.

### Fallback if the table refactor is too invasive

The documented fallback is the epic's “loud check” option: keep the individually
typed getters in `app.ts`, the explicit public member in `IApp`, and the explicit wrapper getter,
but add one shared expected-service list/check at the end of `initServices()` and make every load
failure report its named key without throwing. This is safer to land if the dynamic wrapper typing
or central `App` class is judged too risky, and it closes the shipped `undefined` runtime gap.

It is a fallback, not the recommendation: it still requires the three explicit type/runtime
surfaces for each new service, so it does not fully deliver the central-table goal. It must
not be left as an unacknowledged “table” that covers only the tuple while leaving `IApp` and
`AppWrapper` manual.

### Files and implementation steps

1. Add `src/renderer/api/app-service-registry.ts` with the typed descriptor contract, all 12
   current service rows, the `AppServiceSurface` type, and selectors/initializers for `window`,
   `boardVars`, and `downloads`.
2. Refactor `src/renderer/api/app.ts:31-105,149-200` to consume the descriptor list, define the
   service-backed runtime properties, preserve the explicit `loadUiPreferences()` step, and keep
   the three background hydrations outside the descriptor loop. Replace `Promise.all` failure
   propagation with per-service settlement and the final always-on named check.
3. Leave `src/renderer/api/types/app.d.ts:26-70` unchanged: it is the flat-copy leaf declaration
   and the registry imports it type-only. Do not update `assets/editor-types/` or `_imports.txt`.
4. Refactor `src/renderer/scripting/api-wrapper/AppWrapper.ts:65-196` to expose all descriptor
   services through the shared typed surface and runtime delegation, retain its special wrappers,
   and narrow the compile-time assertion to non-descriptor members.
5. Keep `src/renderer/scripting/ScriptContext.ts:54-76` behavior unchanged and verify its
   `new AppWrapper(...)` type still exposes every descriptor service.
6. If the service is expected on the AiVision `app.call()` root, handle the separate explicit
   `src/renderer/scripting/ai-vision/root.ts` exposure in the implementation scope; otherwise record
   it as deliberately out of scope rather than implying the table covers it.
7. Run the app manually through the real script path and perform the acceptance observations below.
   Do not add Vitest, unit tests, a smoke-test harness, or any test file.

## Concerns

- **Central typing is the main risk.** The current wrapper deliberately has richer concrete types,
  so the implementation must not force `implements IApp` or weaken `pages`/`events` to make the
  table compile. Use an explicit fixed-wrapper type plus the mapped service surface.
- **Documentation is part of the type surface.** A mapped type can make Monaco member JSDoc less
  direct. Verify the generated/editor-facing declarations and preserve the current service
  descriptions before accepting the refactor.
- **Bootstrap dependencies are not all optional.** The source proves that `fs` and `settings` are
  consumed later by bootstrap. The non-throw policy prevents `initServices()` itself from blanking
  the app, but it cannot make a foundational module usable after a deliberately broken import.
- **Background failures are currently unhandled.** They are intentionally outside the table, but
  their rejection logging should be named so the new startup diagnostics do not leave three silent
  promise failures.
- **`_servicesInitialized` is set before current work begins (`app.ts:150-151`).** The refactor
  must choose and document whether the guard becomes a promise/once guard or remains a completed
  flag after the settlement pass; it must not make a second caller race into partially defined
  service getters.
- **The task is intentionally not a test-runner task.** Manual runtime observations and the
  existing QA surface set are the verification mechanism under EPIC-105 D7/D8.

## Acceptance Criteria

These are observations made by running the application, not claims satisfied by compilation alone:

- After a normal restart, a script executed through the real `ScriptContext` → `AppWrapper` path
  can read every current descriptor member (`settings`, `editors`, `recent`, `fs`, `window`,
  `shell`, `ui`, `downloads`, `menuFolders`, `proc`, `boards`, and `boardVars`) without receiving
  `undefined`; `window` is the `appWindow` object and `boardVars` is the admin API object.
- A temporary new no-special-behaviour service can be added by adding its `IApp` member and one
  descriptor entry; omitting the row is a type error, and after rebuilding its script-facing type,
  singleton value, and wrapper property are present without a tuple assignment or manual getter.
- The `downloads` descriptor assigns the singleton before `init()` runs. If `init()` is temporarily
  made to reject, the app still reaches the mounted window, the console contains a named
  `downloads` initialization failure, and the script does not encounter a silent missing member.
- If one non-foundational descriptor loader is temporarily made to reject, the app does not become
  a blank window at `initServices()`; the console contains the exact public member name and failure
  phase, and the other services remain script-accessible.
- If a foundational `settings` or `fs` loader is deliberately broken, the first diagnostic names
  that service before any later bootstrap failure; the result is documented as the known hard
  dependency rather than an unexplained `undefined` at first script use.
- The three background hydrations remain non-blocking: a temporary failure in published boards,
  board-install-registry, or registered tools produces named diagnostic output but does not delay
  the first window mount.
- A script can still use the special wrapper behaviours: `pages` returns page wrappers, `events`
  releases subscriptions, `call` validates its options, and `fetch`, `openRawLink`, and `runAsync`
  retain their current behavior.
- The existing compile-time check reports a missing fixed wrapper member, while the registry's
  exhaustive table check reports a missing descriptor service row; these are separate checks and
  neither silently duplicates the other.
- No Vitest dependency, test runner, unit test, or test harness is added, and no user-visible
  service behavior changes apart from immediate named diagnostics for failures.

## Files that need no changes

- `src/renderer.ts` — source evidence only for the current rejection/mount behavior; the recommended
  policy is implemented inside `initServices()` and does not alter bootstrap order.
- `src/renderer/scripting/ScriptContext.ts` — construction path remains `new AppWrapper(...)`; it
  is a verification point unless the chosen TypeScript surface requires an import-type adjustment.
- `src/renderer/scripting/ai-vision/root.ts` — no change for the script-only `IApp` service task;
  change only if the new service is explicitly added to the separate `app.call()` object-model
  surface.
- `src/renderer/api/pages/**` — `pages` remains initialized by `initPages()` after the service
  check and is not a descriptor service.
- `doc/active-work.md` and `doc/epics/EPIC-105.md` — the user explicitly forbids modifying either
  file during this investigation.
- Any `src/` test file or test configuration — no test framework or harness is permitted by D7.

## Files Changed Summary

| File | Planned implementation change | Changed by this planning task |
|---|---|---|
| `src/renderer/api/app-service-registry.ts` | New typed descriptor table, public service surface, selectors, and initializer metadata | Yes |
| `src/renderer/api/app.ts` | Consume descriptors, settle failures per service, assign dynamic service values, and report missing members | Yes |
| `src/renderer/api/types/app.d.ts` | No change; remains the flat-copy leaf imported type-only by the registry | No |
| `src/renderer/scripting/api-wrapper/AppWrapper.ts` | Delegate descriptor services from the shared surface and retain special wrappers/fixed-member check | Yes |
| `src/renderer/scripting/ScriptContext.ts` | No intended runtime change; type-only adjustment only if required by the wrapper surface | No |
| `src/renderer/scripting/ai-vision/root.ts` | No change unless the new service is intentionally exposed through `app.call()` | No |
| `doc/tasks/US-1462-app-service-registration/README.md` | Investigation, decision, implementation plan, concerns, and observable acceptance criteria | Yes |
| `doc/active-work.md` | Normally a dashboard link, explicitly forbidden for this request | No |
| `doc/epics/EPIC-105.md` | Normally an epic-table/link update, explicitly forbidden for this request | No |
