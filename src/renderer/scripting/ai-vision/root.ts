import "./namespaces";
import { DialogsNode } from "./dialogs";
import { MenusNode } from "./menus";
import { eventLog } from "./event-log";
import { EventsNode } from "./namespaces/events";
import { toolsNode } from "./namespaces/tools";
import { ClipboardHistoryNode } from "./namespaces/clipboard";

import type { AppWrapper } from "../api-wrapper/AppWrapper";
import type { PageCollectionWrapper } from "../api-wrapper/PageCollectionWrapper";
import type { PageWrapper } from "../api-wrapper/PageWrapper";
import { scriptRunner } from "../ScriptRunner";
import { resolveRendererScriptEditor } from "../renderer-script-target";
import { helpSearch as searchHelp, IAiChild, IAiMember, IAiVisible, IAiVisionDescriptor, IHelpSearchHit, numberRule, stringRule, validateCallArguments } from "ai-vision";

interface IHelpSearchEmptyResult {
    kind: "HelpSearch";
    query: string;
    hits: 0;
    message: string;
    hint: string;
}

type HelpSearchResult = IHelpSearchHit[] | IHelpSearchEmptyResult;

export interface AiRootOptions {
    /** Page supplied by a live script or by a Board owner lookup. */
    page?: PageWrapper;
    /** Additional root gate evaluated by the shared resolver for each call. */
    restricted?: () => string | undefined;
    /** Renderer-only context carried to per-call board facade transports. */
    callContext?: IAiCallContext;
}

export interface IAiCallContext {
    readonly timeoutMs?: number;
    readonly eventCursor?: number;
}

/**
 * The root of the renderer's AiVision tree — what `call` with an empty path lands on.
 *
 * Delegates to the script API's `AppWrapper` member by member (same names, so every hint doubles
 * as a scripting tutorial) and adds two things scripts spell differently: `page` (the active page,
 * the script global of the same name) and `helpSearch`. It is its own class rather than members
 * bolted onto `AppWrapper` so the script-facing `app` object stays exactly the `.d.ts` surface.
 */

/**
 * Names still reserved at the root: served by the main process (`windows`, `main`) or owned by
 * later tasks (`guides`, `pipe`). Kept here for declaration consumers; the main-side
 * handler routes the first two before forwarding.
 */
export const RESERVED_ROOT_NAMES: readonly string[] = ["windows", "main", "guides", "script", "pipe"];

const ROOT_MEMBERS: IAiVisionDescriptor["members"] = [
    { name: "pages", kind: "property", summary: "All open pages (tabs) in this window; index by position or page id. Also holds pages.logView — the channel for showing the user output or asking them a question." },
    { name: "page", kind: "property", summary: "The active page (same as the `page` global in scripts)." },
    { name: "helpSearch", kind: "method", signature: "helpSearch(query: string, limit = 20)", summary: "Search the live descriptor graph for object-model paths; use guides.search for documentation text." },
    { name: "version", kind: "property", summary: "Persephone version string." },
    { name: "settings", kind: "property", node: true, summary: "Application settings (read/write)." },
    { name: "fs", kind: "property", node: true, summary: "File system access (read/write files, list folders).", caution: "writes touch the user's disk" },
    { name: "ui", kind: "property", node: true, summary: "Dialogs, notifications, progress overlays, screen locks — and ui.elements, which names the on-screen shell controls and what each is for. Asked WHERE something is, or to SHOW the user something, start there and point at it with ui.highlight. Asked to WALK the user THROUGH a screen, use ui.guide.step, which points at a control and then waits for them. A writable property that changes the same thing is a different question." },
    { name: "dialogs", kind: "property", node: true, summary: "Open renderer dialogs in live display order; use dialogs[i] to inspect and answer one." },
    { name: "menus", kind: "property", node: true, summary: "The open application popup menu; use menus[0] to inspect items, click an action, or close it." },
    { name: "shell", kind: "property", node: true, summary: "Open URLs, capture screen snippets, encrypt/decrypt text, and inspect runtime/update versions.", caution: "runs processes with the user's privileges" },
    { name: "window", kind: "property", node: true, summary: "This window: state, sidebar, zoom, and multi-window actions." },
    { name: "proc", kind: "property", node: true, summary: "Spawn and manage child processes.", caution: "runs processes with the user's privileges" },
    { name: "boards", kind: "property", node: true, summary: "Boards — sandboxed mini web-apps: create, open, trust, install, update, and remove." },
    { name: "tools", kind: "property", node: true, summary: "Agent Tools: search and execute registered tool scripts, inspect or refresh toolsets, and request user registration or remove one.", caution: "execution runs registered scripts with the user's privileges and registration requires user consent" },
    { name: "boardVars", kind: "property", node: true, summary: "Administer board environment variables and secrets." },
    { name: "editors", kind: "property", node: true, summary: "The editor registry: which editors exist and which languages they take." },
    { name: "capabilities", kind: "property", node: true, summary: "Read-only discovery of indexed capability candidates and handlers." },
    { name: "recent", kind: "property", node: true, summary: "Recently opened files." },
    { name: "downloads", kind: "property", node: true, summary: "Download manager." },
    { name: "menuFolders", kind: "property", node: true, summary: "Configured folders shown in the sidebar." },
    { name: "events", kind: "property", node: true, summary: "What changed in this renderer window; call events.wait(), and call it again when pending." },
    // Answered by the main process before the path reaches this window — listed here so the root
    // hint is complete. See RESERVED_ROOT_NAMES.
    { name: "windows", kind: "property", summary: "All Persephone windows (open and closed). windows[i] is one window; prefix any path with windows[i]. to target it — without the prefix you are talking to the main window." },
    { name: "main", kind: "property", summary: "Main-process diagnostics and settings-gated scripting; process-wide, never windows[i].main." },
    { name: "guides", kind: "property", node: true, summary: "Documentation tree and text search for how to do something or where it is; use guides paths before resources." },
    { name: "script", kind: "property", node: true, summary: "Execute JavaScript or TypeScript in the renderer with the user's privileges." },
];

const CLIPBOARD_ROOT_MEMBER: IAiMember = {
    name: "clipboard",
    kind: "property",
    node: true,
    summary: "Stored clipboard history, available only when clipboard.enabled is true.",
};

const SCRIPT_EXECUTION_CAUTION = "runs arbitrary renderer code with the user's privileges; it can read and write files, spawn processes, access the network, and affect the app";

const HELP_SEARCH_ARGUMENTS = [
    stringRule("query", 'helpSearch("grid")'),
    numberRule("limit", 'helpSearch("grid", 20)', { required: false }),
] as const;

const SCRIPT_MEMBERS: readonly IAiMember[] = [
    { name: "execute", kind: "method", signature: "execute(code, pageId?, language?)", summary: "Execute JavaScript or TypeScript in the renderer and return text with captured console logs; failures inside code set isError: true.", caution: SCRIPT_EXECUTION_CAUTION },
];

const SCRIPT_HELP = `
script.execute(code, pageId?, language?) runs code in the renderer execution context. The available
script globals are app, page, io, and ai; app exposes application services, and page is the selected
page's script global. If pageId is omitted, execution targets the active page; pass a page id to
target that page explicitly. language is optional and may be "javascript" or "typescript"; TypeScript
is transpiled without type checking.

The last expression is returned as text. The result always contains text, language, isError, and
consoleLogs. console.log, console.info, console.warn, and console.error are captured in consoleLogs.
The \`code\` argument must be a string: a wrong code-parameter type is an MCP/tool error. A syntax
or runtime error thrown by a string of code is not an MCP/tool error; the call succeeds with
isError: true, error text, and any consoleLogs captured before the failure. Renderer failures include
the error message and submitted-script stack frames after Persephone's internal frames are removed.
Side effects performed before an error or timeout remain performed.

This is full-privilege renderer/Node.js execution with no sandbox. Code can read and write files,
spawn processes, access the network, and change the application. require() is context-bound, but
otherwise has full Node.js access. A renderer bridge request waits up to 30 seconds; a timeout does
not cancel JavaScript that is already running. A newly opened blocking renderer dialog may instead
return pending with an attention instruction; answer it and re-read the relevant state.

The call resolver may cut long result text or a console argument at maxLength (20,000 by default).
Raise call's maxLength to return the rest. For detailed API operations, use the app and page paths
and their descendants; use helpSearch when you need to discover another path. This help is the
execution contract for script.execute. The separate main.script.execute path runs settings-gated
main-process code.

The script-only io global also exposes registerProvider(type, factory) and
registerScheme(scheme, hooks). Factories and hooks are structural values; registrations belong
to the current renderer session and survive script completion and autoload re-execution. Reusing a
script-owned provider type or scheme replaces the previous entry with an info report, while
platform-owned duplicates remain first-wins errors. A renderer reload/restart clears registrations;
restart recovery for persisted script providers is not available in Phase A.

Inside a renderer script, app.call(path, options?) resolves the renderer tree only; it cannot
resolve the MCP router's main.* or windows[i].* paths. It returns a bounded plain value, accepts
args or value (not both), and never returns hints or resolver metadata.
`.trim();

/**
 * The root hint's orientation block. Deliberately NOT a member list: the members block follows it
 * in the same hint, with the cautions and signatures, so enumerating them here said everything
 * twice. What this says instead is what the members cannot — what Persephone IS, and what an agent
 * can do with it.
 */
const ROOT_OVERVIEW = `
Persephone is a developer notepad on the user's desktop: tabbed pages, each with a specialized
editor (Monaco text, JSON/CSV grids, markdown, notebooks, compare, browser). Every path here has
the same name in scripts, so a hint doubles as a scripting tutorial. Paths address this window;
prefix windows[i]. to target another, and main is process-wide.

What you can do here:
  SHOW the user something, or ASK them a question - pages.logView.push([...]) renders markdown,
    grids, mermaid, code and progress into a page and raises dialogs; it is your output channel.
  Open and edit content - pages.openFile("C:/path"), then page.content or pages[0].content.
  Drive a real browser - pages.openUrlInBrowserTab(url), then pages[i].editor.click / type /
    waitFor / snapshot: Playwright-like automation over a tab the user can watch.
  Build the user a small app - boards are sandboxed offline web-apps you author
    (boards.createBoard); once open, you drive the board's own model at pages[i].editor.app.
  Run code - script.execute("1 + 1") in the renderer, with the app, page, io and ai globals.
  Point at Persephone's own UI - ui.elements names the on-screen controls, ui.highlight points at
    one, and ui.guide.step(target, message) walks the user through a screen one control at a time.
  Reach the machine - fs, proc and shell; all cautioned, because they act with the user's rights.
  Find things - helpSearch("add rows") searches this live model; guides.* is the documentation.

The members below are the full list. Any of them opens up: call "<name>.$help" for its long-form
help, or just resolve it.
`.trim();

const ROOT_HELP = `
This is Persephone's live object model. Every path here has the same name in scripts
(script.execute(code)): "pages[0].content" is "app.pages.all[0].content" there.

Common paths:
  pages.logView.push([...])   SHOW the user output (markdown, a grid, mermaid, code, progress) or
                              ASK them a question — the agent's output channel; see its $help
  pages["<id>"].content       text of a specific page
  pages[0].editorSwitches.switchTo("grid-json")  switch the page, then use pages[0].editor.addRows(5)
  pages.showPage("<id>")      activate a page
  tools.execute               execute a registered tool (use args for tool id and JSON arguments)
  tools.toolsets              inspect current registered toolsets, including invalid and shadowed entries
  tools.toolsets.refresh()    refresh the whole registered-tool registry
  tools.createToolset         scaffold a toolset and offer the existing user registration prompt
  pages[0].tab.highlight("tab-language")  point the user at one page's tab control ("where is …?", "show me …")
  script.execute(code)        run renderer JavaScript or TypeScript; see script.$help
  main.script.execute(code)   run the separate settings-gated main-process scripting path
  events.recent()             read recent changes, or events.wait() and call it again when pending
  <path>.$help                long-form help for any node

Rules: arguments for the last segment go in "args" (a JSON array); assignments go in "value";
the path itself takes only short JSON literals. Unknown members return the valid member list.

Agent Tools are a root-only call namespace, not an app/script member. Search exposes environment
variable names only; credentials remain in the toolset's .env and never in a call result. Execution
returns the structured result, including advisory argWarnings when inputSchema is not satisfied;
the schema is descriptive and the tool script remains authoritative. On failure, use toolsetRoot
and stderr to repair the tool, call tools.toolsets.refresh(), and run it again. Tool output uses
the last ##PERSEPHONE_RESULT##<json> marker; unmarked stdout becomes logs or resultText and stderr is
diagnostics. Toolset refresh is whole-registry only, and createToolset never registers without the
existing user confirmation; a declined registration can be offered again with the same call.
`;

export class AiRoot implements IAiVisible {
    private readonly clipboardNode: ClipboardHistoryNode;

    constructor(
        private readonly app: AppWrapper,
        private readonly options: AiRootOptions = {},
    ) {
        this.clipboardNode = new ClipboardHistoryNode(this.app);
    }

    private readonly dialogsNode = new DialogsNode();
    private readonly menusNode = new MenusNode();
    private readonly eventsNode = new EventsNode(
        eventLog,
        () => this.options.callContext?.eventCursor ?? 0,
    );
    private readonly scriptNode = new ScriptNode();
    get pages(): PageCollectionWrapper {
        return this.app.pages.withCallContext(this.options.callContext);
    }

    get page(): PageWrapper | undefined {
        const page = this.options.page ?? this.app.pages.activePage;
        return page ? this.app.pages.withCallContext(this.options.callContext).findPage(page.id) : undefined;
    }

    async helpSearch(...args: unknown[]): Promise<HelpSearchResult> {
        const [query, limit] = validateCallArguments("helpSearch", args, HELP_SEARCH_ARGUMENTS, { maxArgs: 2 });
        const hits = await searchHelp(this, query, limit);
        if (hits.length > 0) return hits;
        return {
            kind: "HelpSearch",
            query,
            hits: 0,
            message: `No object-model path matched ${JSON.stringify(query)}.`,
            hint: `Search documentation text with guides.search(${JSON.stringify(query)}).`,
        };
    }

    get version() { return this.app.version; }
    get settings() { return this.app.settings; }
    get fs() { return this.app.fs; }
    get ui() { return this.app.ui; }
    get dialogs(): DialogsNode { return this.dialogsNode; }
    get menus(): MenusNode { return this.menusNode; }
    get events(): EventsNode { return this.eventsNode; }
    get shell() { return this.app.shell; }
    get window() { return this.app.window; }
    get proc() { return this.app.proc; }
    get boards() { return this.app.boards; }
    get tools() { return toolsNode; }
    get boardVars() { return this.app.boardVars; }
    get editors() { return this.app.editors; }
    get capabilities() { return this.app.capabilities; }
    get recent() { return this.app.recent; }
    get downloads() { return this.app.downloads; }
    get menuFolders() { return this.app.menuFolders; }
    get script(): ScriptNode { return this.scriptNode; }
    get clipboard(): ClipboardHistoryNode { return this.clipboardNode; }

    get aiVision(): IAiVisionDescriptor {
        const members = this.clipboardEnabled()
            ? [...ROOT_MEMBERS, CLIPBOARD_ROOT_MEMBER]
            : ROOT_MEMBERS;
        return {
            kind: "Persephone",
            summary: "the root of the object model — a developer notepad with tabbed pages, specialized editors and scripting.",
            members,
            overview: ROOT_OVERVIEW,
            help: ROOT_HELP,
            children: () => this.children(),
            ...(this.options.restricted ? { restricted: this.options.restricted } : {}),
            summarize: () => ({ kind: "Persephone", version: this.app.version, pageCount: this.app.pages.all.length, activePageId: this.page?.id ?? null }),
        };
    }

    private children(): IAiChild[] {
        const children: IAiChild[] = [
            { segment: ".pages", kind: "Pages", summary: `${this.app.pages.all.length} open page(s)` },
        ];
        const active = this.page;
        if (active) {
            const restricted = active.aiVision.restricted?.();
            children.push({ segment: ".page", kind: "Page", summary: `active: "${active.title}" (${active.editor.id})`, ...(restricted ? { restricted } : {}) });
        }
        if (this.clipboardEnabled()) {
            children.push({ segment: ".clipboard", kind: "ClipboardHistory", summary: "stored clipboard history" });
        }
        return children;
    }

    private clipboardEnabled(): boolean {
        return !!this.app.settings.get("clipboard.enabled");
    }
}

class ScriptNode implements IAiVisible {
    execute(code: string, pageId?: string, language?: string) {
        if (typeof code !== "string" || !code) {
            throw new Error("Missing or invalid 'script' parameter");
        }
        const editor = resolveRendererScriptEditor(pageId);
        return scriptRunner.runWithCapture(code, editor, language);
    }

    get aiVision(): IAiVisionDescriptor {
        return {
            kind: "Script",
            summary: "Renderer script execution in the context where app, page, and editor facades live.",
            members: SCRIPT_MEMBERS,
            help: SCRIPT_HELP,
        };
    }
}
