import { BaseEvent } from "./BaseEvent";
import type { MenuItem } from "./MenuItem";

/** Generic context menu event. T defines the target that was right-clicked. */
export class ContextMenuEvent<T> extends BaseEvent {
    readonly target: T;
    readonly items: MenuItem[];

    constructor(target: T, items: MenuItem[] = []) {
        super();
        this.target = target;
        this.items = items;
    }

    /** Add a menu item. */
    addItem(item: MenuItem): void {
        this.items.push(item);
    }

    /** Add a menu item with a separator line above it. */
    addGroupItem(item: MenuItem): void {
        this.items.push({ ...item, startGroup: true });
    }
}
