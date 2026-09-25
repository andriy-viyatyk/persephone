import { CapabilityError } from "./capability-bus";

export type EditCapabilityId = "image.edit" | "diagram.edit";

const missingEditCapabilityMessages: Record<EditCapabilityId, string> = {
    "image.edit": "No image editor is registered. Enable the board in Tools & Editors or install a replacement.",
    "diagram.edit": "No diagram editor is registered. Enable the board in Tools & Editors or install a replacement.",
};

export function getMissingEditCapabilityMessage(
    error: unknown,
    capability: EditCapabilityId,
): string | undefined {
    if (!(error instanceof CapabilityError) || error.code !== "no-handler") return undefined;
    return missingEditCapabilityMessages[capability];
}
