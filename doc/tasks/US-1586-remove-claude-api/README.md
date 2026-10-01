# US-1586: Remove the Claude API scripting feature

## Goal

Remove the in-app Claude API client exposed to scripts as `ai`, including its runtime, types, dependency, generated editor declarations, and user-facing documentation. Keep Persephone's MCP server and its AiVision integration intact: those are the supported path for external agents to operate the standalone viewer.

## Background

`src/renderer/scripting/api-wrapper/AiNamespace.ts` exports `createAiNamespace()`, which returns `ClaudeSession` from `src/renderer/scripting/api-wrapper/ClaudeSession.ts`. `ScriptContext` constructs and exposes that namespace; `ScriptRunnerBase` adds it to top-level script locals, and `library-require.ts` injects it into script-library modules. The MCP `script.execute` descriptor in `src/renderer/scripting/ai-vision/root.ts` calls the same `ScriptRunner.runWithCapture()` path, so removing the namespace from the shared context also removes it from MCP-run scripts. Its MCP help strings also advertise the script globals and must drop `ai`; the descriptor and runner stay. `app.runAsync()` worker code is a separate worker function context and does not inject this script global.

The Claude session accepts its API key in the constructor (`ClaudeSessionConfig.apiKey`) and loads `@anthropic-ai/sdk` on first construction. The code and settings catalog contain no dedicated Claude API key/model setting or Settings UI; there is no app-owned saved key to migrate. Keep any `ai` identifiers referring to the `ai-vision` package, MCP protocol, or MCP agent guides. In particular, do not remove `src/renderer/scripting/ai-vision/`, `src/main/mcp/`, `assets/guides/agents/`, `assets/guides/scripting/api/page.md`'s AiVision documentation, or `ai-vision` from dependencies.

Once the `ai` local is no longer injected, an existing script that evaluates `ai` will throw `ReferenceError: ai is not defined`. This is the intended clear failure mode; no compatibility shim or app-wide migration is needed.

## Implementation Plan

- [x] Remove the script-facing Claude namespace and implementation: delete `src/renderer/scripting/api-wrapper/AiNamespace.ts` and `src/renderer/scripting/api-wrapper/ClaudeSession.ts`; remove the namespace import/property from `src/renderer/scripting/ScriptContext.ts`; remove `ai=this.ai` from `SCRIPT_PREFIX` in `src/renderer/scripting/ScriptRunnerBase.ts`; remove `ai=__ctx?.ai` from `MODULE_CONTEXT_PREFIX` in `src/renderer/scripting/library-require.ts`. This shared `ScriptContext` path covers ordinary, autoload/library, and MCP-captured scripts.
- [x] Remove obsolete script API types: delete `src/renderer/api/types/ai.d.ts`; remove its `IAiNamespace` import, `ai` declaration, and Claude example from `src/renderer/api/types/index.d.ts`. `vite.renderer.config.ts` has an `editor-types` Vite plugin that copies every declaration from `src/renderer/api/types/` to `assets/editor-types/` and regenerates `assets/editor-types/_imports.txt`; remove the checked-in generated `assets/editor-types/ai.d.ts` and its corresponding `ai` import/declaration/example in `assets/editor-types/index.d.ts` so the output matches its source, then let the plugin refresh `_imports.txt` without `ai.d.ts`.
- [x] Remove `@anthropic-ai/sdk` from `package.json` and regenerate/update `package-lock.json` to drop that package and dependencies that become unused. Preserve `ai-vision` and the Vite `noExternal: ["ai-vision"]` build rule in `scripts/dev.mjs` and `scripts/build-prod.mjs`; these are unrelated to the removed SDK.
- [x] Remove Claude API documentation: delete `assets/guides/scripting/api/ai.md`; remove the `ai` global from the summary, intro, and API list in `assets/guides/scripting/api/index.md`; remove the Claude namespace section from `assets/guides/scripting/index.md`; remove the `AI scripting` listing from `assets/guides/index.md` while keeping its separate MCP entry. Leave MCP / external-agent documentation intact.
- [x] Update developer references: in `doc/architecture/scripting.md`, remove the Claude namespace from the architecture diagram, `ai` API section, injection examples, context construction description, and any global lists; in `doc/architecture/overview.md`, remove `ai` from the scripting-system globals summary; in `doc/architecture/key-files.md`, remove the `Script ai namespace` and `ClaudeSession` index rows; in `doc/agents-common.md`, change the Script Context heading/example to list only surviving globals and scrub only the in-app Claude client references. `AGENTS.md` and `CLAUDE.md` need no change: neither has a script-global list, and `CLAUDE.md` imports `doc/agents-common.md`. Preserve references to Claude as an external MCP client and AI agents using MCP.
- [x] Remove the old Claude chat proposal from the ideas backlog: remove the `EPIC-014: Claude AI Chat Panel` entry in `doc/tasks/backlog.md`, which proposes adding a Persephone app-level chat feature. Keep `doc/epics/EPIC-014.md` as historical project documentation, along with completed task records and other history.
- [x] Add a user-facing 5.0.7 note in `assets/guides/whats-new.md` under `## Version 5.0.7 (Upcoming)` describing removal of the script-level Claude API integration and directing external-agent use to MCP. In the two historical passages that link to `./scripting/api/ai.md`, preserve the historical text and remove only the now-dangling links. Leave the historical prose mention of the `ai` namespace unchanged. Do not edit release notes for earlier versions.
- [x] Review `src/renderer/uikit/CategoryList/CategoryList.story.ts`: its `anthropic.com` hostname and count are sample category data, not an API client reference; leave them unless inspection during implementation establishes a product dependency.
- [x] Search for remaining references to `ClaudeSession`, `@anthropic-ai/sdk`, `ai.ClaudeSession`, and the script-context `ai` local. Remove any remaining Claude-client-only imports or docs, while preserving MCP/AiVision names, protocol messages, dependencies, and agent guides. Final-grep `assets/guides/` for links to `api/ai.md` (including `assets/guides/scripting/index.md` and historical `assets/guides/whats-new.md`) and remove dangling links while preserving historical prose. No Anthropic SDK-specific Vite external/chunk configuration appears in the renderer or build scripts; preserve the separate `ai-vision` bundling configuration.

Representative injection change (the library-module prefix follows the same removal):

```diff
- "var app=this.app,page=this.page,io=this.io,ai=this.ai"
+ "var app=this.app,page=this.page,io=this.io"
```

The generated editor global changes in parallel:

```diff
- import type { IAiNamespace } from "./ai";
...
- const ai: IAiNamespace;
```

## Concerns / Open Questions

- **Saved API keys:** No application setting stores the Claude API key; `apiKey` is constructor input supplied by each script. Therefore there is no settings key or upgrade cleanup migration to implement. A user may have put a key in their own script or other general-purpose storage, which this task does not inspect or rewrite.
- **Existing scripts:** Scripts that refer to `ai` will fail with `ReferenceError: ai is not defined` after removal. This is an intentional API removal, and should be stated in the 5.0.7 note if space permits.
- **Scope distinction:** `ai-vision`, MCP, and their references to `ai` remain. The name match in `CategoryList.story.ts` is incidental fixture data, not Claude integration.
- **Editor declarations:** `assets/editor-types/*.d.ts` are copied from `src/renderer/api/types/*.d.ts` by the `editor-types` plugin in `vite.renderer.config.ts`. Keep the checked-in copies synchronized with that source after removing `ai.d.ts`.
- **Backlog history:** `EPIC-014` is retained under `doc/epics/` as historical context; the proposal to create the Claude chat panel is removed from the active ideas backlog because it conflicts with the product direction.

## Acceptance Criteria

- [x] No script-context `ai` namespace or `ClaudeSession` implementation remains, and references from top-level scripts, library modules, autoload, and MCP script execution are removed through the shared context path.
- [x] Existing user scripts that reference `ai` receive the documented `ReferenceError: ai is not defined`.
- [x] `@anthropic-ai/sdk` is absent from the app dependency manifest and lockfile; the `ai-vision` runtime/build setup and MCP server remain present.
- [x] Claude-specific API declarations and guide pages/sections are removed from both source and generated editor-type documentation.
- [x] Architecture overview and scripting docs, key-file index, common agent guidance, guide index, backlog, MCP script help, and upcoming 5.0.7 notes reflect the removal without rewriting older release history or damaging MCP/AiVision documentation. Root `AGENTS.md` and `CLAUDE.md` remain unchanged.
- [x] No dedicated Claude setting or upgrade cleanup is introduced because the API key was never stored in an app-managed Claude setting.

## Files Changed Summary

| File/path | Planned change |
| --- | --- |
| `src/renderer/scripting/api-wrapper/AiNamespace.ts` | Delete Claude namespace factory |
| `src/renderer/scripting/api-wrapper/ClaudeSession.ts` | Delete Anthropic SDK client |
| `src/renderer/scripting/ScriptContext.ts` | Remove Claude namespace import/property |
| `src/renderer/scripting/ScriptRunnerBase.ts` | Stop injecting `ai` into top-level scripts |
| `src/renderer/scripting/library-require.ts` | Stop injecting `ai` into script-library modules |
| `src/renderer/api/types/ai.d.ts` | Delete Claude API declarations |
| `src/renderer/api/types/index.d.ts` | Remove `ai` global type |
| `assets/editor-types/ai.d.ts` | Delete generated Claude declarations |
| `assets/editor-types/index.d.ts` | Remove generated `ai` global type |
| `assets/editor-types/_imports.txt` | Regenerate through the Vite plugin after removing `ai.d.ts` |
| `vite.renderer.config.ts` | Verify copy behavior; no change expected |
| `package.json`, `package-lock.json` | Remove Anthropic SDK and now-unused transitive packages |
| `scripts/dev.mjs`, `scripts/build-prod.mjs` | Preserve `ai-vision` bundling; no change expected |
| `src/renderer/scripting/ai-vision/root.ts` | Remove `ai` from the `SCRIPT_HELP` and `ROOT_OVERVIEW` globals lists; descriptor and runner stay |
| `assets/guides/scripting/api/ai.md` | Delete Claude API reference |
| `assets/guides/scripting/api/index.md`, `assets/guides/scripting/index.md` | Remove script-level Claude references |
| `assets/guides/index.md` | Remove the verified `AI scripting` listing; keep the separate MCP integration listing |
| `assets/guides/whats-new.md` | Add planned 5.0.7 removal note; remove only links to the deleted API page from historical entries |
| `assets/guides/scripting/index.md` | Remove Claude scripting section/link |
| `doc/architecture/scripting.md`, `doc/architecture/overview.md`, `doc/architecture/key-files.md`, `doc/agents-common.md` | Remove in-app Claude API references and script-global mentions; preserve MCP/AiVision context |
| `AGENTS.md`, `CLAUDE.md` | No change; neither contains a script-global list |
| `doc/tasks/backlog.md` | Remove the EPIC-014 Claude chat proposal; retain history in `doc/epics/EPIC-014.md` |
| `src/renderer/uikit/CategoryList/CategoryList.story.ts` | No change expected; `anthropic.com` is incidental fixture data |
| `src/renderer/scripting/ai-vision/`, `src/main/mcp/`, `assets/guides/agents/`, `ai-vision` dependency | No changes; these are the retained MCP/AiVision integration |
