# Persephone Project Guidelines

## English Correction (MANDATORY)

The user is learning English. For EVERY user message, BEFORE responding to the task:
1. Check spelling, grammar, tenses (have/had, do/did), and sentence structure ("I can ask?" → "Can I ask?")
2. Print the corrected sentence with **bold** on every corrected word/part
3. Do NOT explain corrections — just show the fixed sentence
4. Do NOT beautify or rephrase — only fix actual errors
5. If the message has no mistakes — print a 👍 emoji
6. Then proceed with the task as usual

## Quick Start for Claude

1. **Read this file completely** - essential context for all tasks
2. **For new features:** Read [/doc/architecture/overview.md](doc/architecture/overview.md)
3. **Check active tasks:** Review [/doc/tasks/active.md](doc/tasks/active.md)
4. **Follow standards:** Use [/doc/standards/coding-style.md](doc/standards/coding-style.md) when writing code

## Task Workflow (IMPORTANT)

### Finding work

When user says "let's work on tasks" or similar:

1. **Check active tasks:** Read [/doc/tasks/active.md](doc/tasks/active.md) for "In Progress" or "Planned" tasks
2. **If no active task:** Check [/doc/epics/active.md](doc/epics/active.md) for active epics that need next tasks
3. **If nothing found:** Ask the user what to work on
4. **Ask before starting**: Say "The next task is '[Task Title]'. Do you want to proceed with this task, or would you like to reprioritize and pick a different one?"
5. Wait for user confirmation

### Auto-task creation

If the user gives work without a defined task (e.g., "fix this bug", "add this feature"):
- **Small work** (single fix, quick change): Proceed without creating a task document. Create an entry in `active.md` with a generated US-XXX ID and brief title.
- **Large work** (multiple files, many changes): Create a task folder with README.md to track context. This helps when running `/project:review`, `/project:document`, and `/project:userdoc` at the end.
- **Epic linking**: If an active epic exists and the work relates to it, suggest linking: "This seems related to EPIC-XXX. Should I link this task to it?"
- **Before committing**: If no task entry exists yet, create one in `active.md` so the work is tracked.

### Creating a new task ("Let's create a task for ...")

When the user says **"let's create a task for [description]"** (or similar), follow this workflow. The goal is to produce a thorough task document **before** any implementation begins, because:
- The codebase is large — the agent cannot hold all relevant code in context during implementation
- A detailed plan with resolved concerns lets the agent implement correctly even after context compaction

**Steps:**

1. **Create task folder and README.md** — `doc/tasks/US-XXX-short-name/README.md`
2. **Deep investigation** — Read all relevant source files, types, existing patterns, and similar implementations in the codebase. Be thorough: check renderers, models, script API wrappers, MCP handlers, type definitions, and tests.
3. **Write the task document** with these sections:
   - **Goal** — What this task achieves (1-2 sentences)
   - **Background** — Relevant existing code, patterns to follow, similar implementations to reference
   - **Implementation plan** — Step-by-step checklist of what to create/modify, with file paths and key details. Each step should have enough detail that the agent can implement it without re-reading the entire codebase.
   - **Concerns / Open questions** — Anything ambiguous, risky, or needing user input. Flag design decisions that could go either way.
   - **Acceptance criteria** — How to verify the task is complete
4. **Add entry to `active.md`** with status "Planned"
5. **Link to epic** if applicable (update epic's task table)
6. **Present the document to the user** — Summarize key points and highlight concerns
7. **Wait for user review** — Do NOT start implementation. The user will review, ask questions, request changes, and eventually say "let's implement"

**Important:** Do not rush this phase. Spend time reading code thoroughly. Missing a pattern or dependency during investigation leads to rework during implementation.

### Preparing a task document for context compaction

Complex tasks often consume most of the context window during investigation, document creation, and concern resolution — leaving little room for implementation. When the user says **"prepare document for compact"**, **"I need to compact before implementation"**, or similar:

1. **Re-read the task document** from start to finish
2. **Make it fully self-contained** — an agent starting fresh after compaction must understand everything without access to the conversation history:
   - Replace vague references with exact file paths and method names
   - Include current code snippets that will be changed (before → after)
   - Spell out the algorithm logic step by step — no "see above" or "as discussed"
   - List all edge cases explicitly
   - State which files need NO changes (so the agent doesn't waste time investigating)
   - Add a **Files Changed summary table** at the bottom
3. **Resolve any remaining ambiguity** — if a concern was discussed and resolved in conversation but the document still says "TBD" or "open question", update it with the resolution
4. **Remove conversational artifacts** — delete thinking-out-loud notes like "Wait —", "Actually...", "Hmm" that made sense during investigation but confuse a fresh reader

The goal: after `/compact`, the agent reads the task README.md and can implement correctly without asking the user to repeat decisions already made.

### When starting a new task (not already in progress):
1. **Review first, don't implement immediately**
2. Read the task documentation (if it exists) and provide a summary of:
   - What we're going to do (main points)
   - Key files involved
   - Any concerns or decisions needed
3. **Wait for user approval** before implementing
4. User will say either:
   - "Let's implement it fully" - proceed with full implementation
   - "Let's implement subtask X" - implement only that part
   - Discuss concerns first

### During implementation:
- Update task progress checklist
- Ask for clarification when uncertain
- Do NOT commit automatically - wait for user to request commits

### Completing a task (user-initiated):

**Do NOT run completion steps automatically after implementation.** After implementation, the user will test the changes manually. During testing, bugs or adjustments may appear that require additional code changes. Only when the user explicitly says **"let's complete the task"** (or similar) should you proceed with the completion steps below.

1. Verify all acceptance criteria are met
2. **Run `/project:review`** — validates code against architecture docs, reports concerns
3. **Run `/project:document`** — updates developer docs in `/doc/` (architecture, standards, CLAUDE.md)
4. **Run `/project:userdoc`** — updates user docs in `/docs/` (guides, API reference, what's new)
5. Add task to the top of [/doc/tasks/completed.md](doc/tasks/completed.md) (include Epic column if linked)
6. Update the linked epic's task table (if applicable)
7. **Task folder cleanup** (if one exists):
   - If the task is part of an active epic — **keep the folder** (do not ask, do not delete). Task documents are useful for reference while the epic is in progress.
   - If the task is standalone (no epic) or the epic is completed — **ask user for confirmation** before deleting.

**Steps 2-4 are mandatory.** Only skip if the user explicitly says to skip them.

## Release Workflow

When user says **"let's publish new build"** (or similar), follow [/doc/standards/release-process.md](doc/standards/release-process.md):

1. Commit any uncommitted changes to the working branch
2. Merge working branch into `main`
3. Update `docs/whats-new.md` — mark current version as released, add next upcoming section
4. Commit, tag, and push `main` with the version tag
5. **Wait** for user to confirm the GitHub build is published
6. Bump `package.json` version, create new `upcoming-vN` branch, commit and push

## Documentation Map

| Need to...                    | Read...                                                |
|-------------------------------|--------------------------------------------------------|
| Understand architecture       | [/doc/architecture/overview.md](doc/architecture/overview.md) |
| Learn folder structure        | [/doc/architecture/folder-structure.md](doc/architecture/folder-structure.md) |
| Add a new editor              | [/doc/standards/editor-guide.md](doc/standards/editor-guide.md) |
| Modify the browser editor     | [/doc/architecture/browser-editor.md](doc/architecture/browser-editor.md) |
| Add a UI component            | [/doc/standards/component-guide.md](doc/standards/component-guide.md) |
| Work with context menus       | [/doc/architecture/context-menu.md](doc/architecture/context-menu.md) |
| Build complex components      | [/doc/standards/model-view-pattern.md](doc/standards/model-view-pattern.md) |
| Understand state management   | [/doc/architecture/state-management.md](doc/architecture/state-management.md) |
| Work with pages/tabs          | [/doc/architecture/pages-architecture.md](doc/architecture/pages-architecture.md) |
| Work with scripting system    | [/doc/architecture/scripting.md](doc/architecture/scripting.md) |
| Check coding style            | [/doc/standards/coding-style.md](doc/standards/coding-style.md) |
| See current tasks             | [/doc/tasks/active.md](doc/tasks/active.md) |
| See active epics              | [/doc/epics/active.md](doc/epics/active.md) |
| See future ideas              | [/doc/tasks/backlog.md](doc/tasks/backlog.md) |
| Publish a new build           | [/doc/standards/release-process.md](doc/standards/release-process.md) |
| Test MCP documentation        | [/qa/README.md](qa/README.md) |
| User documentation            | [/docs/index.md](docs/index.md) |

## Project Overview

Persephone (formerly js-notepad) is a Windows Notepad replacement for developers. Built with Electron and Monaco Editor (VS Code engine), it extends classic notepad with powerful code editing and a JavaScript/TypeScript execution environment.

### Design Philosophy
- **Core First:** Keep core functionality fast and lightweight
- **Extensible:** Editors loaded on-demand via async imports
- **Developer-Focused:** Tools for manipulating and transforming data
- **Container:** Provides UI building blocks; users bring integrations via Node.js/npm

### Key Features
- **Monaco Editor** - Syntax highlighting, IntelliSense, multi-cursor, compare mode
- **Script Executor** - Run JavaScript/TypeScript scripts with `page` object to transform content
- **Grid Editors** - JSON/CSV viewing with sorting, filtering, Excel copy-paste
- **Markdown Preview** - Live rendered preview
- **PDF Viewer** - Integrated pdf.js
- **Rest Client** - HTTP request builder with collections (`.rest.json` files)

## Tech Stack

- **Runtime:** Electron 39 — [Castlabs ECS](https://github.com/castlabs/electron-releases) fork with Widevine DRM support (nodeIntegration: true, contextIsolation: false)
- **Frontend:** React 19 with TypeScript
- **Editor:** Monaco Editor
- **State:** Custom reactive primitives (TOneState, TGlobalState, TComponentState, TModel)
- **Build:** Vite + Electron Forge (dev), electron-builder (production)
- **Styling:** Emotion (CSS-in-JS)

## Commands

```bash
npm start           # Development mode (Electron Forge + Vite HMR)
npm run dist        # Build NSIS installer + ZIP (electron-builder)
npm run dist:publish # Build and publish to GitHub Releases (draft)
npm run lint        # Run ESLint
```

## Folder Structure (Summary)

```
/src
  /main              # Electron main process
  /renderer          # React frontend
    /api             # Object Model — app.settings, app.pages, app.fs, etc.
    /ui              # Application shell — MainPage, tabs, sidebar, dialogs
    /editors         # ALL editors (text, grid, markdown, pdf, compare, notebook)
    /content         # Content delivery — providers, transformers, pipes (EPIC-012)
    /scripting       # Script execution, wrappers, editor facades, worker
    /components      # Reusable UI components
    /core            # State primitives, utilities
    /theme           # Styling
  /ipc               # Inter-process communication
/doc                 # Developer documentation
  /epics             # Epic tracking (big ideas with linked tasks)
/docs                # User documentation
/.claude
  /commands          # Custom commands: /project:review, /project:document
  /agents            # Custom agents: /project:userdoc (Sonnet, isolated context)
```

See [/doc/architecture/folder-structure.md](doc/architecture/folder-structure.md) for complete details.

## Critical Patterns

### 1. Dynamic Imports for Editors
Always use `import()` for editor code to maintain code splitting:
```typescript
// Good
const { PdfViewer } = await import("../pdf/PdfViewer");

// Bad - increases bundle size
import { PdfViewer } from "../pdf/PdfViewer";
```

### 2. Script Context (`page`, `app`, and `io` objects)
Scripts access content via `page`, the application via `app`, and the content pipe system via `io`:
```javascript
const data = JSON.parse(page.content);
page.grouped.content = JSON.stringify(result);
page.grouped.editor = "grid-json";

// Typed editor access via facades
const grid = await page.asGrid();
grid.addRows(5);

// Content pipe API — providers, transformers, events
const pipe = io.createPipe(new io.HttpProvider(url, { headers }));
const text = await pipe.readText();
await app.events.openRawLink.sendAsync(new io.RawLinkEvent(url));
```

### 3. Grouped Pages
- Two tabs can be grouped (side-by-side)
- Accessing `page.grouped` auto-creates a grouped page if none exists
- Script output is written to the grouped page

### 4. State Management
- Object Model APIs in `/src/renderer/api/` (app.settings, app.pages, etc.)
- State primitives in `/src/renderer/core/state/`
- See [state-management.md](doc/architecture/state-management.md)

### 5. Content Delivery Pipeline
Content I/O flows through a 3-layer pipeline (`/src/renderer/content/`):
- **Layer 1 (Parsers):** Raw string → structured link event (`openRawLink` → `openLink`)
- **Layer 2 (Resolvers):** Link event → provider + transformers → content pipe (`openLink` → `openContent`)
- **Layer 3 (Open Handler):** Content pipe → page creation with pipe assigned

Content pipes (`IContentPipe`) compose a provider (data source) with transformers (data effects):
```typescript
// Provider reads/writes raw bytes; transformers process in chain
const pipe = createPipe(new FileProvider(filePath), new ZipTransformer(entry));
const text = await pipe.readText();  // FileProvider → ZipTransformer → decode
```

TextFileIOModel uses dual pipes: primary (source file) + cache (auto-save). Pipe state is serialized in `IPageState.pipe` (`IPipeDescriptor`) for restore across app restarts.

### 6. Event Channels (LIFO)
`EventChannel.sendAsync()` calls subscribers in LIFO order (newest first). This allows late subscribers (like the open handler) to intercept and handle events before earlier subscribers.

## Coding Standards (Quick Reference)

- **TypeScript** for all new code
- **Emotion** for styling (styled components or css prop)
- **Functional components** with hooks
- **Direct imports** preferred over barrel imports (avoid circular deps)
- **Meaningful names** - descriptive, no abbreviations
- **No hardcoded colors** - All colors must come from `import color from "../../theme/color"`. Never use hex codes, `rgb()`/`rgba()`, or named colors directly in styled components or inline styles. If a needed color doesn't exist in `color`, add it to `color.ts` and all theme definitions in `/src/renderer/theme/themes/`.
- **No direct `require("path")`** - Use `file-path` utility (`/src/renderer/core/utils/file-path.ts`) for all path operations. Only `file-path.ts` itself may import `path` directly.
- **No direct `require("fs")`** - Use `app.fs` (`/src/renderer/api/fs.ts`) for file operations. Only `fs.ts` and a few documented exceptions may use `fs` directly (see `coding-style.md`).

See [/doc/standards/coding-style.md](doc/standards/coding-style.md) for complete standards.

## Key Files

| Purpose                  | File                                              |
|--------------------------|---------------------------------------------------|
| App object model         | `/src/renderer/api/app.ts`                        |
| Page/tab management      | `/src/renderer/api/pages/PagesModel.ts`           |
| Well-known pages         | `/src/renderer/api/pages/well-known-pages.ts`     |
| File operations          | `/src/renderer/api/fs.ts`                         |
| Archive I/O (ZIP)        | `/src/renderer/api/archive-service.ts`             |
| Node.js HTTP client      | `/src/renderer/api/node-fetch.ts`                 |
| Path utilities           | `/src/renderer/core/utils/file-path.ts`           |
| App settings             | `/src/renderer/api/settings.ts`                   |
| Event channel system     | `/src/renderer/api/events/EventChannel.ts`        |
| App events namespace     | `/src/renderer/api/events/AppEvents.ts`           |
| Content pipe             | `/src/renderer/content/ContentPipe.ts`            |
| Content pipe registry    | `/src/renderer/content/registry.ts`               |
| File provider            | `/src/renderer/content/providers/FileProvider.ts` |
| Cache file provider      | `/src/renderer/content/providers/CacheFileProvider.ts` |
| Encoding detection       | `/src/renderer/content/encoding.ts`               |
| Link parsers (Layer 1)   | `/src/renderer/content/parsers.ts`                |
| Pipe resolvers (Layer 2) | `/src/renderer/content/resolvers.ts`              |
| Open handler (Layer 3)   | `/src/renderer/content/open-handler.ts`           |
| HTTP provider            | `/src/renderer/content/providers/HttpProvider.ts`  |
| cURL/fetch parser        | `/src/renderer/core/utils/curl-parser.ts`         |
| Open URL dialog          | `/src/renderer/ui/dialogs/OpenUrlDialog.tsx`      |
| Script `io` namespace    | `/src/renderer/scripting/api-wrapper/IoNamespace.ts` |
| Script library service   | `/src/renderer/api/library-service.ts`            |
| Script autoloading       | `/src/renderer/scripting/AutoloadRunner.ts`       |
| Script execution (core)  | `/src/renderer/scripting/ScriptRunnerBase.ts`     |
| Script execution         | `/src/renderer/scripting/ScriptRunner.ts`         |
| TypeScript transpilation | `/src/renderer/scripting/transpile.ts`            |
| Async worker (renderer)  | `/src/renderer/scripting/worker/WorkerRunner.ts`  |
| Async worker (main)      | `/src/main/worker-host.ts`                        |
| Script API types         | `/src/renderer/api/types/*.d.ts`                  |
| Monaco setup             | `/src/renderer/api/setup/configure-monaco.ts`     |
| Editor registry          | `/src/renderer/editors/registry.ts`               |
| Editor registration      | `/src/renderer/editors/register-editors.ts`       |
| Text editor model        | `/src/renderer/editors/text/TextPageModel.ts`     |
| Grid editor              | `/src/renderer/editors/grid/GridViewModel.ts`     |
| Log view editor          | `/src/renderer/editors/log-view/LogViewModel.ts`  |
| Notebook editor model    | `/src/renderer/editors/notebook/NotebookEditorModel.ts` |
| Notebook types           | `/src/renderer/editors/notebook/notebookTypes.ts` |
| Graph editor model       | `/src/renderer/editors/graph/GraphViewModel.ts`   |
| Draw editor model        | `/src/renderer/editors/draw/DrawViewModel.ts`     |
| Rest Client editor       | `/src/renderer/editors/rest-client/RestClientViewModel.ts` |
| MCP Inspector model      | `/src/renderer/editors/mcp-inspector/McpInspectorModel.ts` |
| Base virtualization      | `/src/renderer/components/virtualization/RenderGrid.tsx` |
| Advanced grid            | `/src/renderer/components/data-grid/AVGrid.tsx`   |
| Color tokens             | `/src/renderer/theme/color.ts`                    |
| Theme definitions        | `/src/renderer/theme/themes/`                     |
| Tor service              | `/src/main/tor-service.ts`                        |
| Named Pipe server        | `/src/main/pipe-server.ts`                        |
| MCP HTTP server          | `/src/main/mcp-http-server.ts`                    |
| MCP resource guides      | `/assets/mcp-res-*.md`                            |
| MCP command handler      | `/src/renderer/api/mcp-handler.ts`                |
| Rust launcher            | `/launcher/src/main.rs`                           |
| Rust screen snip tool    | `/snip-tool/src/main.rs`                          |
| VMP signing (build hook) | `/scripts/vmp-sign.mjs`                           |
