import { guideUrl } from "../../../shared/guides/guide-links";
import { editorRegistry } from "../../editors/base/editorRegistry";

export function withEditorGuideHelp(editorId: string, baseHelp: string): string {
    const guidePath = editorRegistry.getById(editorId)?.guidePath
        ?? (editorId.startsWith("board-editor:") ? editorRegistry.getById("board-view")?.guidePath : undefined);
    if (!guidePath) return baseHelp;

    return `${baseHelp}\n\nGuide: read ${guideCallPath(guidePath)} for the page text; show it with ${guideUrl(guidePath)}.`;
}

function guideCallPath(path: string): string {
    return path.split("/").every(isIdentifier)
        ? `guides.${path.split("/").join(".")}`
        : `guides[${JSON.stringify(path)}]`;
}

function isIdentifier(value: string): boolean {
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value);
}
