import type { IContentPipe } from "../api/types/io.pipe";
import { ContentPipe } from "./ContentPipe";
import { FileProvider } from "./providers/FileProvider";
import "./builtin-schemes";
import { createPipeFromDescriptor } from "./registry";
import { resolveUrlToPipeDescriptor } from "./link-utils";
import { isSchemeRegistered, resolveRegisteredSourcePath, schemeOf } from "./scheme-registry";
import type { ILinkData } from "../../shared/link-data";

export class UnresolvableLinkError extends Error {
    constructor(
        readonly scheme: string | undefined,
        readonly registered: boolean,
    ) {
        super("The link cannot be resolved to content.");
        this.name = "UnresolvableLinkError";
    }
}

/**
 * Resolve a link to a content pipe — the canonical link→pipe route.
 *
 * Resolution order:
 * - a registered scheme                   → the registry's source-path pipe
 * - anything `resolveUrlToPipeDescriptor` recognises → that descriptor
 *   (`data:`, `http(s)://`, an archive path, a plain file path)
 * - anything else                         → per `options.unknownScheme`
 *
 * `unknownScheme` is the only behavioural difference between the two callers. `"reject"` is
 * right for a link a board named: an unresolvable link is an error the caller must see, not a
 * `FileProvider` pointed at a string that is not a path. `"file"` preserves the shape guess
 * `pipeFromSourcePath` has always made — see its own note below.
 *
 * Asynchronous so registered resolvers may do their own async work.
 */
export async function pipeFromLink(
    link: string,
    options: {
        unknownScheme?: "reject" | "file";
        sessionHandle?: string;
    } = { unknownScheme: "reject" },
): Promise<IContentPipe> {
    const registered = await resolveRegisteredSourcePath(link);
    if (registered) return registered;

    const descriptor = resolveUrlToPipeDescriptor(link, {
        url: link,
        sessionHandle: options.sessionHandle,
    });
    if (descriptor) return createPipeFromDescriptor(descriptor);

    if (options.unknownScheme === "file") return new ContentPipe(new FileProvider(link));
    const scheme = schemeOf(link);
    throw new UnresolvableLinkError(scheme, scheme ? isSchemeRegistered(scheme) : false);
}

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
 * Keeps the final `FileProvider` shape guess for an unrecognised path, which is what a
 * restored editor holding an exotic path relies on.
 */
export async function pipeFromSourcePath(path: string): Promise<IContentPipe> {
    return pipeFromLink(path, { unknownScheme: "file" });
}

export interface PersistedSourceLink {
    href?: string;
    pipeDescriptor?: ILinkData["pipeDescriptor"];
}

/** Rebuild a pipe from persisted source data, preserving provider configuration when present. */
export async function pipeFromPersistedSource(
    sourceLink: PersistedSourceLink | undefined,
    fallbackPath: string | undefined,
    options: { unknownScheme?: "reject" | "file"; sessionHandle?: string } = {},
): Promise<IContentPipe> {
    if (sourceLink?.pipeDescriptor) return createPipeFromDescriptor(sourceLink.pipeDescriptor);
    const source = sourceLink?.href || fallbackPath;
    if (!source) throw new Error("No persisted content source is available.");
    return pipeFromLink(source, {
        unknownScheme: options.unknownScheme ?? "reject",
        sessionHandle: options.sessionHandle,
    });
}
