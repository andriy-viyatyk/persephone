import { TCellRendererProps } from "./avGridTypes";
import { CellInput } from "./CellInput";
import { CellSelect } from "./CellSelect";

function DefaultTextEdit({ model }: TCellRendererProps) {
    const { value, columnKey, dontSelect } = model.state.use((s) => s.cellEdit);

    if (!columnKey) return null;

    return (
        <CellInput
            name="avgrid-cell-text"
            value={value ?? ""}
            dontSelect={dontSelect}
            onChange={(v) =>
                model.state.update((s) => {
                    s.cellEdit.value = v;
                    s.cellEdit.changed = true;
                })
            }
        />
    );
}

function DefaultOptionsEdit({ model, col }: TCellRendererProps) {
    const { value, columnKey } = model.state.use((s) => s.cellEdit);
    const column = model.data.columns[col];

    if (!columnKey || !column?.options) return null;

    return (
        <CellSelect
            name="avgrid-cell-options"
            value={value}
            options={column.options}
            onChange={(v) => {
                model.state.update((s) => {
                    s.cellEdit.value = v;
                    s.cellEdit.changed = true;
                });
                model.models.editing.closeEdit(true, true);
            }}
            onCancel={() => model.models.editing.closeEdit(false)}
        />
    );
}

export function DefaultEditFormater(props: TCellRendererProps) {
    const { model, col } = props;
    const column = model.data.columns[col];

    if (column?.options) {
        return <DefaultOptionsEdit {...props} />;
    }

    return <DefaultTextEdit {...props} />;
}
