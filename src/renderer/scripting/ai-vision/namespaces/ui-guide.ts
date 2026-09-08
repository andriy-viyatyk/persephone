import { highlightDeclarationElement, ui } from "../../../api/ui";
import { logGuideButton, subscribeGuideButton } from "../event-log";
import { createElements } from "ai-vision/dom";
import {
    stringRule,
    validateCallArguments,
    type IAiMember,
    type IAiVisionDescriptor,
} from "ai-vision";
import type { IAiHighlightResult } from "ai-vision/dom";
import { HEADER_ELEMENTS } from "./ui-elements";

const DEFAULT_BUTTONS: readonly string[] = ["Skip", "Next"];
const DEFAULT_TIMEOUT_MS = 50_000;
const MAX_TIMEOUT_MS = 110_000;
const PENDING_MESSAGE = (elementName: string): string =>
    "The guide card may have been dismissed without a button press. "
    + `Call ui.guide.step(...) again for the same element ${JSON.stringify(elementName)} `
    + "to re-draw it in place.";

const STEP_ARGUMENTS = [
    stringRule("elementName", 'ui.guide.step("persephone-menu", "This opens the Menu Bar.")'),
    stringRule("message", 'ui.guide.step("persephone-menu", "This opens the Menu Bar.")'),
] as const;

const GUIDE_MEMBERS: readonly IAiMember[] = [
    { name: "step", kind: "method", signature: "step(elementName: string, message: string, options?: { buttons?: string[]; timeoutMs?: number })", summary: "Point at one curated shell control and wait for the user to press Skip or Next.", caution: "changes the visible UI and waits for user input" },
    { name: "end", kind: "method", signature: "end()", summary: "Clear the current guide overlay and finish the walkthrough.", caution: "changes the visible UI" },
];

interface GuideOptions {
    readonly buttons?: readonly string[];
    readonly timeoutMs?: number;
}

interface PendingStep {
    readonly stepId: string;
    readonly elementName: string;
}

interface UnconsumedPress {
    readonly stepId: string;
    readonly label: string;
}

type GuideStepResult =
    | { readonly pressed: string; readonly elementName: string }
    | { readonly pending: true; readonly waitedMs: number; readonly elementName: string; readonly message: string; readonly timeoutMs?: number; readonly clampedFrom?: number }
    | { readonly ended: true; readonly elementName: string }
    | { readonly superseded: true; readonly elementName: string };

interface ActiveStep {
    readonly stepId: string;
    readonly elementName: string;
    readonly message: string;
    readonly startedAt: number;
    readonly resolve: (result: GuideStepResult) => void;
    readonly reject: (error: unknown) => void;
    status: "active" | "pending" | "pressed" | "ended" | "superseded" | "failed";
    unsubscribe?: () => void;
    timer?: ReturnType<typeof setTimeout>;
}

let nextStepId = 0;

function isPlainGuideOptions(value: unknown): value is GuideOptions {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function readGuideOptions(value: unknown): GuideOptions | undefined {
    if (value === undefined) return undefined;
    if (!isPlainGuideOptions(value)) {
        throw new Error("ui.guide.step options must be a plain object.");
    }
    const options = value as Record<string, unknown>;
    if (options.buttons !== undefined
        && (!Array.isArray(options.buttons)
            || options.buttons.length === 0
            || options.buttons.some((button) => typeof button !== "string" || button.length === 0))) {
        throw new Error("ui.guide.step options.buttons must be a non-empty array of non-empty strings.");
    }
    if (options.timeoutMs !== undefined
        && (typeof options.timeoutMs !== "number"
            || !Number.isFinite(options.timeoutMs)
            || !Number.isInteger(options.timeoutMs)
            || options.timeoutMs <= 0)) {
        throw new Error("ui.guide.step options.timeoutMs must be a positive finite integer.");
    }
    return options as GuideOptions;
}

function timeoutMetadata(requestedTimeoutMs: number | undefined): Record<string, number> {
    return requestedTimeoutMs !== undefined && requestedTimeoutMs > MAX_TIMEOUT_MS
        ? { timeoutMs: MAX_TIMEOUT_MS, clampedFrom: requestedTimeoutMs }
        : {};
}

export class GuideNode {
    private activeStep: ActiveStep | undefined;
    private pendingStep: PendingStep | undefined;
    // A button press is a user fact: the event log records it durably, while this handoff lets a
    // later retry consume the same answer without making the user press a newly drawn card.
    private readonly lastPressByElement = new Map<string, UnconsumedPress>();
    private readonly issuedStepIdsByElement = new Map<string, Set<string>>();

    async step(...args: unknown[]): Promise<GuideStepResult> {
        const [elementName, message] = validateCallArguments(
            "ui.guide.step",
            args,
            STEP_ARGUMENTS,
            { maxArgs: 3 },
        );
        const options = readGuideOptions(args[2]);
        const buttons = options?.buttons ? [...options.buttons] : DEFAULT_BUTTONS;
        const requestedTimeoutMs = options?.timeoutMs;
        const timeoutMs = Math.min(requestedTimeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
        const metadata = timeoutMetadata(requestedTimeoutMs);

        const activeStep = this.activeStep;
        const pendingStep = this.pendingStep;
        const previousElementName = activeStep?.elementName ?? pendingStep?.elementName;
        if (previousElementName !== undefined && previousElementName !== elementName) {
            this.clearPressRecords();
        } else if ([...this.lastPressByElement.keys()].some((name) => name !== elementName)) {
            this.clearPressRecords();
        }
        if (activeStep) {
            this.settle(activeStep, { superseded: true, elementName: activeStep.elementName }, "superseded");
            void ui.clearHighlights(activeStep.stepId);
        }

        if (pendingStep && pendingStep.elementName !== elementName) {
            this.pendingStep = undefined;
            void ui.clearHighlights(pendingStep.stepId);
        }
        const stepId = pendingStep?.elementName === elementName
            ? pendingStep.stepId
            : `ui-guide-step-${++nextStepId}`;
        this.pendingStep = undefined;
        this.issueStepId(elementName, stepId);

        const unconsumedPress = this.consumePress(elementName, stepId);
        if (unconsumedPress) {
            void ui.clearHighlights(stepId);
            return { pressed: unconsumedPress.label, elementName };
        }

        return new Promise<GuideStepResult>((resolve, reject) => {
            const state: ActiveStep = {
                stepId,
                elementName,
                message,
                startedAt: Date.now(),
                resolve,
                reject,
                status: "active",
            };
            this.activeStep = state;
            state.unsubscribe = subscribeGuideButton((signal) => {
                if (this.activeStep !== state || state.status !== "active") return;
                if (signal.stepId !== state.stepId || signal.elementName !== state.elementName) return;
                this.consumePress(state.elementName, state.stepId);
                this.settle(state, { pressed: signal.button, elementName }, "pressed");
            });
            state.timer = setTimeout(() => {
                if (this.activeStep !== state || state.status !== "active") return;
                this.pendingStep = { stepId, elementName };
                this.settle(state, {
                    pending: true,
                    waitedMs: Math.max(0, Date.now() - state.startedAt),
                    elementName,
                    message: PENDING_MESSAGE(elementName),
                    ...metadata,
                }, "pending");
            }, timeoutMs);

            void this.draw(state, buttons).catch((error: unknown) => {
                if (state.status === "active" && this.activeStep === state) {
                    this.fail(state, error);
                } else if (state.status === "superseded" || state.status === "ended") {
                    void ui.clearHighlights(state.stepId);
                }
            });
        });
    }

    async end(...args: unknown[]): Promise<{ readonly ended: true }> {
        validateCallArguments("ui.guide.end", args, [], { maxArgs: 0 });
        const activeStep = this.activeStep;
        const stepId = activeStep?.stepId ?? this.pendingStep?.stepId;
        this.pendingStep = undefined;
        this.clearPressRecords();
        if (activeStep) this.settle(activeStep, { ended: true, elementName: activeStep.elementName }, "ended");
        if (stepId) await ui.clearHighlights(stepId);
        return { ended: true };
    }

    get aiVision(): IAiVisionDescriptor {
        return GUIDE_DESCRIPTOR;
    }

    private async draw(state: ActiveStep, buttons: readonly string[]): Promise<void> {
        const elements = createElements(
            HEADER_ELEMENTS,
            (selector, text, _options, reveal) => highlightDeclarationElement(
                selector,
                text,
                {
                    id: state.stepId,
                    buttons,
                    onButton: (label, _id) => {
                        this.lastPressByElement.set(state.elementName, { stepId: state.stepId, label });
                        logGuideButton(state.elementName, label, state.stepId, "ui.guide.step");
                    },
                },
                reveal,
            ),
        );
        const provider = elements.provide("highlight");
        if (!provider || typeof provider.value !== "function") {
            throw new Error("ui.guide.step could not create the curated UI highlight provider.");
        }
        const result = await (provider.value as (name: string, text: string) => Promise<IAiHighlightResult>)(
            state.elementName,
            state.message,
        );
        if (!result.found && state.status === "active" && this.activeStep === state) {
            this.fail(
                state,
                new Error(
                    `Could not find curated UI element ${JSON.stringify(state.elementName)}. `
                    + "Re-read ui.elements and choose a currently available control.",
                ),
            );
        }
    }

    private settle(state: ActiveStep, result: GuideStepResult, status: ActiveStep["status"]): void {
        if (state.status !== "active") return;
        state.status = status;
        this.cleanup(state);
        if (this.activeStep === state) this.activeStep = undefined;
        if (status !== "pending") this.pendingStep = undefined;
        if (status !== "pending") this.retireStepId(state.elementName, state.stepId);
        state.resolve(result);
    }

    private fail(state: ActiveStep, error: unknown): void {
        if (state.status !== "active") return;
        state.status = "failed";
        this.cleanup(state);
        if (this.activeStep === state) this.activeStep = undefined;
        this.pendingStep = undefined;
        this.retireStepId(state.elementName, state.stepId);
        this.lastPressByElement.delete(state.elementName);
        void ui.clearHighlights(state.stepId);
        state.reject(error);
    }

    private issueStepId(elementName: string, stepId: string): void {
        const issuedStepIds = this.issuedStepIdsByElement.get(elementName) ?? new Set<string>();
        issuedStepIds.add(stepId);
        this.issuedStepIdsByElement.set(elementName, issuedStepIds);
    }

    private consumePress(elementName: string, stepId: string): UnconsumedPress | undefined {
        const press = this.lastPressByElement.get(elementName);
        if (!press) return undefined;
        const issuedStepIds = this.issuedStepIdsByElement.get(elementName);
        if (!issuedStepIds?.has(press.stepId) || press.stepId !== stepId) {
            this.lastPressByElement.delete(elementName);
            return undefined;
        }
        this.lastPressByElement.delete(elementName);
        this.retireStepId(elementName, press.stepId);
        return press;
    }

    private retireStepId(elementName: string, stepId: string): void {
        const issuedStepIds = this.issuedStepIdsByElement.get(elementName);
        if (!issuedStepIds) return;
        issuedStepIds.delete(stepId);
        if (issuedStepIds.size === 0) this.issuedStepIdsByElement.delete(elementName);
    }

    private clearPressRecords(): void {
        this.lastPressByElement.clear();
        this.issuedStepIdsByElement.clear();
    }

    private cleanup(state: ActiveStep): void {
        if (state.timer !== undefined) clearTimeout(state.timer);
        state.unsubscribe?.();
        state.timer = undefined;
        state.unsubscribe = undefined;
    }
}

const GUIDE_DESCRIPTOR: IAiVisionDescriptor = {
    kind: "UiGuide",
    summary: "A guided, one-control-at-a-time walkthrough that waits for the user's choice.",
    members: GUIDE_MEMBERS,
    help: "Use ui.elements to learn the curated control names and their purposes. Use ui.highlight to point at one control and return when it is drawn. Use ui.guide.step to point at one control and wait for the user to press Skip or Next; call one step per control. When step returns pending, including after the user dismissed the card without pressing a button, call ui.guide.step(...) again for the same element to re-draw it in place. Call ui.guide.end() after a step has returned to clear the final guide overlay and finish the walkthrough. end() cannot interrupt a step call currently blocked in the same one-call-at-a-time MCP client; the timeout is the escape from that blocked call.",
    summarize: () => ({ kind: "UiGuide" }),
};

export const guideNode = new GuideNode();
