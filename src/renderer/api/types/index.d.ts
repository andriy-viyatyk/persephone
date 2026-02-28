/* eslint-disable no-var */
import type { IApp } from "./app";
// Phase 4: Replace Page with IPage when implemented
import type { Page } from "./page";

declare global {
    /** The application object. Access all app functionality through this. */
    const app: IApp;

    /** The active page. Available in scripts that run in context of a page. */
    const page: Page | undefined;
}

export {};
