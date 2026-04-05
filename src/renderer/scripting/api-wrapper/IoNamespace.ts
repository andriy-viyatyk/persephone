import { FileProvider } from "../../content/providers/FileProvider";
import { HttpProvider } from "../../content/providers/HttpProvider";
import { ArchiveTransformer } from "../../content/transformers/ArchiveTransformer";
import { DecryptTransformer } from "../../content/transformers/DecryptTransformer";
import { ArchiveTreeProvider } from "../../content/tree-providers/ArchiveTreeProvider";
import { createPipe } from "../../content/ContentPipe";
import { RawLinkEvent, OpenLinkEvent, OpenContentEvent } from "../../api/events/events";

/**
 * Create the `io` namespace object exposed to scripts.
 *
 * Provides provider/transformer constructors, tree providers,
 * pipe assembly, and event constructors for the link pipeline.
 */
export function createIoNamespace() {
    return {
        // Providers
        FileProvider,
        HttpProvider,

        // Transformers
        ArchiveTransformer,
        DecryptTransformer,

        // Tree providers
        ArchiveTreeProvider,

        // Pipe assembly
        createPipe,

        // Event constructors
        RawLinkEvent,
        OpenLinkEvent,
        OpenContentEvent,
    };
}
