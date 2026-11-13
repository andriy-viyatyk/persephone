import { errMessage } from "../../../../shared/utils";
import type { Column } from "../../../uikit/DataGrid";
import type { CsvCodecOptions, GridCodec } from "./GridCodec";

export const jsonlCodec: GridCodec<CsvCodecOptions> = {
    parse(content) {
        const rows: unknown[] = [];
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            try {
                const parsed: unknown = JSON.parse(line);
                rows.push(
                    typeof parsed === "object" && parsed !== null
                        ? parsed
                        : { value: parsed },
                );
            } catch (error) {
                return { rows, error: new Error(`Line ${i + 1}: ${errMessage(error)}`) };
            }
        }
        return { rows };
    },
    serialize(rows: readonly unknown[], _columns: readonly Column[]): string {
        return rows.map((row) => JSON.stringify(row)).join("\n");
    },
};
