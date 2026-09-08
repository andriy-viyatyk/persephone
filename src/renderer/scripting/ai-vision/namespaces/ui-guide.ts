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
const PENDING_MESSAGE = (target: string): string =>
    "The guide card may have been dismissed without a button press. "
    + `Call ui.guide.step(...) again for the same target ${JSON.stringify(target)} `
    + "to re-draw it in place.";

const STEP_ARGUMENTS = [
    stringRule("target", 'ui.guide.step("persephone-menu", "This opens the Menu Bar.")'),
    stringRule("message", 'ui.guide.step("persephone-menu", "This opens the Menu Bar.")'),
] as const;

const GUIDE_MEMBERS: readonly IAiMember[] = [
    { name: "step", kind: "method", signature: "step(target: string, message: string, options?: { buttons?: string[]; timeoutMs?: number })", summary: "Point at one UI target and wait for the user to press Skip or Next.", caution: "changes the visible UI and waits for user input" },
    { name: "end", kind: "method", signature: "end()", summary: "Clear the current guide overlay and finish the walkthrough.", caution: "changes the visible UI" },
];

interface GuideOptions {
    readonly buttons?: readonly string[];
    readonly timeoutMs?: number;
}

interface PendingStep {
    readonly stepId: string;
    readonly target: string;
}

interface UnconsumedPress {
    readonly stepId: string;
    readonly label: string;
}

type GuideStepResult =
    | { readonly pressed: string; readonly target: string }
    | { readonly pending: true; readonly waitedMs: number; readonly target: string; readonly message: string; readonly timeoutMs?: number; readonly clampedFrom?: number }
    | { readonly ended: true; readonly target: string }
    | { readonly superseded: true; readonly target: string };

interface ActiveStep {
    readonly stepId: string;
    readonly target: string;
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
    private readonly lastPressByTarget = new Map<string, UnconsumedPress>();
    private readonly issuedStepIdsByTarget = new Map<string, Set<string>>();

    async step(...args: unknown[]): Promise<GuideStepResult> {
        const [target, message] = validateCallArguments(
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
        const previousTarget = activeStep?.target ?? pendingStep?.target;
        if (previousTarget !== undefined && previousTarget !== target) {
            this.clearPressRecords();
        } else if ([...this.lastPressByTarget.keys()].some((name) => name !== target)) {
            this.clearPressRecords();
        }
        if (activeStep) {
            this.settle(activeStep, { superseded: true, target: activeStep.target }, "superseded");
            void ui.clearHighlights(activeStep.stepId);
        }

        if (pendingStep && pendingStep.target !== target) {
            this.pendingStep = undefined;
            void ui.clearHighlights(pendingStep.stepId);
        }
        const stepId = pendingStep?.target === target
            ? pendingStep.stepId
            : `ui-guide-step-${++nextStepId}`;
        this.pendingStep = undefined;
        this.issueStepId(target, stepId);

        const unconsumedPress = this.consumePress(target, stepId);
        if (unconsumedPress) {
            void ui.clearHighlights(stepId);
            return { pressed: unconsumedPress.label, target };
        }

        return new Promise<GuideStepResult>((resolve, reject) => {
            const state: ActiveStep = {
                stepId,
                target,
                message,
                startedAt: Date.now(),
                resolve,
                reject,
                status: "active",
            };
            this.activeStep = state;
            state.unsubscribe = subscribeGuideButton((signal) => {
                if (this.activeStep !== state || state.status !== "active") return;
                if (signal.stepId !== state.stepId || signal.target !== state.target) return;
                this.consumePress(state.target, state.stepId);
                this.settle(state, { pressed: signal.button, target }, "pressed");
            });
            state.timer = setTimeout(() => {
                if (this.activeStep !== state || state.status !== "active") return;
                this.pendingStep = { stepId, target };
                this.settle(state, {
                    pending: true,
                    waitedMs: Math.max(0, Date.now() - state.startedAt),
                    target,
                    message: PENDING_MESSAGE(target),
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
        if (activeStep) this.settle(activeStep, { ended: true, target: activeStep.target }, "ended");
        if (stepId) await ui.clearHighlights(stepId);
        return { ended: true };
    }

    get aiVision(): IAiVisionDescriptor {
        return GUIDE_DESCRIPTOR;
    }

    private async draw(state: ActiveStep, buttons: readonly string[]): Promise<void> {
        const highlightOptions = {
            id: state.stepId,
            buttons,
            onButton: (label: string): void => {
                this.lastPressByTarget.set(state.target, { stepId: state.stepId, label });
                logGuideButton(state.target, label, state.stepId, "ui.guide.step");
            },
        };
        let result: IAiHighlightResult;
        if (HEADER_ELEMENTS.some((element) => element.name === state.target)) {
            const elements = createElements(
                HEADER_ELEMENTS,
                (selector, text, _options, reveal) => highlightDeclarationElement(
                    selector,
                    text,
                    highlightOptions,
                    reveal,
                ),
            );
            const provider = elements.provide("highlight");
            if (!provider || typeof provider.value !== "function") {
                throw new Error("ui.guide.step could not create the curated UI highlight provider.");
            }
            result = await (provider.value as (name: string, text: string) => Promise<IAiHighlightResult>)(
                state.target,
                state.message,
            );
        } else {
            const selector = state.target.startsWith("[")
                || state.target.startsWith("#")
                || state.target.startsWith(".")
                ? state.target
                : `[data-name=${JSON.stringify(state.target)}]`;
            result = await highlightDeclarationElement(selector, state.message, highlightOptions);
        }
        if (!result.found && state.status === "active" && this.activeStep === state) {
            this.fail(
                state,
                new Error(
                    `Could not find guide target ${JSON.stringify(state.target)}. `
                    + "Use a curated shell name, a CSS selector beginning with [, #, or ., or a bare data-name value. "
                    + "For non-shell controls, read the owning node's elements for its selector.",
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
        if (status !== "pending") this.retireStepId(state.target, state.stepId);
        state.resolve(result);
    }

    private fail(state: ActiveStep, error: unknown): void {
        if (state.status !== "active") return;
        state.status = "failed";
        this.cleanup(state);
        if (this.activeStep === state) this.activeStep = undefined;
        this.pendingStep = undefined;
        this.retireStepId(state.target, state.stepId);
        this.lastPressByTarget.delete(state.target);
        void ui.clearHighlights(state.stepId);
        state.reject(error);
    }

    private issueStepId(target: string, stepId: string): void {
        const issuedStepIds = this.issuedStepIdsByTarget.get(target) ?? new Set<string>();
        issuedStepIds.add(stepId);
        this.issuedStepIdsByTarget.set(target, issuedStepIds);
    }

    private consumePress(target: string, stepId: string): UnconsumedPress | undefined {
        const press = this.lastPressByTarget.get(target);
        if (!press) return undefined;
        const issuedStepIds = this.issuedStepIdsByTarget.get(target);
        if (!issuedStepIds?.has(press.stepId) || press.stepId !== stepId) {
            this.lastPressByTarget.delete(target);
            return undefined;
        }
        this.lastPressByTarget.delete(target);
        this.retireStepId(target, press.stepId);
        return press;
    }

    private retireStepId(target: string, stepId: string): void {
        const issuedStepIds = this.issuedStepIdsByTarget.get(target);
        if (!issuedStepIds) return;
        issuedStepIds.delete(stepId);
        if (issuedStepIds.size === 0) this.issuedStepIdsByTarget.delete(target);
    }

    private clearPressRecords(): void {
        this.lastPressByTarget.clear();
        this.issuedStepIdsByTarget.clear();
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
    help: "Use ui.elements to learn the curated control names and their purposes. Use ui.highlight to point at one control and return when it is drawn. The step target may be a curated shell name, a CSS selector beginning with [, #, or ., or a bare data-name value. For non-shell controls, read the owning node's elements for its selector. Use ui.guide.step(target, message) to point at one control and wait for the user to press Skip or Next; call one step per control. When step returns pending, including after the user dismissed the card without pressing a button, call ui.guide.step(...) again for the same target to re-draw it in place. Call ui.guide.end() after a step has returned to clear the final guide overlay and finish the walkthrough. end() cannot interrupt a step call currently blocked in the same one-call-at-a-time MCP client; the timeout is the escape from that blocked call.",
    summarize: () => ({ kind: "UiGuide" }),
};

export const guideNode = new GuideNode();
