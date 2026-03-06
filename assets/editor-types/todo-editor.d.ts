/**
 * ITodoEditor — scripting interface for the Todo editor.
 *
 * Access via `await page.asTodo()` on `.todo.json` pages.
 *
 * @example
 * const todo = await page.asTodo();
 * todo.addList("Shopping");
 * todo.addItem("Buy milk");
 */
export interface ITodoEditor {
    /** All items (complete data, not filtered by UI). */
    readonly items: ITodoItem[];

    /** All list names. */
    readonly lists: string[];

    /** All tag definitions. */
    readonly tags: ITodoTag[];

    /** Add a new item to the currently selected list. */
    addItem(title: string): void;

    /** Toggle item completion. */
    toggleItem(id: string): void;

    /** Delete an item by ID. */
    deleteItem(id: string): void;

    /** Update item title. */
    updateItemTitle(id: string, title: string): void;

    /** Add a new list. Returns false if name is empty or already exists. */
    addList(name: string): boolean;

    /** Rename a list. Returns false if name conflict. */
    renameList(oldName: string, newName: string): boolean;

    /** Delete a list and all its items. */
    deleteList(name: string): void;

    /** Add a new tag. Returns false if name is empty or already exists. */
    addTag(name: string): boolean;

    /** Select a list by name. Empty string selects "All". */
    selectList(name: string): void;

    /** Select a tag filter by name. Empty string selects "All Tags". */
    selectTag(name: string): void;

    /** Set search filter text. */
    setSearch(text: string): void;

    /** Clear search filter. */
    clearSearch(): void;
}

/** A single todo item. */
export interface ITodoItem {
    readonly id: string;
    readonly title: string;
    readonly completed: boolean;
    readonly list: string;
    /** Tag name, or empty string if no tag. */
    readonly tag: string;
}

/** A tag definition with name and color. */
export interface ITodoTag {
    readonly name: string;
    /** Hex color, or empty string if no color. */
    readonly color: string;
}
