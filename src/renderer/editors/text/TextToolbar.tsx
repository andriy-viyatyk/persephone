import { ReactNode, useMemo, useSyncExternalStore } from "react";
import { isTextFileModel, TextFileModel } from "./TextEditorModel";
import type { EditorView } from "../../../shared/types";
import { IconButton } from "../../uikit/IconButton/IconButton";
import { SegmentedControl, ISegment } from "../../uikit/SegmentedControl/SegmentedControl";
import { Spacer } from "../../uikit/Spacer/Spacer";
import { CompareIcon, NavPanelIcon, RunAllIcon, RunIcon, WebScraperIcon } from "../../theme/icons";
import { editorRegistry } from "../registry";
import { pagesModel } from "../../api/pages";
import { ui } from "../../api/ui";

import { isScriptLanguage } from "../../scripting/transpile";
import type { TOneState } from "../../core/state/state";


/** Always calls useSyncExternalStore — handles null state gracefully. */
function useOptionalModelState<T, R>(
    state: TOneState<T> | null | undefined,
    selector: (s: T) => R,
    defaultValue: R,
): R {
    return useSyncExternalStore(
        state ? (cb) => state.subscribe(cb) : () => () => {},
        state ? () => selector(state.get()) : () => defaultValue,
    );
}

const portalTargetStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 4,
};

interface TextToolbarProps {
    model: TextFileModel;
    setEditorToolbarRefFirst?: (ref: HTMLDivElement | null) => void;
    setEditorToolbarRefLast?: (ref: HTMLDivElement | null) => void;
}

export function TextToolbar({ model, setEditorToolbarRefFirst, setEditorToolbarRefLast }: TextToolbarProps) {
    const actions: ReactNode[] = [];
    const textVm = model.getTextViewModel();
    const hasSelection = useOptionalModelState(textVm?.state, s => s.hasSelection, false);

    const { language, editor, filePath, title, detectedContentEditor } = model.state.use((s) => ({
        language: s.language,
        editor: s.editor,
        filePath: s.filePath,
        title: s.title,
        detectedContentEditor: s.detectedContentEditor,
    }));

    // Use filePath if available, otherwise use title (which represents the intended filename)
    const fileName = filePath || title;

    const switchOptions = useMemo(() => {
        const base = editorRegistry.getSwitchOptions(language || "plaintext", fileName);
        // If content-based detection found an editor not already in the list, add it
        if (detectedContentEditor && !base.options.includes(detectedContentEditor)) {
            const options = base.options.length > 0
                ? [...base.options, detectedContentEditor]
                : ["monaco" as EditorView, detectedContentEditor];
            return {
                options,
                getOptionLabel: (option: EditorView) => {
                    if (option === detectedContentEditor) {
                        return editorRegistry.getById(detectedContentEditor)?.name ?? option;
                    }
                    return base.getOptionLabel(option);
                },
            };
        }
        return base;
    }, [language, fileName, detectedContentEditor]);

    const segItems: ISegment[] = useMemo(
        () => switchOptions.options.map((opt) => ({
            value: opt,
            label: switchOptions.getOptionLabel(opt),
        })),
        [switchOptions],
    );


    if (model.page?.canOpenNavigator(model.pipe, filePath) || filePath) {
        actions.push(
            <IconButton
                key="nav-panel"
                size="sm"
                title="File Explorer"
                icon={<NavPanelIcon />}
                onClick={() => {
                    model.page?.toggleNavigator(model.pipe, filePath);
                }}
            />
        );
    }

    if (isTextFileModel(model)) {
        const leftGroupedPage = pagesModel.getLeftGroupedPage(model.id);
        const leftGroupedEditor = leftGroupedPage?.mainEditor;
        if (leftGroupedEditor && isTextFileModel(leftGroupedEditor)) {
            actions.push(
                <IconButton
                    key="compare-with-left"
                    size="sm"
                    title="Compare with Left Page"
                    icon={<CompareIcon />}
                    onClick={() => {
                        model.setCompareMode(true);
                        leftGroupedEditor.setCompareMode(true);
                    }}
                />
            );
        }
    }

    if (isScriptLanguage(language)) {
        actions.push(
            <IconButton
                key="run-script"
                size="sm"
                title={
                    hasSelection
                        ? "Run Selected Script (F5)"
                        : "Run Script (F5)"
                }
                icon={<RunIcon />}
                onClick={() => model.runScript()}
            />
        );
        if (hasSelection) {
            actions.push(
                <IconButton
                    key="run-all_script"
                    size="sm"
                    title="Run All Script"
                    icon={<RunAllIcon />}
                    onClick={() => model.runScript(true)}
                />
            );
        }
    }

    actions.push(<Spacer key="flex-space" />);

    if (language === "html") {
        actions.push(
            <IconButton
                key="show-resources"
                size="sm"
                title="Show Resources"
                icon={<WebScraperIcon />}
                onClick={() => showHtmlResources(model)}
            />
        );
    }

    if (editor && editor !== "monaco") {
        // NavPanel button (index 0) should appear before the editor toolbar portal,
        // so extract it, unshift the portal, then unshift NavPanel back to front.
        const navBtn = filePath ? actions.shift() : null;
        actions.unshift(
            <div
                key="editor-toolbar-first"
                ref={setEditorToolbarRefFirst}
                style={portalTargetStyle}
            />
        );
        if (navBtn) {
            actions.unshift(navBtn);
        }
        actions.push(
            <div
                key="editor-toolbar-last"
                ref={setEditorToolbarRefLast}
                style={portalTargetStyle}
            />,
        )
    }

    if (segItems.length) {
        actions.push(
            <SegmentedControl
                key="json-editor-switch"
                items={segItems}
                value={editor || "monaco"}
                onChange={(v) => model.changeEditor(v as EditorView)}
                size="sm"
            />
        );
    }

    return <>{actions}</>;
}

async function showHtmlResources(model: TextFileModel) {
    const { extractHtmlResources } = await import("../../core/utils/html-resources");
    const { content, filePath, title } = model.state.get();
    const baseUrl = filePath ? "file:///" + filePath.replace(/\\/g, "/").replace(/\/[^/]*$/, "/") : undefined;
    const links = extractHtmlResources(content, { baseUrl });
    if (links.length === 0) {
        ui.notify("No resources found in this HTML.", "info");
        return;
    }
    pagesModel.openLinks(links, (title || "HTML") + " — Resources");
}
