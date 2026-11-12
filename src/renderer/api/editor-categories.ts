import { settings } from "./settings";
import type { EditorCategory } from "./settings-schema";
import { boardRegistry, type BoardRegistryChange } from "./boards/board-registry";
import { BoardRoot } from "../../shared/board/board-root";

export type CategoryRef =
    | { kind: "editor"; id: string }
    | { kind: "board"; root: string };

const BOARD_PREFIX = "board:";
const TOP_CATEGORY_ID = "top";

export class EditorCategoriesModel {
    constructor() {
        boardRegistry.subscribe((change) => { void this.onBoardsChanged(change); });
    }

    categories(): EditorCategory[] {
        return settings.get("editor-categories").map((category) => ({ ...category, items: [...category.items] }));
    }

    allRefs(): string[] {
        return this.categories().flatMap((category) => category.items);
    }

    categoryOf(ref: CategoryRef): EditorCategory | undefined {
        const encoded = this.encodeRef(ref);
        return this.categories().find((category) => category.items.includes(encoded));
    }

    encodeRef(ref: CategoryRef): string {
        return ref.kind === "board" ? BOARD_PREFIX + ref.root : ref.id;
    }

    decodeRef(stored: string): CategoryRef {
        return stored.startsWith(BOARD_PREFIX)
            ? { kind: "board", root: stored.slice(BOARD_PREFIX.length) }
            : { kind: "editor", id: stored };
    }

    isRef(value: unknown): value is CategoryRef {
        if (!value || typeof value !== "object") return false;
        const ref = value as { kind?: unknown; id?: unknown; root?: unknown };
        if (ref.kind === "editor") return typeof ref.id === "string" && ref.id.length > 0;
        if (ref.kind === "board") return typeof ref.root === "string" && ref.root.length > 0;
        return false;
    }

    create(name = ""): EditorCategory {
        const category: EditorCategory = { id: crypto.randomUUID(), name, items: [] };
        this.save([...this.categories(), category]);
        return category;
    }

    rename(categoryId: string, name: string): void {
        this.save(this.categories().map((category) =>
            category.id === categoryId ? { ...category, name } : category,
        ));
    }

    remove(categoryId: string): void {
        if (categoryId === TOP_CATEGORY_ID) return;
        this.save(this.categories().filter((category) => category.id !== categoryId));
    }

    move(categoryId: string, targetIndex: number): void {
        if (categoryId === TOP_CATEGORY_ID) return;
        const categories = this.categories();
        const from = categories.findIndex((category) => category.id === categoryId);
        if (from <= 0) return;
        const [category] = categories.splice(from, 1);
        const adjustedIndex = from < targetIndex ? targetIndex - 1 : targetIndex;
        const destination = Math.max(1, Math.min(adjustedIndex, categories.length));
        categories.splice(destination, 0, category);
        this.save(categories);
    }

    assign(ref: CategoryRef, categoryId: string, index?: number): void {
        const encoded = this.encodeRef(ref);
        const categories = this.categories().map((category) => ({
            ...category,
            items: category.items.filter((item) => item !== encoded),
        }));
        const target = categories.find((category) => category.id === categoryId);
        if (!target) return;
        if (index === undefined) target.items.push(encoded);
        else target.items.splice(Math.max(0, Math.min(index, target.items.length)), 0, encoded);
        this.save(categories);
    }

    unassign(ref: CategoryRef): void {
        const encoded = this.encodeRef(ref);
        this.save(this.categories().map((category) => ({
            ...category,
            items: category.items.filter((item) => item !== encoded),
        })));
    }

    moveBoardRef(oldRoot: string, newRoot: string): void {
        const oldKey = BoardRoot.tryFrom(oldRoot)?.key;
        if (!oldKey) return;
        const isOld = (stored: string): boolean => {
            const ref = this.decodeRef(stored);
            return ref.kind === "board" && BoardRoot.tryFrom(ref.root)?.key === oldKey;
        };
        const categories = this.categories();
        if (!categories.some((category) => category.items.some(isOld))) return;
        const newStored = this.encodeRef({ kind: "board", root: newRoot });
        for (const category of categories) {
            category.items = category.items
                .filter((stored) => stored !== newStored)
                .map((stored) => isOld(stored) ? newStored : stored);
        }
        this.save(categories);
    }

    private async onBoardsChanged(change: BoardRegistryChange): Promise<void> {
        const removed = change.removedHere.filter((entry) => entry.origin === "trusted");
        if (!removed.length) return;
        await settings.wait();
        this.prune(removed);
    }

    private prune(removed: BoardRegistryChange["removedHere"]): void {
        const keys = new Set(removed.map((entry) => entry.key));
        const categories = this.categories();
        let changed = false;
        for (const category of categories) {
            const kept = category.items.filter((stored) => {
                const ref = this.decodeRef(stored);
                if (ref.kind !== "board") return true;
                const key = BoardRoot.tryFrom(ref.root)?.key;
                return !key || !keys.has(key) || boardRegistry.isTrusted(ref.root);
            });
            if (kept.length !== category.items.length) {
                category.items = kept;
                changed = true;
            }
        }
        if (changed) this.save(categories);
    }

    private save(categories: EditorCategory[]): void {
        settings.set("editor-categories", categories);
    }
}

export const editorCategories = new EditorCategoriesModel();
