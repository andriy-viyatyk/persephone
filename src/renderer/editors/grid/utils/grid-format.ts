import { EditorId } from "../../../../shared/editor-ids";

export type GridFormat = "json" | "csv" | "jsonl";
export type GridEditorId = typeof EditorId.gridJson | typeof EditorId.gridCsv | typeof EditorId.gridJsonl;

export function formatFromEditorId(id: GridEditorId): GridFormat {
    switch (id) {
        case EditorId.gridCsv:
            return "csv";
        case EditorId.gridJsonl:
            return "jsonl";
        case EditorId.gridJson:
        default:
            return "json";
    }
}
