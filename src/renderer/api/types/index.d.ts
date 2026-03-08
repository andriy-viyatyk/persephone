/* eslint-disable no-var */
import type { IApp } from "./app";
import type { IPage } from "./page";

declare global {
    /** The application object. Access all app functionality through this. */
    const app: IApp;

    /** The active page. Available in scripts that run in context of a page. */
    const page: IPage | undefined;

    /**
     * Import a module. Use `require("library/...")` to load modules from the script library.
     *
     * @example
     * const { greet } = require("library/utils/helpers");
     * const config = require("library/config");
     */
    function require(id: string): any;

    /** Prevent script output from being written to the grouped page. */
    function preventOutput(): void;
}

export {};
