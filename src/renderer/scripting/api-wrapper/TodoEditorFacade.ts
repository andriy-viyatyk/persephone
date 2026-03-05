import type { TodoViewModel } from "../../editors/todo/TodoViewModel";
import type { TodoItem, TodoTag } from "../../editors/todo/todoTypes";

/**
 * Safe facade around TodoViewModel for script access.
 * Implements the ITodoEditor interface from api/types/todo-editor.d.ts.
 *
 * - Items are read-only snapshots (ITodoItem projection of TodoItem)
 * - `done` is exposed as `completed`, `tag: null` becomes `""`
 * - Delete operations skip confirmation dialogs
 */
export class TodoEditorFacade {
    constructor(private readonly vm: TodoViewModel) {}

    get items(): Array<{ readonly id: string; readonly title: string; readonly completed: boolean; readonly list: string; readonly tag: string }> {
        return this.vm.state.get().data.items.map(mapItem);
    }

    get lists(): string[] {
        return this.vm.state.get().data.lists;
    }

    get tags(): Array<{ readonly name: string; readonly color: string }> {
        return this.vm.state.get().data.tags.map(mapTag);
    }

    addItem(title: string): void {
        this.vm.addItem(title);
    }

    toggleItem(id: string): void {
        this.vm.toggleItem(id);
    }

    deleteItem(id: string): void {
        this.vm.deleteItem(id, true);
    }

    updateItemTitle(id: string, title: string): void {
        this.vm.updateItemTitle(id, title);
    }

    addList(name: string): boolean {
        return this.vm.addList(name);
    }

    renameList(oldName: string, newName: string): boolean {
        return this.vm.renameList(oldName, newName);
    }

    deleteList(name: string): void {
        this.vm.deleteList(name, true);
    }

    addTag(name: string): boolean {
        return this.vm.addTag(name);
    }
}

/** Map internal TodoItem → ITodoItem. */
function mapItem(item: TodoItem) {
    return {
        id: item.id,
        title: item.title,
        completed: item.done,
        list: item.list,
        tag: item.tag ?? "",
    };
}

/** Map internal TodoTag → ITodoTag. */
function mapTag(tag: TodoTag) {
    return {
        name: tag.name,
        color: tag.color,
    };
}
