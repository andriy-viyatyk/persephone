import type { CsvCodecOptions, GridCodec } from "./GridCodec";
import { parseObject } from "../../../core/utils/parse-utils";
import type { Column } from "../../../uikit/DataGrid";
import { toGridCodecError } from "./GridCodec";

export const jsonCodec: GridCodec<CsvCodecOptions> = {
    parse(content) {
        let error: Error | undefined;
        const rows = parseObject(content, (caught) => {
            error = toGridCodecError(caught);
        });
        return { rows, error };
    },
    serialize(rows: readonly unknown[], _columns: readonly Column[]): string {
        return JSON.stringify(rows, null, 4);
    },
};
