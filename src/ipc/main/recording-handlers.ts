import { IpcMainEvent } from "electron";
import { RecordingFinalizeRequest, RecordingRegion, RecordingSessionChunk } from "../api-param-types";
import type { RecordingApi } from "../contracts/recording";
import { bindDomain } from "./endpoint-registry";
import { appendRecordingChunk, cancelRecording, finalizeRecording, startRecording } from "../../main/recording-service";

export function initRecordingHandlers(): void {
    bindDomain<RecordingApi>({
        startWindowRecording: async (event: IpcMainEvent, request: { region: RecordingRegion }) =>
            startRecording(event.sender, request.region),
        appendWindowRecordingChunk: async (event: IpcMainEvent, request: RecordingSessionChunk) =>
            appendRecordingChunk(
                event.sender.id,
                request.recordingId,
                request.chunk,
            ),
        finalizeWindowRecording: async (event: IpcMainEvent, request: RecordingFinalizeRequest) =>
            finalizeRecording(
                event.sender.id,
                request.recordingId,
                request.extension,
            ),
        cancelWindowRecording: async (event: IpcMainEvent, recordingId: string) =>
            cancelRecording(event.sender.id, recordingId),
    });
}

