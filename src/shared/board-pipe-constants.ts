/** Maximum bytes carried by one main↔renderer board-pipe IPC reply. */
export const MAX_BOARD_PIPE_CHUNK_BYTES = 1024 * 1024;

/** Maximum logical size buffered when a pipe cannot stream without a copy. */
export const MAX_BUFFERED_PIPE_BYTES = 256 * 1024 * 1024;
