export type TranslationPriority = "visible" | "near" | "background";
export interface TranslationUnit {
    key: string;
    revision: number;
    format: "html" | "text";
    text: string;
    priority: TranslationPriority;
}
export interface TranslationFrameScope { document: string; }
export interface TranslationUnitsMessage { scope: TranslationFrameScope; items: TranslationUnit[]; }
export interface TranslationResultMessage { scope: TranslationFrameScope; results: Array<{ key: string; revision: number; text?: string }>; }
export interface TranslationActivationMessage { active: boolean; from: string; to: string; }
export interface TranslationDetectionSampleMessage { scope: TranslationFrameScope; lang: string; text: string; }
