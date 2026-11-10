/** Registry id of the Board Info editor. Kept in its own tiny, dependency-free
 *  module so the switch widget (`PageToolbar`) and `register-editors` can reference the id
 *  without importing the editor implementation (avoids an import cycle). */
export const BOARD_INFO_EDITOR_ID = "board-info";
