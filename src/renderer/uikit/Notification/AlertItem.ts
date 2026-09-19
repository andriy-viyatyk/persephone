import type { TMessageType } from "../../core/utils/types";

export interface AlertData {
    message: string;
    type: TMessageType;
    key: number;
    createdAt: number;
    onClose: (value?: unknown) => void;
}

