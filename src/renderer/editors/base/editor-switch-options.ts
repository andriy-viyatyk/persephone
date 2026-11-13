import { EditorId } from "../../../shared/editor-ids";
import { fpBasename, fpExtname } from "../../core/utils/file-path";
import { getLanguageByExtension } from "../../core/utils/language-mapping";
import { editorCatalog, type EditorCandidate } from "./editor-catalog";
import { editorRegistry } from "./editorRegistry";
import { englishMessage, t } from "../../../shared/i18n/t";
import type { MessageKey } from "../../../shared/i18n/en";

/** Compatible targets for opening a file, with the resolved default shown first. */
export function getFileOpenEditorOptions(path: string): EditorCandidate[] {
    const fileName = fpBasename(path);
    const language = getLanguageByExtension(fpExtname(fileName))?.id ?? "plaintext";
    const switchOptions = editorRegistry.getSwitchOptions(language, fileName);
    const candidates = editorCatalog.candidatesForFile(path);
    const defaultId = editorCatalog.resolveFile(path) ?? EditorId.monaco;
    const defaultCandidate = candidates.find(({ id }) => id === defaultId);
    const defaultLabel = switchOptions.options.includes(defaultId)
        ? switchOptions.getOptionLabel(defaultId)
        : defaultCandidate?.label ?? editorRegistry.getById(defaultId)?.name ?? defaultId;
    const defaultOption: EditorCandidate = defaultCandidate?.boardRoot
        ? {
            ...defaultCandidate,
            label: englishMessage("shell.defaultBoardEditor", { name: defaultCandidate.label }),
            labelKey: "shell.defaultBoardEditor",
            labelParams: { name: defaultCandidate.label },
            displayLabel: t("shell.defaultBoardEditor", { name: defaultCandidate.displayLabel ?? defaultCandidate.label }),
        }
        : {
            id: defaultId,
            label: englishMessage("shell.defaultEditor", { name: defaultLabel }),
            labelKey: "shell.defaultEditor",
            labelParams: { name: defaultLabel },
            transition: defaultCandidate?.transition ?? "rebuild",
        };
    const options = candidates.filter(({ id }) => id !== defaultId).map((candidate) => {
        if (!candidate.boardRoot) return candidate;
        const name = candidate.label;
        return {
            ...candidate,
            label: englishMessage("shell.boardName", { name }),
            labelKey: "shell.boardName" as MessageKey,
            labelParams: { name },
            displayLabel: t("shell.boardName", { name: candidate.displayLabel ?? name }),
        };
    });
    return [defaultOption, ...options];
}
