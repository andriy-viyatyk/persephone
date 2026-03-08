import { Editor } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import styled from "@emotion/styled";

import { TModel } from "../../core/state/model";
import { TextFileModel } from "./TextPageModel";
import { Splitter } from "../../components/layout/Splitter";
import color from "../../theme/color";
import { PageToolbar } from "../base/EditorToolbar";
import { CloseIcon, OpenFileIcon, RunAllIcon, RunIcon, SaveIcon } from "../../theme/icons";
import { Button } from "../../components/basic/Button";
import { FlexSpace } from "../../components/layout/Elements";
import { TComponentState } from "../../core/state/state";
import { fs } from "../../api/fs";
import { parseObject } from "../../core/utils/parse-utils";
import { debounce } from "../../../shared/utils";
import { libraryService, ScriptPanelEntry } from "../../api/library-service";
import { settings } from "../../api/settings";
import { showInputDialog } from "../../ui/dialogs/InputDialog";
import { ComboSelect } from "../../components/form/ComboSelect";

const nodefs = require("fs") as typeof import("fs");
const nodepath = require("path") as typeof import("path");

const ScriptPanelRoot = styled.div({
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    "& .splitter": {
        borderTop: "none",
        borderBottom: `1px solid ${color.border.light}`,
    },
    "& .page-toolbar": {
        marginBottom: 2,
    },
    "& .script-selector": {
        height: 22,
        minWidth: 120,
        maxWidth: 200,
        fontSize: 12,
        "& input": {
            height: 22,
            fontSize: 12,
        },
    },
});

export interface ScriptPanelState {
    content: string;
    open: boolean;
    height: number;
    hasSelection: boolean;
    /** File path of the selected library script, or null for ad-hoc script. */
    selectedScript: string | null;
    /** True when content has been modified since last load/save. */
    dirty: boolean;
}

export const defaultScriptPanelState: ScriptPanelState = {
    content: "return page.content",
    open: false,
    height: 160,
    hasSelection: false,
    selectedScript: null,
    dirty: false,
};

/** Dropdown entry for the script selector. */
export interface ScriptDropdownEntry {
    /** Display label (e.g. "my-script" or "all/my-script") */
    label: string;
    /** The underlying ScriptPanelEntry, or null for "(unsaved script)" */
    entry: ScriptPanelEntry | null;
}

export class ScriptPanelModel extends TModel<ScriptPanelState> {
    editorRef = null as monaco.editor.IStandaloneCodeEditor | null;
    private pageModel: TextFileModel;
    private unsubscribe: (() => void) | undefined = undefined;
    private skipSave = false;
    private selectionListenerDisposable: monaco.IDisposable | null = null;
    id: string | undefined = undefined;
    name = "script";

    constructor(pageModel: TextFileModel) {
        super(new TComponentState(defaultScriptPanelState));
        this.pageModel = pageModel;
        this.unsubscribe = this.state.subscribe(this.saveStateDebounced);
    }

    restore = async (id: string) => {
        this.id = id;
        const data = await fs.getCacheFile(id, this.name);
        const newState = parseObject(data) || defaultScriptPanelState;
        this.skipSave = true;
        const merged = { ...defaultScriptPanelState, ...newState };
        // Ad-hoc scripts always have save enabled (acts as "save as")
        if (!merged.selectedScript) {
            merged.dirty = true;
        }
        this.state.set(merged);
    }

    private saveState = async (): Promise<void> => {
        if (this.skipSave) {
            this.skipSave = false;
            return;
        }
        if (!this.id) {
            return;
        }

        const state = this.state.get();
        await fs.saveCacheFile(this.id, JSON.stringify(state), this.name);
    }

    private saveStateDebounced = debounce(this.saveState, 300);

    dispose = () => {
        this.unsubscribe?.();
        this.selectionListenerDisposable?.dispose();
        this.selectionListenerDisposable = null;
    }

    changeContent = (newContent: string) => {
        this.state.update((s) => {
            s.content = newContent;
            s.dirty = true;
        });
    }

    toggleOpen = () => {
        this.state.update((s) => {
            s.open = !s.open;
        });
    }

    setHeight = (height: number) => {
        this.state.update((s) => {
            s.height = height;
        });
    }

    handleEditorChange = (value: string | undefined) => {
        this.changeContent(value || "");
    };

    handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.code === "F5") {
            e.preventDefault();
            this.pageModel.runRelatedScript();
        }
        if (e.code === "KeyS" && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
            if (this.state.get().dirty) {
                e.preventDefault();
                e.stopPropagation();
                this.saveToLibrary();
            }
        }
    };

    setupSelectionListener = (editor: monaco.editor.IStandaloneCodeEditor) => {
        this.selectionListenerDisposable = editor.onDidChangeCursorSelection((e) => {
            const selection = editor.getSelection();
            const hasSelection = selection ? !selection.isEmpty() : false;

            if (this.state.get().hasSelection !== hasSelection) {
                this.state.update(s => { s.hasSelection = hasSelection; });
            }
        });
    };

    handleEditorDidMount = (editor: monaco.editor.IStandaloneCodeEditor) => {
        this.editorRef = editor;
        this.setupSelectionListener(editor);
    };

    getSelectedText = (): string => {
        if (!this.editorRef) {
            return "";
        }

        const selection = this.editorRef.getSelection();
        if (!selection || selection.isEmpty()) {
            return "";
        }

        return this.editorRef.getModel()?.getValueInRange(selection) || "";
    };

    // ── Script Library Integration ──────────────────────────────────────

    /** Get available scripts for the current page language, merged with "all". */
    getAvailableScripts = (): ScriptDropdownEntry[] => {
        libraryService.ensureInitialized();
        const language = this.pageModel.state.get().language || "";
        const index = libraryService.scriptPanelIndex;

        const entries: ScriptDropdownEntry[] = [];

        // Language-specific scripts
        const langScripts = index[language] || [];
        for (const entry of langScripts) {
            entries.push({ label: entry.name, entry });
        }

        // "all" scripts — prefixed to distinguish
        const allScripts = index["all"] || [];
        for (const entry of allScripts) {
            entries.push({ label: "all/" + entry.name, entry });
        }

        return entries;
    };

    /** Select a library script (loads file content) or switch back to ad-hoc (null). */
    selectScript = (dropdown: ScriptDropdownEntry | null) => {
        if (!dropdown || !dropdown.entry) {
            // Switch to ad-hoc — always enable save (acts as "save as")
            this.state.update((s) => {
                s.selectedScript = null;
                s.dirty = true;
            });
            return;
        }

        const entry = dropdown.entry;
        try {
            const content = nodefs.readFileSync(entry.path, "utf-8");
            this.state.update((s) => {
                s.content = content;
                s.selectedScript = entry.path;
                s.dirty = false;
            });
        } catch {
            // File read failed — stay on current content
        }
    };

    /** Save current script content to library. */
    saveToLibrary = async () => {
        let libraryPath = settings.get("script-library.path");
        if (!libraryPath) {
            const { showLibrarySetupDialog } = await import("../../ui/dialogs/LibrarySetupDialog");
            const result = await showLibrarySetupDialog();
            if (!result) return;
            libraryPath = result;
        }

        const state = this.state.get();

        if (state.selectedScript) {
            // Selected library script — overwrite directly
            try {
                nodefs.writeFileSync(state.selectedScript, state.content, "utf-8");
                this.state.update((s) => { s.dirty = false; });
            } catch (err: any) {
                const { ui } = await import("../../api/ui");
                ui.notify(`Failed to save script: ${err.message}`, "error");
            }
            return;
        }

        // Ad-hoc script — prompt for name and folder
        const language = this.pageModel.state.get().language || "all";
        const options = language !== "all" ? [language, "all"] : ["all"];

        const result = await showInputDialog({
            title: "Save Script to Library",
            message: "Script name:",
            value: "",
            options,
            selectedOption: options[0],
            buttons: ["Save", "Cancel"],
            selectAll: true,
        });

        if (!result || result.button !== "Save" || !result.value.trim()) {
            return;
        }

        const scriptName = result.value.trim();
        const folder = result.selectedOption || options[0];
        const scriptPanelDir = nodepath.join(libraryPath, "script-panel", folder);
        const filePath = nodepath.join(scriptPanelDir, scriptName + ".ts");

        // Create folder if needed
        if (!nodefs.existsSync(scriptPanelDir)) {
            nodefs.mkdirSync(scriptPanelDir, { recursive: true });
        }

        // Check if file already exists
        if (nodefs.existsSync(filePath)) {
            const { showConfirmationDialog } = await import("../../ui/dialogs/ConfirmationDialog");
            const confirmResult = await showConfirmationDialog({
                message: `Script "${scriptName}" already exists in "${folder}/". Overwrite?`,
                buttons: ["Overwrite", "Cancel"],
            });
            if (confirmResult !== "Overwrite") {
                return;
            }
        }

        try {
            nodefs.writeFileSync(filePath, state.content, "utf-8");
            this.state.update((s) => {
                s.selectedScript = filePath;
                s.dirty = false;
            });
        } catch (err: any) {
            const { ui } = await import("../../api/ui");
            ui.notify(`Failed to save script: ${err.message}`, "error");
        }
    };

    /** Find the dropdown entry matching the current selectedScript path. */
    getSelectedDropdownEntry = (entries: ScriptDropdownEntry[]): ScriptDropdownEntry | null => {
        const { selectedScript } = this.state.get();
        if (!selectedScript) return null;
        return entries.find(e => e.entry?.path === selectedScript) ?? null;
    };

    /** Open selected script (or empty page) in a new tab with NavigationPanel rooted at script-panel/. */
    openInTab = async () => {
        const { pagesModel } = await import("../../api/pages");
        const { NavPanelModel } = await import("../../ui/navigation/nav-panel-store");

        const libraryPath = settings.get("script-library.path");
        const scriptPanelDir = libraryPath ? nodepath.join(libraryPath, "script-panel") : "";
        const { selectedScript } = this.state.get();

        if (selectedScript && nodefs.existsSync(selectedScript)) {
            // Open the selected script file, then attach NavPanel
            const page = await pagesModel.openFile(selectedScript);
            if (page && scriptPanelDir) {
                const navPanel = new NavPanelModel(scriptPanelDir, selectedScript);
                // Pre-expand the folder containing the script so it's visible
                const fileDir = nodepath.dirname(selectedScript);
                navPanel.fileExplorerState = {
                    expandedPaths: [scriptPanelDir, fileDir],
                    selectedFilePath: selectedScript,
                };
                navPanel.id = page.state.get().id;
                navPanel.flushSave();
                page.navPanel = navPanel;
                page.state.update((s) => { s.hasNavPanel = true; });
            }
        } else if (scriptPanelDir) {
            // No selected script — open empty page with NavPanel
            pagesModel.addEmptyPageWithNavPanel(scriptPanelDir);
        }
    };
}

interface ScriptPanelProps {
    model: TextFileModel;
}

const UNSAVED_ENTRY: ScriptDropdownEntry = { label: "(unsaved script)", entry: null };

function getDropdownLabel(entry: ScriptDropdownEntry): string {
    return entry.label;
}

export function ScriptPanel({ model }: ScriptPanelProps) {
    const scriptModel = model.script;
    const state = model.script.state.use();

    // Subscribe to library changes for dropdown refresh
    libraryService.state.use();

    if (!state.open) {
        return null;
    }

    const availableScripts = scriptModel.getAvailableScripts();
    const allEntries = [UNSAVED_ENTRY, ...availableScripts];
    const selectedEntry = scriptModel.getSelectedDropdownEntry(availableScripts) ?? UNSAVED_ENTRY;

    return (
        <ScriptPanelRoot
            style={{ height: state.height }}
            onKeyDown={scriptModel.handleKeyDown}
        >
            <Splitter
                type="horizontal"
                initialHeight={state.height}
                borderSized="top"
                onChangeHeight={scriptModel.setHeight}
            />
            <PageToolbar>
                <Button
                    title={state.hasSelection ? "Run Selected Script (F5)" : "Run Script (F5)"}
                    type="icon"
                    size="small"
                    onClick={() => model.runRelatedScript()}
                >
                    <RunIcon />
                </Button>
                {state.hasSelection && (
                    <Button
                        key="run-all_script"
                        type="icon"
                        size="small"
                        title="Run All Script"
                        onClick={() => model.runRelatedScript(true)}
                    >
                        <RunAllIcon />
                    </Button>
                )}
                <ComboSelect
                    className="script-selector"
                    selectFrom={allEntries}
                    getLabel={getDropdownLabel}
                    value={selectedEntry}
                    onChange={(entry?: ScriptDropdownEntry) => scriptModel.selectScript(entry ?? null)}
                />
                <Button
                    title="Save Script to Library"
                    type="icon"
                    size="small"
                    disabled={!state.dirty}
                    onClick={scriptModel.saveToLibrary}
                >
                    <SaveIcon />
                </Button>
                <Button
                    title="Open in New Tab"
                    type="icon"
                    size="small"
                    onClick={scriptModel.openInTab}
                >
                    <OpenFileIcon />
                </Button>
                <FlexSpace />
                <Button
                    title="Close Script Editor"
                    type="icon"
                    size="small"
                    onClick={scriptModel.toggleOpen}
                >
                    <CloseIcon />
                </Button>
            </PageToolbar>
            <Editor
                value={state.content}
                language="typescript"
                onMount={scriptModel.handleEditorDidMount}
                onChange={scriptModel.handleEditorChange}
                theme="custom-dark"
                options={{
                    automaticLayout: true,
                }}
            />
        </ScriptPanelRoot>
    );
}

// Re-export with old names for backward compatibility
export { ScriptPanel as ScriptEditor };
export { ScriptPanelModel as ScriptEditorModel };
export { defaultScriptPanelState as defaultScriptEditorState };
export type { ScriptPanelState as ScriptEditorState };
