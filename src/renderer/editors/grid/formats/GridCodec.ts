import type { Column } from "../../../uikit/DataGrid";
import { errMessage } from "../../../../shared/utils";

export interface GridParseResult {
    rows: unknown;
    error?: Error;
}

export interface CsvCodecOptions {
    csvDelimiter: string;
    csvWithColumns: boolean;
}

export interface GridCodec<Options> {
    parse(content: string, options: Options): GridParseResult;
    serialize(rows: readonly unknown[], columns: readonly Column[], options: Options): string;
    detectOptions?(content: string): Partial<Options>;
}

export function toGridCodecError(error: unknown): Error {
    return error instanceof Error ? error : new Error(errMessage(error));
}
