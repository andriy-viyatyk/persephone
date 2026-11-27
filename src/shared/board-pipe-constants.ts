/** Maximum bytes in one provider chunk or bounded board-pipe response. */
export const MAX_BOARD_PIPE_CHUNK_BYTES = 1024 * 1024;

/** Maximum provider write sessions across all service leases and provider types. */
export const MAX_OPEN_PROVIDER_WRITES = 16;

/** Maximum logical size buffered when a pipe cannot stream without a copy. */
export const MAX_BUFFERED_PIPE_BYTES = 256 * 1024 * 1024;
