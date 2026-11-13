import type { TimeoutExemptions } from "../timeout-exemptions";
import type {
    RecordingFinalizeRequest,
    RecordingSessionChunk,
    RecordingSessionRequest,
    RecordingSessionStartResult,
} from "../api-param-types";

export interface RecordingApi {
    startWindowRecording: (request: RecordingSessionRequest) => Promise<RecordingSessionStartResult>;
    appendWindowRecordingChunk: (request: RecordingSessionChunk) => Promise<void>;
    finalizeWindowRecording: (request: RecordingFinalizeRequest) => Promise<string>;
    cancelWindowRecording: (recordingId: string) => Promise<void>;
}


export const recordingTimeoutExemptions = {
    finalizeWindowRecording: "Sync, rename, and cleanup I/O are not request-bounded.",
    startWindowRecording: "Recording file I/O and cleanup are not request-bounded.",
    appendWindowRecordingChunk: "Chunk size and pending disk writes are not request-bounded.",
    cancelWindowRecording: "Recording cleanup I/O is not request-bounded.",
} satisfies TimeoutExemptions<RecordingApi>;
