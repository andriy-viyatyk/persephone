export type TreeDropMode = "copy" | "move";

export function treeDropMode(
    sameTree: boolean,
    modifiers?: Pick<DragEvent, "ctrlKey" | "shiftKey">,
): TreeDropMode {
    if (modifiers?.shiftKey) return "move";
    if (modifiers?.ctrlKey) return "copy";
    return sameTree ? "move" : "copy";
}
