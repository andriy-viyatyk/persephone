// Board environment variables — foundation.
// Consumed by the board bridge and the `.env.json` editor.

export { boardVars } from "./BoardEnvStore";
export { resolveBoardVarRequest, type BoardVarReply } from "./board-vars-bridge";
export {
    DEFAULT_PROFILE,
    type BoardVarsFile,
    type BoardVarsNamespace,
    type BoardVarsProfile,
    type BoardVarsLoadStatus,
    type BoardVarsLoadResult,
} from "./types";
