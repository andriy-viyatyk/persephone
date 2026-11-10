import type { MessagePortMain } from "electron";
import { serialize } from "node:v8";
import { createServiceChannel, domPort, electronPort, type ServiceChannel, type ServiceChannelKind } from "./service-channel";

/** The one size measure: the V8 serialized size the port actually transmits. */
export const measureV8Bytes = (value: unknown): number => serialize(value).byteLength;

/** Renderer / audio window end (nodeIntegration is on): DOM port + V8 measure. */
export function openDomServiceChannel(port: MessagePort, kind: ServiceChannelKind): ServiceChannel {
    return createServiceChannel(domPort(port), { kind, measureBytes: measureV8Bytes });
}

/** Main end. */
export function openElectronServiceChannel(port: MessagePortMain, kind: ServiceChannelKind, onEnd?: () => void): ServiceChannel {
    return createServiceChannel(electronPort(port), { kind, measureBytes: measureV8Bytes, onEnd });
}
