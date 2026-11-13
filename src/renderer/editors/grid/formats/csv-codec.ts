import type { Column } from "../../../uikit/DataGrid";
import { csvToRecords } from "../../../core/utils/csv-utils";
import { columnLetters } from "../utils/grid-utils";
import type { CsvCodecOptions, GridCodec } from "./GridCodec";
import { toGridCodecError } from "./GridCodec";
import { rowsToCsvText } from "../../../uikit/DataGrid";

export type { CsvCodecOptions } from "./GridCodec";

export const csvCodec: GridCodec<CsvCodecOptions> = {
    parse(content, options) {
        let error: Error | undefined;
        let rows: string[][] | Record<string, string>[] = csvToRecords(
            content,
            options.csvWithColumns,
            options.csvDelimiter,
            (caught) => { error = toGridCodecError(caught); },
        );
        if (Array.isArray(rows) && !options.csvWithColumns) {
            const headerlessRows = rows as string[][];
            const keys = columnLetters(
                headerlessRows.reduce((max, row) => Math.max(max, row.length), 0),
            );
            rows = headerlessRows.map((row) => {
                const record: Record<string, string> = {};
                row.forEach((value, index) => {
                    record[keys[index]] = value;
                });
                return record;
            });
        }
        return { rows, error };
    },
    serialize(rows: readonly unknown[], columns: readonly Column[], options): string {
        return rowsToCsvText(rows, [...columns], options.csvWithColumns, options.csvDelimiter);
    },
    detectOptions(content) {
        const firstLine = content.split("\n").slice(0, 5).join("") || "";
        const delimiters = [",", ";", "\t", "|"];
        let maxCount = 0;
        let detected = ",";
        for (const delimiter of delimiters) {
            const count = (firstLine.match(new RegExp("\\" + delimiter, "g")) || []).length;
            if (count > maxCount) {
                maxCount = count;
                detected = delimiter;
            }
        }
        return { csvDelimiter: detected };
    },
};
