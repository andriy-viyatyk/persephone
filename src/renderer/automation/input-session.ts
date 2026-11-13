import type { CdpSession } from "./CdpSession";
import type { IInputPoint, IInputSession } from "./types";

/** Create the shared input session and map document points through same-process frames. */
export function createInputSession(cdp: CdpSession, sessionId?: string): IInputSession {
    return {
        cdp,
        sessionId,
        mapPoint: (point: IInputPoint, offsets: ReadonlyArray<IInputPoint> = []) => offsets.reduce(
            (mapped, offset) => ({ x: mapped.x + offset.x, y: mapped.y + offset.y }), point,
        ),
    };
}
