# US-1744: Monaco project TypeScript support

## Summary

Provide project-aware TypeScript IntelliSense when a TypeScript file belongs to a folder with a
`tsconfig.json`. The need comes from UI Constructor EPIC-005 and is split from US-1743 because it is
app-wide Monaco behavior, independent of the board bridge.

## Why

UI Constructor generates form units that extend sibling designer units and use project declarations.
Today Persephone's shared Monaco TypeScript setup supplies editor/library types and disables
diagnostics, but does not represent those project files as a TypeScript project. Without file-backed
model URIs, relative imports cannot resolve even when sibling content is otherwise available.

## What is needed

When a file under a folder containing `tsconfig.json` is open in Monaco, provide project-aware
completion and import resolution for the configured project files, including units, declarations,
and imported JSON files. Follow project file changes while the relevant Monaco models are open.

The requesting UI Builder project expects completion such as `this.btnSave.` in
`forms/MainForm.ts`, resolving generated sibling designer units, `units/*.ts`, `types/*.d.ts`, and
the project's JSON imports.

## Technical Approach

To be written by the investigation.

## Acceptance Criteria

- [ ] A TypeScript file under a folder with `tsconfig.json` receives project-aware completion and
  resolves relative TypeScript and declaration imports.
- [ ] Files included by the project's configuration and JSON modules needed by imports are
  represented with stable file-based URIs.
- [ ] Changes to relevant project files update IntelliSense while the project is in use.
- [ ] Multiple open projects and duplicate open models do not conflict or register one URI as both
  an open model and an extra library.
- [ ] The design accounts for rename/Save As and model disposal without leaking registrations.
- [ ] Any UI styling uses theme tokens; errors use `errMessage`. This task does not add unit tests or
  a test harness.

## Notes

### Verified findings

- `src/renderer/editors/shared/MonacoEditorHostView.ts:39-42` creates its text model with
  `monaco.editor.createModel(value, language)` and no URI. Monaco assigns an `inmemory://model/N`
  URI to a model created without a URI; relative imports such as `./GalleryForm.designer` therefore
  have no project-file base and cannot resolve from that model. A project `.ts` model needs
  `monaco.Uri.file(filePath)`.
- Monaco's model service throws `ModelService: Cannot add model because it already exists!` if
  `createModel()` is called with a URI already owned by another model (`node_modules/monaco-editor/esm/vs/editor/common/services/modelService.js`, duplicate-URI check). The investigation must define duplicate-URI handling for one file opened twice, compare/grouped views, Save As and rename. It must also ensure a file URI is not registered simultaneously as an open model and an `addExtraLib()` entry.
- `src/renderer/api/setup/configure-monaco.ts` calls `typescriptDefaults.setCompilerOptions()` on
  Monaco's shared TypeScript defaults. Those compiler options are process-wide, so per-project
  `tsconfig.json` options cannot simply be swapped as if they were isolated per model.
- `src/renderer/api/setup/library-intellisense.ts` shows the current `addExtraLib()` pattern: read
  text through the renderer `fs` API (the app-facing surface is `app.fs`) and register it at a
  stable file URL, retaining each returned disposable for replacement. `app.fs` itself exposes
  file I/O rather than a `watch()` method; file-change notifications use
  `src/renderer/api/path-watch.ts`'s `subscribe(path, callback, options)` API, whose returned
  function releases the subscription. The investigation should use those existing surfaces for
  reads and change tracking.
- The UI Constructor examples use flat `examples/hello/tsconfig.json` and
  `examples/gallery/tsconfig.json` files: neither has `extends` or `paths`; both specify
  `"types": []`, `"resolveJsonModule": true`, and include `forms/**/*.ts`, `units/**/*.ts`, and
  `types/**/*.d.ts`.
- `examples/hello/types/uc.d.ts` and `examples/gallery/types/uc.d.ts` declare `"uc"` as an ambient
  `declare module "uc"`. Type support must include these declaration files for imports such as
  `import { Form } from "uc"`.
- JSON files are part of the actual project import graph: generated designer units import
  `./<Form>.ucform.json`, and `examples/gallery/forms/GalleryForm.ts` imports
  `../themes/dark.uctheme.json` and `../themes/light.uctheme.json`. The project support must register
  the JSON files needed by these imports, not only `.ts` and `.d.ts` sources.
- UI Constructor EPIC-005 requires completion for project units such as `forms/MainForm.ts` and its
  generated `forms/MainForm.designer.ts`; the project architecture describes these generated
  designer base units and project `types/` declarations.

### Scope

- US-1743 covers only board open-at-line and the reusable Run Browser page.
- Board diagnostics markers (US-1743 need 4) remain a later follow-up without a task document.
- Do not modify `C:/projects/ui-constructor`; its EPIC and architecture files are read-only context.
