import { CapabilityError } from "./capability-bus";
import { errMessage } from "../../shared/utils";
import type { CapabilityPageResult } from "./types/capabilities";

export type EditCapabilityId = "image.edit" | "diagram.edit" | "theme.edit";

export function isCapabilityErrorWithCode(
    error: unknown,
    code: CapabilityError["code"],
): error is CapabilityError {
    return error instanceof CapabilityError && error.code === code;
}

const missingEditCapabilityMessages: Record<EditCapabilityId, string> = {
    "image.edit": "No image editor is registered. Enable the board in Tools & Editors or install a replacement.",
    "diagram.edit": "No diagram editor is registered. Enable the board in Tools & Editors or install a replacement.",
    "theme.edit": "The Theme Editor board is not installed. Search for and install the Theme Editor board in Tools & Editors.",
};

export function getMissingEditCapabilityMessage(
    error: unknown,
    capability: EditCapabilityId,
): string | undefined {
    if (!isCapabilityErrorWithCode(error, "no-handler")) return undefined;
    return missingEditCapabilityMessages[capability];
}

export async function openImageForEdit(options: {
    dataUrl: string;
    mimeType?: string;
    title: string;
}): Promise<CapabilityPageResult> {
    const [{ app }, { getImageDimensions }] = await Promise.all([
        import("./app"),
        import("../editors/shared/image-export"),
    ]);
    const dimensions = await getImageDimensions(options.dataUrl);
    const title = /\.excalidraw$/i.test(options.title)
        ? options.title
        : `${options.title}.excalidraw`;
    return app.capabilities.invoke("image.edit", {
        dataUrl: options.dataUrl,
        ...(options.mimeType !== undefined ? { mimeType: options.mimeType } : {}),
        naturalWidth: dimensions.width,
        naturalHeight: dimensions.height,
        title,
    });
}

/** Report an image/diagram edit failure once, keeping missing-handler failures as warnings. */
export function notifyEditCapabilityFailure(
    error: unknown,
    capability: EditCapabilityId,
    fallbackMessage: string,
): boolean {
    const message = getMissingEditCapabilityMessage(error, capability);
    void import("./ui").then(({ ui }) => {
        ui.notify(message ?? `${fallbackMessage}: ${errMessage(error)}`, message ? "warning" : "error");
    }).catch((reportError: unknown) => {
        console.error(`Failed to report ${capability} failure: ${errMessage(reportError)}`);
    });
    return true;
}
