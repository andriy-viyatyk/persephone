import type { ILinkData } from "../../shared/link-data";

/** Preserve the open pipeline's handled reset, delegate, and finalization sequence. */
export async function handoff(
    data: ILinkData,
    next: () => Promise<boolean>,
): Promise<void> {
    data.handled = false;
    await next();
    data.handled = true;
}
