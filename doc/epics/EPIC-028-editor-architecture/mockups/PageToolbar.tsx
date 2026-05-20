// =============================================================================
// MOCKUP — PageToolbar (shared page-level toolbar host)
//
// EPIC-028 design phase. Non-compiling sketch — for reading, not building.
//
// New shared component introduced by walkthrough 09. Replaces today's
// TextEditorView-internal toolbar + TextToolbar's portal-ref machinery
// (PT1 + PT3). Lives at the same React layer as each editor's view —
// editors compose it inline:
//
//     function GridEditor({ model }: { model: EditorModel }) {
//         return (
//             <Panel direction="column" flex={1}>
//                 <PageToolbar model={model}>
//                     <GridFilterButton model={model} />
//                     <GridSortButton model={model} />
//                 </PageToolbar>
//                 <GridBody model={model} />
//                 {/* …other shared chrome (TextChrome — walkthrough 10) */}
//             </Panel>
//         );
//     }
//
// PageToolbar owns TWO auto-rendered page-level affordances:
//   - NavPanel button (left of children, walkthrough 09 / PT5 / B3) —
//     rendered when `editor.getNavigatorTarget() !== null` AND
//     `page.canOpenNavigator(target.pipe, target.filePath)`. Replaces
//     today's six per-editor inline IconButton blocks (Text, PDF, Image,
//     Video, Archive, Category).
//   - Switch widget (right of <Spacer />, walkthrough 09 / PT2 / PT10) —
//     rendered when `editor.findCompatibleEditors().length >= 2` AND the
//     current editor is in the list. Replaces today's SegmentedControl
//     baked into TextToolbar.
//
// Editor-specific contributions (Grid filters, Markdown view-modes, etc.)
// sit as children between the NavPanel slot and the spacer.
//
// Pure styling/layout primitive `EditorToolbar` (real-code, kept as-is at
// `src/renderer/editors/base/EditorToolbar.tsx`) is reused as the row
// container — PageToolbar's job is the auto-rendered slot composition on
// top of it.
// =============================================================================

import { ReactNode } from "react";
import { EditorModel } from "./EditorModel";
import { editorRegistry } from "./editorRegistry";
import { EditorToolbar } from "../../../src/renderer/editors/base/EditorToolbar";
import { IconButton } from "../../../src/renderer/uikit/IconButton/IconButton";
import { SegmentedControl } from "../../../src/renderer/uikit/SegmentedControl/SegmentedControl";
import { Spacer } from "../../../src/renderer/uikit/Spacer/Spacer";
import { NavPanelIcon } from "../../../src/renderer/theme/icons";

interface PageToolbarProps {
    model: EditorModel;
    children?: ReactNode;
    borderTop?: boolean;
    borderBottom?: boolean;
}

export function PageToolbar({ model, children, borderTop, borderBottom }: PageToolbarProps) {
    return (
        <EditorToolbar borderTop={borderTop} borderBottom={borderBottom}>
            <NavPanelButton model={model} />
            {children}
            <Spacer />
            <SwitchWidget model={model} />
        </EditorToolbar>
    );
}

// -----------------------------------------------------------------------------
// NavPanel button slot (walkthrough 09 / PT5 / B3)
//
// The editor declares its navigator-target via `getNavigatorTarget()`:
//   - null            → button hidden (editor has no notion of opening a
//                       file explorer panel)
//   - {}              → button always renders; toggle works with no args
//                       (Archive/Category — panel already attached)
//   - { pipe?, filePath? } → page predicate gates rendering, toggle passes
//                       pipe/filePath as the explorer root hint
//
// Subscriptions: the button consumes the editor's state (for navigator
// fields that live on the editor — PDF / Image / Video) and the host's
// state (for text-bearing editors where pipe/filePath live on the host).
// Both reactivity paths are already covered by `editor.state.use()` +
// `editor.contentHost?.state.use()` in the rendering editor's view —
// PageToolbar is a child component that re-renders when its parent does.
// -----------------------------------------------------------------------------

function NavPanelButton({ model }: { model: EditorModel }) {
    const target = model.getNavigatorTarget();
    if (target === null) return null;
    if (!model.page?.canOpenNavigator(target.pipe, target.filePath)) return null;
    return (
        <IconButton
            size="sm"
            title="File Explorer"
            icon={<NavPanelIcon />}
            onClick={() => model.page?.toggleNavigator(target.pipe, target.filePath)}
        />
    );
}

// -----------------------------------------------------------------------------
// Switch widget slot (walkthrough 09 / PT2 / PT10)
//
// Visibility: `editor.findCompatibleEditors().length >= 2` AND the current
// editor is in the list (PT10). Single-option pickers and lists that don't
// include the current editor are hidden — the SegmentedControl always has
// a non-null selected value when rendered.
//
// onChange: calls `page.switchMainEditor(v)` (walkthrough 02 / S1). Replaces
// today's `model.changeEditor(v)`.
// -----------------------------------------------------------------------------

function SwitchWidget({ model }: { model: EditorModel }) {
    const options = model.findCompatibleEditors();
    if (options.length < 2 || !options.includes(model.editorId)) return null;
    const items = options.map((id) => ({
        value: id,
        label: editorRegistry.getById(id)?.name ?? id,
    }));
    return (
        <SegmentedControl
            items={items}
            value={model.editorId}
            onChange={(v) => model.page?.switchMainEditor(v)}
            size="sm"
        />
    );
}

// =============================================================================
// What's gone vs. today's pattern
// =============================================================================
//
// REMOVED — today's shape that this mockup retires:
//   - `editorToolbarRefFirst` / `editorToolbarRefLast` portal refs on
//      TextEditorModel + NoteItemEditModel (walkthrough 09 / PT3 / PT9).
//      Editor views now compose toolbar contributions inline as children.
//   - `setEditorToolbarRefFirst` / `setEditorToolbarRefLast` setter methods.
//   - `<div ref={setEditorToolbarRefFirst} />` / `<div ref={setEditorToolbarRefLast} />`
//      portal-target divs inside `TextToolbar.tsx`.
//   - The `createPortal(toolbarFirstContent, model.editorToolbarRefFirst!)`
//      blocks across ten editor views (Grid, Markdown, Mermaid, SVG, Todo,
//      Link, LogView, Draw, Graph, Notebook + per-note).
//   - Six per-editor inline NavPanel IconButton blocks (TextToolbar.tsx,
//      PdfViewer.tsx, ImageViewer.tsx, VideoPlayerEditor.tsx,
//      ArchiveEditorView.tsx, CategoryEditor.tsx). All collapse into one
//      auto-rendered slot inside PageToolbar driven by
//      `editor.getNavigatorTarget()`.
//   - `editorRegistry.getSwitchOptions(language, fileName)` + the
//      `detectedContentEditor` state-field weave inside `TextToolbar.tsx`.
//      SwitchWidget reads `editor.findCompatibleEditors()` directly —
//      content-based detection already absorbed into `accepts()` per C7.
//   - `model.changeEditor(v)` — switch widget calls
//      `page.switchMainEditor(v)` per S1.
// =============================================================================
