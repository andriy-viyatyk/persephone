import { FileProvider } from "../../content/providers/FileProvider";
import { HttpProvider } from "../../content/providers/HttpProvider";
import { ArchiveTransformer } from "../../content/transformers/ArchiveTransformer";
import { DecryptTransformer } from "../../content/transformers/DecryptTransformer";
import { ArchiveTreeProvider } from "../../content/tree-providers/ArchiveTreeProvider";
import { createPipe } from "../../content/ContentPipe";
import { registerProvider as registerProviderInRegistry } from "../../content/registry";
import { registerScheme as registerSchemeInRegistry } from "../../content/scheme-registry";
import { createLinkData, linkToLinkData } from "../../../shared/link-data";

/**
 * Create the `io` namespace object exposed to scripts.
 *
 * Provides provider/transformer constructors, tree providers,
 * pipe assembly, session-scoped provider/scheme registrations, and ILinkData
 * helper functions for the link pipeline.
 */
export function createIoNamespace() {
    const registerProvider = (
        type: string,
        factory: Parameters<typeof registerProviderInRegistry>[1],
    ): void => {
        registerProviderInRegistry(type, factory, { origin: "script" });
    };
    const registerScheme = (
        scheme: string,
        hooks: Parameters<typeof registerSchemeInRegistry>[1],
    ): void => {
        registerSchemeInRegistry(scheme, hooks, { origin: "script" });
    };

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

        // Session-scoped registry contributions
        registerProvider,
        registerScheme,

        // Link pipeline helpers
        createLinkData,
        linkToLinkData,
    };
}
