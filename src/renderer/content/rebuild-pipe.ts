import type { IContentPipe } from "../api/types/io.pipe";
import { ContentPipe } from "./ContentPipe";
import { FileProvider } from "./providers/FileProvider";
import { HttpProvider } from "./providers/HttpProvider";
import { ArchiveTransformer } from "./transformers/ArchiveTransformer";
import "./builtin-schemes";
import { resolveRegisteredSourcePath } from "./scheme-registry";

/**
 * Rebuild a content pipe from a source path alone.
 *
 * This is the FALLBACK for paths that don't carry a live pipe — a restored editor, a
 * cross-window move, or an editor constructed straight from a path. The normal route is
 * Layer 2 (`content/resolvers.ts`), which builds the pipe from the link before the editor
 * exists and is the only route that can carry non-reconstructible detail (HTTP method,
 * headers, body). Prefer `createPipeFromDescriptor(pipeDescriptor)` when a persisted
 * descriptor is available; reach for this only when it isn't.
 *
 * Resolution order:
 * - a registered scheme                   → the registry's source-path pipe
 * - `http://…` / `https://…`            → `HttpProvider` fallback
 * - `archive.zip!path/inside.txt`       → `FileProvider` + `ArchiveTransformer` fallback
 * - anything else                       → `FileProvider` fallback
 *
 * Unknown schemes retain the final shape guess. This remains asynchronous so registered
 * resolvers may do their own async work, and `createPipeFromDescriptor(pipeDescriptor)` remains
 * preferred whenever a persisted descriptor is available.
 */
export async function pipeFromSourcePath(path: string): Promise<IContentPipe> {
    const registered = await resolveRegisteredSourcePath(path);
    if (registered) return registered;
    if (path.startsWith("http://") || path.startsWith("https://")) {
        return new ContentPipe(new HttpProvider(path));
    }
    const bangIndex = path.indexOf("!");
    if (bangIndex >= 0) {
        const archivePath = path.slice(0, bangIndex);
        const entryPath = path.slice(bangIndex + 1);
        return new ContentPipe(
            new FileProvider(archivePath),
            [new ArchiveTransformer(archivePath, entryPath)],
        );
    }
    return new ContentPipe(new FileProvider(path));
}
