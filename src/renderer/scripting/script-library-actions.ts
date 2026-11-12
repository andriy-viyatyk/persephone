import { t } from "../../shared/i18n/t";
import { errMessage } from "../../shared/utils";
import { fs } from "../api/fs";
import { libraryService, type ScriptPanelEntry } from "../api/library-service";
import { settings } from "../api/settings";
import { ui } from "../api/ui";
import { DialogButton, dialogButton } from "../ui/dialogs/dialog-buttons";
import { showInputDialog } from "../ui/dialogs/InputDialog";
import { fpJoin } from "../core/utils/file-path";
import type { IListBoxItem } from "../uikit/ListBox/types";

export interface ScriptPanelState {
    content: string;
    selectedScript: string | null;
    dirty: boolean;
}

export interface ScriptDropdownEntry extends IListBoxItem {
    value: string;
    label: string;
    entry: ScriptPanelEntry | null;
}

export type UpdateScriptPanelState = (update: (state: ScriptPanelState) => void) => void;

export function getAvailableScripts(language: string): ScriptDropdownEntry[] {
    libraryService.ensureInitialized();
    const index = libraryService.scriptPanelIndex;
    const entries: ScriptDropdownEntry[] = [];
    for (const entry of index[language] || []) {
        entries.push({ value: entry.path, label: entry.name, entry });
    }
    for (const entry of index.all || []) {
        entries.push({ value: entry.path, label: "all/" + entry.name, entry });
    }
    return entries;
}

export function getSelectedDropdownEntry(
    state: Pick<ScriptPanelState, "selectedScript">,
    entries: ScriptDropdownEntry[],
): ScriptDropdownEntry | null {
    if (!state.selectedScript) return null;
    return entries.find((entry) => entry.entry?.path === state.selectedScript) ?? null;
}

export async function selectScript(
    dropdown: ScriptDropdownEntry | null,
    update: UpdateScriptPanelState,
): Promise<void> {
    const entry = dropdown?.entry;
    if (!entry) {
        update((next) => {
            next.selectedScript = null;
            next.dirty = true;
        });
        return;
    }

    try {
        const content = await fs.read(entry.path, "utf-8");
        update((next) => {
            next.content = content;
            next.selectedScript = entry.path;
            next.dirty = false;
        });
    } catch {
        // Keep the current script when a library entry cannot be read.
    }
}

export async function saveScriptToLibrary(
    state: ScriptPanelState,
    language: string | undefined,
    update: UpdateScriptPanelState,
): Promise<void> {
    let libraryPath = settings.get("script-library.path");
    if (!libraryPath) {
        const { showLibrarySetupDialog } = await import("../ui/dialogs/LibrarySetupDialog");
        const result = await showLibrarySetupDialog();
        if (!result) return;
        libraryPath = result;
    }

    if (state.selectedScript) {
        try {
            await fs.write(state.selectedScript, state.content, "utf-8");
            update((next) => { next.dirty = false; });
        } catch (error) {
            ui.notify(t("editors.failedToSaveScript", { error: errMessage(error) }), "error");
        }
        return;
    }

    const scriptLanguage = language || "all";
    const options = scriptLanguage !== "all" ? [scriptLanguage, "all"] : ["all"];
    const result = await showInputDialog({
        title: t("editors.saveScriptToLibrary"),
        message: t("editors.scriptName"),
        value: "",
        options,
        selectedOption: options[0],
        buttons: [dialogButton(DialogButton.save), dialogButton(DialogButton.cancel)],
        selectAll: true,
    });
    if (!result || result.button !== DialogButton.save || !result.value.trim()) return;

    const scriptName = result.value.trim();
    const folder = result.selectedOption || options[0];
    const scriptPanelDir = fpJoin(libraryPath, "script-panel", folder);
    const filePath = fpJoin(scriptPanelDir, `${scriptName}.ts`);
    if (!(await fs.exists(scriptPanelDir))) await fs.mkdir(scriptPanelDir);

    if (await fs.exists(filePath)) {
        const { showConfirmationDialog } = await import("../ui/dialogs/ConfirmationDialog");
        const confirmResult = await showConfirmationDialog({
            message: t("editors.scriptAlreadyExists", { scriptName, folder }),
            buttons: [dialogButton(DialogButton.overwrite), dialogButton(DialogButton.cancel)],
        });
        if (confirmResult !== "Overwrite") return;
    }

    try {
        await fs.write(filePath, state.content, "utf-8");
        update((next) => {
            next.selectedScript = filePath;
            next.dirty = false;
        });
    } catch (error) {
        ui.notify(t("editors.failedToSaveScript", { error: errMessage(error) }), "error");
    }
}

export async function openScriptInTab(
    state: Pick<ScriptPanelState, "selectedScript">,
    callbacks: {
        openPath(filePath: string, libraryRoot: string): Promise<void>;
        openLibraryRoot(libraryRoot: string): void;
    },
): Promise<void> {
    const libraryPath = settings.get("script-library.path");
    const scriptPanelDir = libraryPath ? fpJoin(libraryPath, "script-panel") : "";
    if (state.selectedScript && await fs.exists(state.selectedScript)) {
        await callbacks.openPath(state.selectedScript, scriptPanelDir);
    } else if (scriptPanelDir) {
        callbacks.openLibraryRoot(scriptPanelDir);
    }
}
