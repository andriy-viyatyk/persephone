import type { IContentPipe } from "../api/types/io.pipe";
import { mimeTypeForPath } from "../../shared/mime-types";

/** Derive the response MIME from the logical pipe's display/source name. */
export function contentTypeForPipe(pipe: IContentPipe): string {
    const hasArchiveStage = pipe.transformers.some((transformer) => transformer.type === "archive");
    const name = hasArchiveStage
        ? (pipe.logicalPath === pipe.provider.sourceUrl ? "" : pipe.logicalPath)
        : pipe.displayName || pipe.provider.sourceUrl;
    return mimeTypeForPath(name);
}
