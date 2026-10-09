import type { IDialogViewData } from "../../../ui/dialogs/dialog-view-registry";
import type { IAiVisionDescriptor, IAiVisible } from "ai-vision";
import { normalizeDialogButton, type DialogButtonDefinition, type DialogButtonInput } from "../../../ui/dialogs/dialog-buttons";

export type DialogEntry = IDialogViewData;

export type DialogAdapter = IAiVisible & {
    readonly entry: DialogEntry;
    readonly title?: string;
    readonly message?: string;
    readonly buttons: readonly string[];
    readonly buttonIds?: readonly string[];
    click(button: string): Promise<unknown>;
    cancel(): Promise<undefined>;
};

export function dialogState<T>(entry: DialogEntry): T {
    return entry.model.state.get() as T;
}

export function modelWith<T>(entry: DialogEntry): T {
    return entry.model as unknown as T;
}

export function requireButton(buttons: readonly string[], button: string): void {
    const matches = buttons.filter((candidate) => candidate === button);
    if (matches.length === 0) throw new Error(`Unknown or unavailable dialog button ${JSON.stringify(button)}.`);
    if (matches.length > 1) throw new Error(`Dialog button ${JSON.stringify(button)} is ambiguous.`);
}

export function resolveDialogButton(buttons: readonly DialogButtonInput[], requested: string): DialogButtonDefinition {
    const definitions = buttons.map(normalizeDialogButton);
    const idMatches = definitions.filter(({ id }) => id === requested);
    if (idMatches.length > 1) throw new Error(`Dialog button id ${JSON.stringify(requested)} is duplicated.`);
    const matches = idMatches.length ? idMatches : definitions.filter(({ label }) => label === requested);
    if (matches.length === 0) throw new Error(`Unknown or unavailable dialog button ${JSON.stringify(requested)}.`);
    if (matches.length > 1) throw new Error(`Dialog button label ${JSON.stringify(requested)} is ambiguous.`);
    return matches[0];
}

export function descriptor(
    kind: string,
    summary: string,
    members: IAiVisionDescriptor["members"],
): IAiVisionDescriptor {
    return { kind, summary, members };
}

export async function closeWithResult(entry: DialogEntry, result: unknown): Promise<boolean> {
    return await entry.model.close(result);
}

export async function cancelDialog(entry: DialogEntry): Promise<undefined> {
    await entry.model.close(undefined);
    return undefined;
}
