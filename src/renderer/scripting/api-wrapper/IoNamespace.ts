import { FileProvider } from "../../content/providers/FileProvider";
import { HttpProvider } from "../../content/providers/HttpProvider";
import { ZipTransformer } from "../../content/transformers/ZipTransformer";
import { DecryptTransformer } from "../../content/transformers/DecryptTransformer";
import { createPipe } from "../../content/ContentPipe";
import { RawLinkEvent, OpenLinkEvent } from "../../api/events/events";

/**
 * Create the `io` namespace object exposed to scripts.
 *
 * Provides provider/transformer constructors, pipe assembly,
 * and event constructors for the link pipeline.
 */
export function createIoNamespace() {
    return {
        // Providers
        FileProvider,
        HttpProvider,

        // Transformers
        ZipTransformer,
        DecryptTransformer,

        // Pipe assembly
        createPipe,

        // Event constructors
        RawLinkEvent,
        OpenLinkEvent,
    };
}
