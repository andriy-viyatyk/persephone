import type { TMessageType } from "../../core/utils/types";

export interface AlertData {
    message: string;
    type: TMessageType;
    key: number;
    createdAt: number;
    /** Stays until the user closes or clicks it (error alerts always do). */
    persistent?: boolean;
    onClose: (value?: unknown) => void;
}

