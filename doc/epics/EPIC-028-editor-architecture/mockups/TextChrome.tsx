// =============================================================================
// MOCKUP — TextChrome (shared host-aware chrome wrapper)
//
// EPIC-028 design phase. Non-compiling sketch — for reading, not building.
//
// Walkthrough 10 introduces this component. Wraps a text-bearing editor's
// body with the chrome that text-bearing pages share: the page-level toolbar
// (from walkthrough 09), text-host-specific buttons (Compare / Run / Run-all /
// Show-resources), an optional script panel, and a footer row.
//
// Each text-bearing editor's loaded module composes it directly (TC3):
//
//     function MarkdownEditor({ model }: { model: EditorModel }) {
//         return (
//             <TextChrome
//                 model={model}
//                 toolbarContributions={
//                     <>
//                         <CompactModeButton model={model} />
//                         <ViewModeToggle model={model} />
//                     </>
//                 }
//                 footerContributions={null}
//             >
//                 <MarkdownBody model={model} />
//             </TextChrome>
//         );
//     }
//
// Host-instanceof branching (TC2, confirming C1) lives inside this component:
//   - host instanceof TextFileModel    → full chrome (script panel + footer
//                                        row + Compare button + Show-resources)
//   - host instanceof NoteItemEditModel → minimal chrome (no script panel,
//                                        no footer, no overlay, no Compare;
//                                        keeps language menu + Run + switch)
//   - host === null                    → caller should not be rendering
//                                        TextChrome; return null defensively
//
// Two named slots (TC1, TC10):
//   - toolbarContributions: rendered inside <PageToolbar> between text-host
//     action buttons (Compare/Run) and the auto-inserted spacer.
//   - footerContributions: rendered inside the footer row before the encoding
//     label. Ignored in the NoteItemEditModel branch (no footer row).
//
// Owned by the chrome (NOT exposed as slots):
//   - NavPanel button       — auto by <PageToolbar> per walkthrough 09 / PT5
//   - Compare-with-left     — text-host-specific; gated by canCompare (CK3)
//   - Run-script / Run-all  — text-host-specific; gated by host language +
//                             editor.hasTextSelection?() for Run-all (PT7)
//   - Show-resources        — text-host-specific; gated by host.language=="html"
//   - Switch widget         — auto by <PageToolbar> per walkthrough 09 / PT2
//   - Script panel          — <ScriptPanel host.script /> when host is
//                             TextFileModel AND host.script != null (TC6)
//   - Encoding label        — bottom-right of footer row (TextFileModel only)
//   - Script toggle button  — bottom-left of footer row (TextFileModel only)
//   - Focus subscription    — TC8; outer panel binds tabIndex + onFocus
//                             listener with 200ms refocus
//   - Keyboard delegation   — TC9; outer panel binds onKeyDown to delegate to
//                             host.handleKeyDown?(e)
//
// Encryption fallback (TC11): per-editor view guard, NOT inside <TextChrome>.
// Each text-bearing editor's view does `if (host.encrypted) return
// <MonacoFallback />; return <ActualBody />` before composing TextChrome —
// or TextChrome itself can short-circuit children with a fallback. Walkthrough
// 20 picks the exact spot (functionally equivalent).
// =============================================================================

import { ReactNode, useEffect, useRef } from "react";
import { EditorModel } from "./EditorModel";
import { TextFileModel } from "./TextFileModel";
// NoteItemEditModel lives in real code only (src/renderer/editors/notebook/
// note-editor/NoteItemEditModel.ts). Mockup imports through a placeholder.
import { PageToolbar } from "./PageToolbar";
import { ScriptPanel } from "../../../src/renderer/editors/text/ScriptPanel";
import { Panel } from "../../../src/renderer/uikit/Panel/Panel";
import { Spacer } from "../../../src/renderer/uikit/Spacer/Spacer";
import { Button } from "../../../src/renderer/uikit/Button/Button";
import { Divider } from "../../../src/renderer/uikit/Divider/Divider";
import { IconButton } from "../../../src/renderer/uikit/IconButton/IconButton";
import { CompareIcon, RunAllIcon, RunIcon, WebScraperIcon } from "../../../src/renderer/theme/icons";
import { pagesModel } from "../../../src/renderer/api/pages";
import { isScriptLanguage } from "../../../src/renderer/scripting/transpile";

interface TextChromeProps {
    model: EditorModel;
    children: ReactNode;
    /** Editor-specific toolbar buttons. Rendered inside <PageToolbar> between
     *  the text-host buttons (Compare/Run/Run-all) and the auto-inserted spacer.
     *  Pass a fragment for multiple contributions. */
    toolbarContributions?: ReactNode;
    /** Editor-specific footer status. Rendered inside the footer row before
     *  the encoding label. Ignored in the NoteItemEditModel branch. */
    footerContributions?: ReactNode;
}

export function TextChrome({ model, children, toolbarContributions, footerContributions }: TextChromeProps) {
    const host = model.contentHost;
    const rootRef = useRef<HTMLDivElement>(null);

    // TC8 — focus management: refocus root when this page becomes active.
    useEffect(() => {
        const subscription = pagesModel.onFocus.subscribe((pageModel) => {
            if (pageModel !== model.page) return;
            setTimeout(() => {
                const root = rootRef.current;
                if (root && !root.contains(document.activeElement)) root.focus();
            }, 200);
        });
        return () => subscription.unsubscribe();
    }, [model]);

    // TC9 — keyboard delegation: chrome binds onKeyDown, delegates to host.
    const onKeyDown = (e: React.KeyboardEvent) => host?.handleKeyDown?.(e);

    // TC2 — inline instanceof branching.
    if (host instanceof TextFileModel) {
        return (
            <Panel
                ref={rootRef}
                direction="column"
                flex={1}
                height={0}
                position="relative"
                gap="xs"
                tabIndex={0}
                onKeyDown={onKeyDown}
            >
                <PageToolbar model={model} borderBottom>
                    {/* TC4 — order: text-host buttons → editor contributions → spacer (auto) → Show-resources */}
                    <CompareButton model={model} host={host} />
                    <RunButtons model={model} host={host} />
                    {toolbarContributions}
                    {/* <Spacer /> inserted automatically by <PageToolbar> before the switch widget per walkthrough 09 / PT2.
                        Show-resources sits AFTER the spacer; <PageToolbar> currently inserts a single auto spacer, so
                        the implementation will need to either expose a "post-spacer" children prop OR <ShowResourcesButton>
                        registers via a small adjustment to PageToolbar. Resolved during implementation; the design is
                        clear at the slot level. */}
                    <ShowResourcesButton host={host} />
                </PageToolbar>
                {children}
                {host.script && <ScriptPanel model={host} />}
                <PageToolbar model={model} borderTop>
                    <ScriptToggleButton host={host} />
                    <Spacer />
                    {footerContributions && <>{footerContributions}<Divider orientation="vertical" /></>}
                    <EncodingLabel host={host} />
                </PageToolbar>
            </Panel>
        );
    }

    // TC5 — NoteItemEditModel branch (minimal chrome).
    // Real-code import will narrow this branch via `host instanceof NoteItemEditModel`.
    if (isNoteItemHost(host)) {
        return (
            <Panel
                ref={rootRef}
                direction="column"
                flex={1}
                height={0}
                position="relative"
                gap="xs"
                tabIndex={0}
                onKeyDown={onKeyDown}
            >
                <PageToolbar model={model}>
                    <NoteLanguageMenu host={host} />
                    {toolbarContributions}
                    <RunButtons model={model} host={host} />
                </PageToolbar>
                {children}
            </Panel>
        );
    }

    // host === null or unknown class — defensive return; callers should not
    // mount <TextChrome> against non-host editors (PDF, Image, Browser, …).
    return null;
}

// ===== sub-components (sketches) =====

function CompareButton({ model, host }: { model: EditorModel; host: TextFileModel }) {
    if (!model.page) return null;
    const leftId = pagesModel.query.getLeftGroupedPageId?.(model.page.id);
    if (!leftId || !pagesModel.query.canCompare(leftId, model.page.id)) return null;
    return (
        <IconButton
            size="sm"
            title="Compare with Left Page"
            icon={<CompareIcon />}
            onClick={() => pagesModel.layout.enterCompareMode(model.page!.id)}
        />
    );
}

function RunButtons({ model, host }: { model: EditorModel; host: TextFileModel | unknown }) {
    // host.state.use(...) in real code — subscribes to language.
    const language = (host as any)?.state?.use?.((s: any) => s.language);
    if (!isScriptLanguage(language)) return null;
    const hasSelection = model.hasTextSelection?.() ?? false;
    return (
        <>
            <IconButton
                size="sm"
                title={hasSelection ? "Run Selected Script (F5)" : "Run Script (F5)"}
                icon={<RunIcon />}
                onClick={() => (host as any)?.runScript?.()}
            />
            {hasSelection && (
                <IconButton
                    size="sm"
                    title="Run All Script"
                    icon={<RunAllIcon />}
                    onClick={() => (host as any)?.runScript?.(true)}
                />
            )}
        </>
    );
}

function ShowResourcesButton({ host }: { host: TextFileModel }) {
    const language = host.state.use((s) => s.language);
    if (language !== "html") return null;
    return (
        <IconButton
            size="sm"
            title="Show Resources"
            icon={<WebScraperIcon />}
            onClick={() => showHtmlResources(host)}
        />
    );
}

function ScriptToggleButton({ host }: { host: TextFileModel }) {
    if (!host.script) return null;
    const open = host.script.state.use((s) => s.open);
    return (
        <Button variant="ghost" size="sm" onClick={host.script.toggleOpen}>
            <span style={{ opacity: open ? 1 : 0.6 }}>script</span>
        </Button>
    );
}

function EncodingLabel({ host }: { host: TextFileModel }) {
    const encoding = host.state.use((s) => s.encoding);
    return <span>{encoding || "utf-8"}</span>;
}

function NoteLanguageMenu({ host }: { host: unknown }) {
    // Today's NoteItemToolbar `WithMenu` language picker — relocates here per
    // TC5; implementation finalized in walkthrough 29.
    return null;
}

// ----- helpers -----

function isNoteItemHost(host: unknown): host is { handleKeyDown?: (e: React.KeyboardEvent) => void; state: any } {
    // Real code: `host instanceof NoteItemEditModel`. Mockup keeps the import
    // out via duck-type predicate.
    return host != null && typeof host === "object" && "noteId" in host;
}

async function showHtmlResources(host: TextFileModel) {
    const { extractHtmlResources } = await import("../../../src/renderer/core/utils/html-resources");
    const { content, filePath, title } = host.state.get();
    const baseUrl = filePath ? "file:///" + filePath.replace(/\\/g, "/").replace(/\/[^/]*$/, "/") : undefined;
    const links = extractHtmlResources(content, { baseUrl });
    pagesModel.openLinks(links, (title || "HTML") + " — Resources");
}

// =============================================================================
// What's gone vs. today's pattern
// =============================================================================
//
// REMOVED — today's shape that this mockup retires:
//   - TextEditorView.tsx                  — wrapper component dissolves entirely (TC3)
//   - TextToolbar.tsx                     — text-host buttons inline inside TextChrome (TC4)
//   - TextFooter.tsx                      — script-toggle + encoding label inline (TC10)
//   - ActiveEditor.tsx                    — Monaco-vs-other dispatch retires (no state.editor; TC11)
//   - NoteItemToolbar.tsx                 — minimal chrome owns its content (TC5)
//   - editorFooterRefLast field + setter  — on TextEditorModel + NoteItemEditModel (TC10)
//   - editorOverlayRef field + setter     — on TextEditorModel; Notebook owns its overlay inline (TC7)
//   - `<div ref={…} className="footer-portal-target" />` portal div inside TextFooter
//   - createPortal(…, model.editorFooterRefLast) blocks in 5 editor views
//     (Grid row count, Todo counts, Link status, Graph node count, Notebook note count)
//   - createPortal(<ExpandedNoteView />, model.editorOverlayRef!) at NotebookEditor.tsx:293-306
//   - model.handleKeyDown delegation pattern through TextEditorView — moves to chrome (TC9)
//   - pagesModel.onFocus subscription inside TextEditorView — moves to chrome (TC8)
// =============================================================================
