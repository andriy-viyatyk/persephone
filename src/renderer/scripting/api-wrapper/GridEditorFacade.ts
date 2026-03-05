import type { GridViewModel } from "../../editors/grid/GridViewModel";

/**
 * Safe facade around GridViewModel for script access.
 * Implements the IGridEditor interface from api/types/grid-editor.d.ts.
 *
 * - `columns` is a minimal projection (key + name only)
 * - Mutation methods trigger content save automatically via GridViewModel
 */
export class GridEditorFacade {
    constructor(private readonly vm: GridViewModel) {}

    get rows(): any[] {
        return this.vm.state.get().rows;
    }

    get columns(): Array<{ readonly key: string; readonly name: string }> {
        return this.vm.state.get().columns.map((c) => ({
            key: String(c.key),
            name: c.name,
        }));
    }

    get rowCount(): number {
        return this.vm.state.get().rows.length;
    }

    editCell(columnKey: string, rowKey: string, value: any): void {
        this.vm.editRow(columnKey, rowKey, value);
    }

    addRows(count = 1, insertIndex?: number): any[] {
        return this.vm.onAddRows(count, insertIndex);
    }

    deleteRows(rowKeys: string[]): void {
        this.vm.onDeleteRows(rowKeys);
    }

    addColumns(count = 1, insertBeforeKey?: string): Array<{ readonly key: string; readonly name: string }> {
        const cols = this.vm.onAddColumns(count, insertBeforeKey);
        return cols.map((c) => ({ key: String(c.key), name: c.name }));
    }

    deleteColumns(columnKeys: string[]): void {
        this.vm.onDeleteColumns(columnKeys);
    }

    setSearch(text: string): void {
        this.vm.setSearch(text);
    }

    clearSearch(): void {
        this.vm.clearSearch();
    }
}
