import type { IContentPipe } from "../api/types/io.pipe";
import { mimeTypeForPath } from "../../shared/mime-types";

/** Derive the response MIME from the logical pipe's display/source name. */
export function contentTypeForPipe(pipe: IContentPipe): string {
    const archiveTransformer = pipe.transformers.find((transformer) => transformer.type === "archive");
    const entryPath = archiveTransformer?.config.entryPath;
    const name = typeof entryPath === "string" ? entryPath : pipe.displayName || pipe.provider.sourceUrl;
    return mimeTypeForPath(name);
}
