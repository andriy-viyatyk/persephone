import { settings, type EditorCategory } from "../../api/settings";

export type PinnedRef =
    | { kind: "editor"; id: string }
    | { kind: "board"; root: string };

export type EditorCategoryDragData =
    | { kind: "source"; ref: PinnedRef }
    | { kind: "category-item"; categoryId: string; ref: PinnedRef }
    | { kind: "category-block"; categoryId: string };

const BOARD_PREFIX = "board:";

export function encodePin(ref: PinnedRef): string {
    return ref.kind === "board" ? BOARD_PREFIX + ref.root : ref.id;
}

export function decodePin(stored: string): PinnedRef {
    return stored.startsWith(BOARD_PREFIX)
        ? { kind: "board", root: stored.slice(BOARD_PREFIX.length) }
        : { kind: "editor", id: stored };
}

/**
 * A fresh copy of the stored categories. Callers reorder it in place (`splice`) and save it
 * back; handing out the settings array itself would mutate stored state, and saving the same
 * reference back would look like no change.
 */
export function getEditorCategories(): EditorCategory[] {
    return settings.get("editor-categories").map((category) => ({ ...category, items: [...category.items] }));
}

/** Compatibility projection for callers that still render the old flat pinned list. */
export function getPinnedStrings(): string[] {
    return getEditorCategories().flatMap((category) => category.items);
}

export function removePin(ref: PinnedRef): void {
    removeCategoryMembership(ref);
}

export function saveEditorCategories(categories: EditorCategory[]): void {
    settings.set("editor-categories", categories);
}

export function isPinnedRef(value: unknown): value is PinnedRef {
    if (!value || typeof value !== "object") return false;
    const ref = value as { kind?: unknown; id?: unknown; root?: unknown };
    if (ref.kind === "editor") return typeof ref.id === "string" && ref.id.length > 0;
    if (ref.kind === "board") return typeof ref.root === "string" && ref.root.length > 0;
    return false;
}

export function getCategoryForRef(ref: PinnedRef): EditorCategory | undefined {
    const encoded = encodePin(ref);
    return getEditorCategories().find((category) => category.items.includes(encoded));
}

export function createEditorCategory(name = ""): EditorCategory {
    const category: EditorCategory = { id: crypto.randomUUID(), name, items: [] };
    saveEditorCategories([...getEditorCategories(), category]);
    return category;
}

export function renameEditorCategory(categoryId: string, name: string): void {
    saveEditorCategories(getEditorCategories().map((category) =>
        category.id === categoryId ? { ...category, name } : category,
    ));
}

export function deleteEditorCategory(categoryId: string): void {
    if (categoryId === "top") return;
    saveEditorCategories(getEditorCategories().filter((category) => category.id !== categoryId));
}

export function moveCategory(categoryId: string, targetIndex: number): void {
    if (categoryId === "top") return;
    const categories = getEditorCategories();
    const from = categories.findIndex((category) => category.id === categoryId);
    if (from <= 0) return;
    const [category] = categories.splice(from, 1);
    const adjustedIndex = from < targetIndex ? targetIndex - 1 : targetIndex;
    const destination = Math.max(1, Math.min(adjustedIndex, categories.length));
    categories.splice(destination, 0, category);
    saveEditorCategories(categories);
}

export function moveEditorToCategory(ref: PinnedRef, categoryId: string): void {
    const encoded = encodePin(ref);
    const categories = getEditorCategories().map((category) => ({
        ...category,
        items: category.items.filter((item) => item !== encoded),
    }));
    const target = categories.find((category) => category.id === categoryId);
    if (!target) return;
    target.items.push(encoded);
    saveEditorCategories(categories);
}

export function moveCategoryItem(ref: PinnedRef, categoryId: string, index: number): void {
    const encoded = encodePin(ref);
    const categories = getEditorCategories().map((category) => ({
        ...category,
        items: category.items.filter((item) => item !== encoded),
    }));
    const target = categories.find((category) => category.id === categoryId);
    if (!target) return;
    target.items.splice(Math.max(0, Math.min(index, target.items.length)), 0, encoded);
    saveEditorCategories(categories);
}

export function removeCategoryMembership(ref: PinnedRef): void {
    const encoded = encodePin(ref);
    saveEditorCategories(getEditorCategories().map((category) => ({
        ...category,
        items: category.items.filter((item) => item !== encoded),
    })));
}
