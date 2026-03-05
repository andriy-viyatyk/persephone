# js-notepad Project Guidelines

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

### Completing a task (MANDATORY steps):

After implementation is done, ALWAYS run these steps in order:

1. Verify all acceptance criteria are met
2. **Run `/project:review`** — validates code against architecture docs, reports concerns
3. **Run `/project:document`** — updates developer docs in `/doc/` (architecture, standards, CLAUDE.md)
4. **Run `/project:userdoc`** — updates user docs in `/docs/` (guides, API reference, what's new)
5. Add task to the top of [/doc/tasks/completed.md](doc/tasks/completed.md) (include Epic column if linked)
6. Update the linked epic's task table (if applicable)
7. **Ask user for confirmation** before deleting the task folder (if one exists)
8. Delete task folder after user confirms

**Steps 2-4 are mandatory.** Only skip if the user explicitly says to skip them. The agent must not forget these steps — they ensure documentation stays in sync with code.

This step-by-step approach ensures user understands what's happening and can review changes properly.

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
| Build complex components      | [/doc/standards/model-view-pattern.md](doc/standards/model-view-pattern.md) |
| Understand state management   | [/doc/architecture/state-management.md](doc/architecture/state-management.md) |
| Work with pages/tabs          | [/doc/architecture/pages-architecture.md](doc/architecture/pages-architecture.md) |
| Work with scripting system    | [/doc/architecture/scripting.md](doc/architecture/scripting.md) |
| Check coding style            | [/doc/standards/coding-style.md](doc/standards/coding-style.md) |
| See current tasks             | [/doc/tasks/active.md](doc/tasks/active.md) |
| See active epics              | [/doc/epics/active.md](doc/epics/active.md) |
| See future ideas              | [/doc/tasks/backlog.md](doc/tasks/backlog.md) |
| Publish a new build           | [/doc/standards/release-process.md](doc/standards/release-process.md) |
| User documentation            | [/docs/index.md](docs/index.md) |

## Project Overview

JS-Notepad is a Windows Notepad replacement for developers. Built with Electron and Monaco Editor (VS Code engine), it extends classic notepad with powerful code editing and a JavaScript execution environment.

### Design Philosophy
- **Core First:** Keep core functionality fast and lightweight
- **Extensible:** Editors loaded on-demand via async imports
- **Developer-Focused:** Tools for manipulating and transforming data
- **Container:** Provides UI building blocks; users bring integrations via Node.js/npm

### Key Features
- **Monaco Editor** - Syntax highlighting, IntelliSense, multi-cursor, compare mode
- **JavaScript Executor** - Run scripts with `page` object to transform content
- **Grid Editors** - JSON/CSV viewing with sorting, filtering, Excel copy-paste
- **Markdown Preview** - Live rendered preview
- **PDF Viewer** - Integrated pdf.js

## Tech Stack

- **Runtime:** Electron 39 (nodeIntegration: true, contextIsolation: false)
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
    /scripting       # Script execution, wrappers, editor facades
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

### 2. Script Context (`page` and `app` objects)
Scripts access content via `page` and the application via `app`:
```javascript
const data = JSON.parse(page.content);
page.grouped.content = JSON.stringify(result);
page.grouped.editor = "grid-json";

// Typed editor access via facades
const grid = await page.asGrid();
grid.addRows(5);
```

### 3. Grouped Pages
- Two tabs can be grouped (side-by-side)
- Accessing `page.grouped` auto-creates a grouped page if none exists
- Script output is written to the grouped page

### 4. State Management
- Object Model APIs in `/src/renderer/api/` (app.settings, app.pages, etc.)
- State primitives in `/src/renderer/core/state/`
- See [state-management.md](doc/architecture/state-management.md)

## Coding Standards (Quick Reference)

- **TypeScript** for all new code
- **Emotion** for styling (styled components or css prop)
- **Functional components** with hooks
- **Direct imports** preferred over barrel imports (avoid circular deps)
- **Meaningful names** - descriptive, no abbreviations
- **No hardcoded colors** - All colors must come from `import color from "../../theme/color"`. Never use hex codes, `rgb()`/`rgba()`, or named colors directly in styled components or inline styles. If a needed color doesn't exist in `color`, add it to `color.ts` and all theme definitions in `/src/renderer/theme/themes/`.

See [/doc/standards/coding-style.md](doc/standards/coding-style.md) for complete standards.

## Key Files

| Purpose                  | File                                              |
|--------------------------|---------------------------------------------------|
| App object model         | `/src/renderer/api/app.ts`                        |
| Page/tab management      | `/src/renderer/api/pages/PagesModel.ts`           |
| File operations          | `/src/renderer/api/fs.ts`                         |
| App settings             | `/src/renderer/api/settings.ts`                   |
| Script execution         | `/src/renderer/scripting/ScriptRunner.ts`         |
| Script API types         | `/src/renderer/api/types/*.d.ts`                  |
| Monaco setup             | `/src/renderer/api/setup/configure-monaco.ts`     |
| Editor registry          | `/src/renderer/editors/registry.ts`               |
| Editor registration      | `/src/renderer/editors/register-editors.ts`       |
| Text editor model        | `/src/renderer/editors/text/TextPageModel.ts`     |
| Grid editor              | `/src/renderer/editors/grid/GridViewModel.ts`     |
| Notebook editor model    | `/src/renderer/editors/notebook/NotebookEditorModel.ts` |
| Notebook types           | `/src/renderer/editors/notebook/notebookTypes.ts` |
| Base virtualization      | `/src/renderer/components/virtualization/RenderGrid.tsx` |
| Advanced grid            | `/src/renderer/components/data-grid/AVGrid.tsx`   |
| Color tokens             | `/src/renderer/theme/color.ts`                    |
| Theme definitions        | `/src/renderer/theme/themes/`                     |
| Named Pipe server        | `/src/main/pipe-server.ts`                        |
| MCP HTTP server          | `/src/main/mcp-http-server.ts`                    |
| MCP command handler      | `/src/renderer/api/mcp-handler.ts`                |
| Rust launcher            | `/launcher/src/main.rs`                           |
