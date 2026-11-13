import { SearchChannel } from "../search-ipc";
import * as searchService from "../../main/search-service";
import { guardedIpcOn } from "../../main/ipc-sender-guard";
import type { SearchRequest, SearchCancel } from "../search-ipc";

export function initSearchHandlers(): void {
    guardedIpcOn(SearchChannel.start, (event, request: SearchRequest) => searchService.start(event, request));
    guardedIpcOn(SearchChannel.cancel, (event, request: SearchCancel | undefined) => searchService.cancel(event, request));
}
