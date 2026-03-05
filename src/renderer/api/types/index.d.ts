/* eslint-disable no-var */
import type { IApp } from "./app";
import type { IPage } from "./page";

declare global {
    /** The application object. Access all app functionality through this. */
    const app: IApp;

    /** The active page. Available in scripts that run in context of a page. */
    const page: IPage | undefined;
}

export {};
