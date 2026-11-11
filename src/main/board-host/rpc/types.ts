import type {
    BoardPermissionRequirement,
    BoardPortMethods,
    BoardPortParams,
    BoardPortResult,
} from "../../../ipc/board-bridge/port-protocol";
import type { BoardBridgeConnection } from "../BoardBridgeConnection";

export type BoardRpcMethod = keyof BoardPortMethods;

export type BoardRpcHandlerTable = {
    [M in BoardRpcMethod]: {
        permission?: BoardPermissionRequirement;
        liveFrameOnly?: true;
        handle(
            connection: BoardBridgeConnection,
            ...params: BoardPortParams<M>
        ): BoardPortResult<M> | Promise<BoardPortResult<M>>;
    };
};

export type BoardRpcSlice<Keys extends BoardRpcMethod> = Pick<BoardRpcHandlerTable, Keys>;
