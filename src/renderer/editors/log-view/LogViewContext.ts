import { createContext, useContext } from "react";
import { LogViewModel } from "./LogViewModel";

const LogViewContext = createContext<LogViewModel | null>(null);

export const LogViewProvider = LogViewContext.Provider;

export function useLogViewModel(): LogViewModel {
    const vm = useContext(LogViewContext);
    if (!vm) throw new Error("LogViewContext not provided");
    return vm;
}
