import { ReactNode, useMemo } from "react";
import { useSyncExternalStore } from "react";
import { isTextFileModel, TextFileModel } from "./TextPageModel";
import { Button } from "../../components/basic/Button";
import { CompareIcon, NavPanelIcon, RunAllIcon, RunIcon } from "../../theme/icons";
import { SwitchButtons } from "../../components/form/SwitchButtons";
import { FlexSpace } from "../../components/layout/Elements";
import styled from "@emotion/styled";
import { editorRegistry } from "../registry";
import { pagesModel } from "../../api/pages";
import { NavPanelModel } from "../../features/navigation/nav-panel-store";
import type { TOneState } from "../../core/state/state";

const path = require("path");

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

const EditorToolbarRoot = styled.div({
    display: "flex",
    alignItems: "center",
    gap: 4,
});

interface TextToolbarProps {
    model: TextFileModel;
    setEditorToolbarRefFirst?: (ref: HTMLDivElement | null) => void;
    setEditorToolbarRefLast?: (ref: HTMLDivElement | null) => void;
}

export function TextToolbar({ model, setEditorToolbarRefFirst, setEditorToolbarRefLast }: TextToolbarProps) {
    const actions: ReactNode[] = [];
    const textVm = model.getTextViewModel();
    const hasSelection = useOptionalModelState(textVm?.state, s => s.hasSelection, false);

    const { language, editor, filePath, title } = model.state.use((s) => ({
        language: s.language,
        editor: s.editor,
        filePath: s.filePath,
        title: s.title,
    }));

    // Use filePath if available, otherwise use title (which represents the intended filename)
    const fileName = filePath || title;

    const switchOptions = useMemo(() => {
        return editorRegistry.getSwitchOptions(language || "plaintext", fileName);
    }, [language, fileName]);


    if (filePath) {
        actions.push(
            <Button
                key="nav-panel"
                type="icon"
                size="small"
                title="File Explorer"
                onClick={() => {
                    if (model.navPanel) {
                        model.navPanel.reinitIfEmpty(path.dirname(filePath), filePath);
                        model.navPanel.toggle();
                    } else {
                        const navPanel = new NavPanelModel(path.dirname(filePath), filePath);
                        navPanel.id = model.id;
                        navPanel.flushSave();
                        model.navPanel = navPanel;
                        model.state.update((s) => {
                            s.hasNavPanel = true;
                        });
                    }
                }}
            >
                <NavPanelIcon />
            </Button>
        );
    }

    if (isTextFileModel(model)) {
        const leftGrouped = pagesModel.getLeftGroupedPage(model.id);
        if (leftGrouped && isTextFileModel(leftGrouped)) {
            actions.push(
                <Button
                    key="compare-with-left"
                    type="icon"
                    size="small"
                    title="Compare with Left Page"
                    onClick={() => {
                        model.setCompareMode(true);
                        leftGrouped.setCompareMode(true);
                    }}
                >
                    <CompareIcon />
                </Button>
            );
        }
    }

    if (language === "javascript") {
        actions.push(
            <Button
                key="run-script"
                type="icon"
                size="small"
                title={
                    hasSelection
                        ? "Run Selected Script (F5)"
                        : "Run Script (F5)"
                }
                onClick={() => model.runScript()}
            >
                <RunIcon />
            </Button>
        );
        if (hasSelection) {
            actions.push(
                <Button
                    key="run-all_script"
                    type="icon"
                    size="small"
                    title="Run All Script"
                    onClick={() => model.runScript(true)}
                >
                    <RunAllIcon />
                </Button>
            );
        }
    }

    actions.push(<FlexSpace key="flex-space" />);

    if (editor && editor !== "monaco") {
        // NavPanel button (index 0) should appear before the editor toolbar portal,
        // so extract it, unshift the portal, then unshift NavPanel back to front.
        const navBtn = filePath ? actions.shift() : null;
        actions.unshift(
            <EditorToolbarRoot key="editor-toolbar-first" ref={setEditorToolbarRefFirst} />
        );
        if (navBtn) {
            actions.unshift(navBtn);
        }
        actions.push(
            <EditorToolbarRoot key="editor-toolbar-last" ref={setEditorToolbarRefLast} />,
        )
    }

    const lastItems: ReactNode[] = [];
    if (switchOptions.options.length) {
        lastItems.push(
            <SwitchButtons
                key="json-editor-switch"
                options={switchOptions.options}
                value={editor || "monaco"}
                onChange={model.changeEditor}
                getLabel={switchOptions.getOptionLabel}
                style={{ margin: 1 }}
            />
        );
    }

    if (lastItems.length > 0) {
        actions.push(
            ...lastItems
        )
    }

    return <>{actions}</>;
}

// Re-export with old name for backward compatibility
export { TextToolbar as TextFileActions };
