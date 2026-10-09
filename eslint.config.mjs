// @ts-check
// Flat ESLint config (ESLint 9). Replaces the legacy .eslintrc.json.
// Scope is deliberately ts/tsx-only, matching the old `--ext .ts,.tsx` behavior —
// js/mjs/cjs (build scripts, this config) stay unlinted, exactly as before.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import importPlugin from "eslint-plugin-import";
import globals from "globals";
import { dirname, resolve } from "node:path";

const vanillaViewPlugin = {
    rules: {
        "no-constructor-listeners": createConstructorCallRule(
            (node) => isMemberCall(node, "addEventListener")
                || isMemberCall(node, "subscribe")
                || isThisCall(node, "listen")
                || isThisCall(node, "bind"),
            "VanillaView constructors must not install listeners or subscriptions.",
        ),
        "no-constructor-timers": createConstructorCallRule(
            (node) => isNamedCall(node, new Set([
                "setTimeout",
                "setInterval",
                "requestAnimationFrame",
                "queueMicrotask",
            ])) || isMemberCallInSet(node, new Set([
                "setTimeout",
                "setInterval",
                "requestAnimationFrame",
                "queueMicrotask",
            ])),
            "VanillaView constructors must not start timers or scheduled work.",
        ),
        "no-constructor-measurement": createConstructorCallRule(
            (node) => isMemberCall(node, "getBoundingClientRect")
                || isConstructorCall(node, "ResizeObserver")
                || isConstructorCall(node, "IntersectionObserver")
                || isLayoutMeasurement(node),
            "VanillaView constructors must not measure layout.",
        ),
        "no-constructor-uncreated-field": {
            meta: {
                type: "problem",
                schema: [],
                messages: {
                    uncreated: "Constructor reads this.{{field}} before the field is created; create it in the constructor or use it from onMount() onward.",
                },
            },
            create(context) {
                return classVisitors((classNode, constructor) => {
                    const lifecycleFields = findLifecycleFields(classNode);
                    if (lifecycleFields.size === 0 || !constructor) return;

                    const createdBeforeConstructor = findInitializedFields(classNode);
                    const constructorAssignments = new Set();
                    traverse(constructor.value.body, (node) => {
                        const field = assignmentField(node);
                        if (field) constructorAssignments.add(field);
                    });

                    traverse(constructor.value.body, (node) => {
                        if (node.type !== "MemberExpression") return;
                        const field = thisField(node);
                        if (!field || !lifecycleFields.has(field)) return;
                        if (field === "props" || field === "root") return;
                        if (isAssignmentTarget(node) || constructorAssignments.has(field)
                            || createdBeforeConstructor.has(field)) return;

                        context.report({ node, messageId: "uncreated", data: { field } });
                    });
                });
            },
        },
        "no-child-claim-twice": {
            meta: {
                type: "problem",
                schema: [],
                messages: {
                    duplicate: "VanillaView field this.{{field}} is claimed by child() more than once without releasing the previous child.",
                },
            },
            create(context) {
                return classVisitors((classNode) => {
                    const events = findClaimEvents(classNode);
                    const activeClaims = new Map();

                    for (const event of events) {
                        if (event.kind === "release") {
                            activeClaims.delete(event.field);
                            continue;
                        }
                        const previous = activeClaims.get(event.field);
                        if (previous && !areMutuallyExclusive(previous.node, event.node)) {
                            context.report({ node: event.node, messageId: "duplicate", data: { field: event.field } });
                        }
                        activeClaims.set(event.field, event);
                    }
                });
            },
        },
        // ESLint has no type information here: recognize same-file direct VanillaView subclasses
        // and the codebase's View/ViewImpl base-name convention as likely view classes. Limit
        // reports to named declarations; anonymous class expressions are used as constructor
        // adapters (for example Browser's PageSlot factory), not declared view hierarchy types.
        "no-indirect-view-subclass": {
            meta: {
                type: "problem",
                schema: [],
                messages: {
                    indirect: "{{className}} extends {{baseName}}; VanillaView subclasses must extend VanillaView directly.",
                },
            },
            create(context) {
                return {
                    "Program:exit"(program) {
                        const classes = [];
                        visitAllNodes(program, (node) => {
                            if (isClassNode(node)) classes.push(node);
                        });

                        const directViewBases = new Set();
                        for (const node of classes) {
                            if (node.superClass?.type !== "Identifier" || node.superClass.name !== "VanillaView") continue;
                            const name = node.id?.name
                                ?? (node.parent?.type === "VariableDeclarator" && node.parent.id.type === "Identifier"
                                    ? node.parent.id.name
                                    : undefined);
                            if (name) directViewBases.add(name);
                        }

                        for (const node of classes) {
                            if (node.type !== "ClassDeclaration" || !node.id) continue;
                            const baseName = node.superClass?.type === "Identifier" ? node.superClass.name : undefined;
                            if (!baseName || baseName === "VanillaView") continue;
                            if (!directViewBases.has(baseName) && !/(?:View|ViewImpl)$/.test(baseName)) continue;

                            const className = node.id?.name
                                ?? (node.parent?.type === "VariableDeclarator" && node.parent.id.type === "Identifier"
                                    ? node.parent.id.name
                                    : "Anonymous class");
                            context.report({
                                node: node.superClass,
                                messageId: "indirect",
                                data: { className, baseName },
                            });
                        }
                    },
                };
            },
        },
        "bind-handle-outside-mount": {
            meta: {
                type: "problem",
                schema: [],
                messages: {
                    discarded: "Retain this bind() handle and release it before rebinding in a repeatable method.",
                },
            },
            create(context) {
                return classVisitors((classNode) => {
                    for (const member of classNode.body.body) {
                        const methodName = memberNameFromDefinition(member);
                        if (!methodName || methodName === "constructor" || methodName === "onMount") continue;
                        const body = functionBody(member);
                        if (!body) continue;

                        traverseAll(body, (node) => {
                            if (!isThisCall(node, "bind")) return;
                            if (node.parent?.type === "ExpressionStatement" && node.parent.expression === node) {
                                context.report({ node, messageId: "discarded" });
                            }
                        });
                    }
                });
            },
        },
        "no-hardcoded-ui-strings": {
            meta: {
                type: "problem",
                schema: [],
                messages: {
                    hardcoded: "Hardcoded UI text; add it to the English i18n catalog and call t().",
                },
            },
            create(context) {
                const filename = context.filename.replace(/\\/g, "/");
                if (isExcludedI18nFile(filename)) return {};

                const settingsNativeTextBindings = new Set();
                const textElementBindings = new Set(["createTextElement"]);
                const literalHasLetters = (node) => {
                    if (node.type === "Literal") {
                        return typeof node.value === "string" && /\p{L}/u.test(node.value);
                    }
                    return node.type === "TemplateLiteral"
                        && node.quasis.some((quasi) => /\p{L}/u.test(quasi.value.cooked ?? quasi.value.raw));
                };
                const report = (node) => {
                    if (literalHasLetters(node)) context.report({ node, messageId: "hardcoded" });
                };

                return {
                    ImportDeclaration(node) {
                        if (typeof node.source.value !== "string") return;
                        const source = resolve(dirname(filename), node.source.value).replace(/\\/g, "/");
                        if (source.endsWith("/src/renderer/editors/settings/sections/settings-native")
                            || source.endsWith("/src/renderer/editors/settings/sections/settings-native.ts")) {
                            for (const specifier of node.specifiers) {
                                if (specifier.type !== "ImportSpecifier") continue;
                                const imported = specifier.imported.name ?? specifier.imported.value;
                                if (imported === "text") settingsNativeTextBindings.add(specifier.local.name);
                            }
                        }
                        for (const specifier of node.specifiers) {
                            if (specifier.type !== "ImportSpecifier") continue;
                            const imported = specifier.imported.name ?? specifier.imported.value;
                            if (imported === "createTextElement") textElementBindings.add(specifier.local.name);
                        }
                    },
                    Property(node) {
                        const key = node.key.type === "Identifier"
                            ? node.key.name
                            : node.key.type === "Literal" && typeof node.key.value === "string"
                                ? node.key.value
                                : undefined;
                        if (["label", "title", "placeholder", "tooltip", "children"].includes(key)) {
                            report(node.value);
                        }
                    },
                    AssignmentExpression(node) {
                        if (node.left.type !== "MemberExpression" || memberName(node.left) === undefined) return;
                        if (["textContent", "title", "placeholder"].includes(memberName(node.left))) report(node.right);
                    },
                    CallExpression(node) {
                        const argument = node.arguments[0];
                        if (!argument || argument.type === "SpreadElement") return;
                        const callee = node.callee;
                        const name = callee.type === "Identifier" ? callee.name : undefined;
                        const isUiNotify = callee.type === "MemberExpression"
                            && memberName(callee) === "notify"
                            && ((callee.object.type === "Identifier" && callee.object.name === "ui")
                                || (callee.object.type === "MemberExpression"
                                    && memberName(callee.object) === "ui"
                                    && callee.object.object.type === "Identifier"
                                    && callee.object.object.name === "app"));
                        if ((name && textElementBindings.has(name))
                            || (name && settingsNativeTextBindings.has(name))
                            || isUiNotify) report(argument);
                    },
                };
            },
        },
    },
};

function isExcludedI18nFile(filename) {
    return filename.includes("/src/shared/i18n/")
        || filename.includes("/src/renderer/automation/")
        || filename.includes("/src/renderer/scripting/ai-vision/")
        || filename.includes("/src/renderer/scripting/api-wrapper/")
        || filename.includes("/src/main/mcp/")
        || filename.includes("/src/renderer/api/mcp/")
        || filename.includes("/src/renderer/api/types/")
        || /\/(?:test|tests|__tests__|stories)\//.test(filename)
        || /(?:^|\/)[^/]*(?:\.test|\.spec|\.story)\.[jt]sx?$/.test(filename);
}

function createConstructorCallRule(matcher, message) {
    return {
        meta: { type: "problem", schema: [], messages: { violation: message } },
        create(context) {
            return classVisitors((_classNode, constructor) => {
                if (!constructor) return;
                traverse(constructor.value.body, (node) => {
                    if (matcher(node)) {
                        context.report({ node, messageId: "violation" });
                    }
                });
            });
        },
    };
}

function classVisitors(inspect) {
    return {
        ClassDeclaration(node) {
            inspectVanillaClass(node, inspect);
        },
        ClassExpression(node) {
            inspectVanillaClass(node, inspect);
        },
    };
}

function inspectVanillaClass(node, inspect) {
    if (node.superClass?.type !== "Identifier" || node.superClass.name !== "VanillaView") return;
    const constructor = node.body.body.find((member) =>
        member.type === "MethodDefinition"
        && member.kind === "constructor",
    );
    inspect(node, constructor);
}

function traverse(node, visit) {
    if (isClassNode(node)) return;
    visit(node);
    if (isFunctionNode(node)) return;

    for (const [key, value] of Object.entries(node)) {
        if (key === "parent" || key === "tokens" || key === "comments" || key === "range" || key === "loc") {
            continue;
        }
        if (Array.isArray(value)) {
            value.forEach((child) => {
                if (child && typeof child.type === "string") traverse(child, visit);
            });
        } else if (value && typeof value.type === "string") {
            traverse(value, visit);
        }
    }
}

function traverseAll(node, visit) {
    if (isClassNode(node)) return;
    visit(node);
    for (const [key, value] of Object.entries(node)) {
        if (key === "parent" || key === "tokens" || key === "comments" || key === "range" || key === "loc") {
            continue;
        }
        if (Array.isArray(value)) {
            value.forEach((child) => {
                if (child && typeof child.type === "string") traverseAll(child, visit);
            });
        } else if (value && typeof value.type === "string") {
            traverseAll(value, visit);
        }
    }
}

function visitAllNodes(node, visit) {
    if (!node || typeof node.type !== "string") return;
    visit(node);
    for (const [key, value] of Object.entries(node)) {
        if (key === "parent" || key === "tokens" || key === "comments" || key === "range" || key === "loc") continue;
        if (Array.isArray(value)) {
            value.forEach((child) => visitAllNodes(child, visit));
        } else if (value && typeof value.type === "string") {
            visitAllNodes(value, visit);
        }
    }
}

function isFunctionNode(node) {
    return node?.type === "FunctionExpression"
        || node?.type === "ArrowFunctionExpression"
        || node?.type === "FunctionDeclaration";
}

function isClassNode(node) {
    return node?.type === "ClassDeclaration" || node?.type === "ClassExpression";
}

function thisField(node) {
    if (node.type !== "MemberExpression" || node.object.type !== "ThisExpression") return undefined;
    if (!node.computed && node.property.type === "Identifier") return node.property.name;
    if (node.computed && node.property.type === "Literal" && typeof node.property.value === "string") {
        return node.property.value;
    }
    return undefined;
}

function assignmentField(node) {
    if (node.type !== "AssignmentExpression") return undefined;
    return thisField(node.left);
}

function isAssignmentTarget(node) {
    const parent = node.parent;
    return (parent?.type === "AssignmentExpression" && parent.left === node)
        || (parent?.type === "UpdateExpression" && parent.argument === node);
}

function memberName(node) {
    if (node.type !== "MemberExpression") return undefined;
    if (!node.computed && node.property.type === "Identifier") return node.property.name;
    if (node.computed && node.property.type === "Literal" && typeof node.property.value === "string") {
        return node.property.value;
    }
    return undefined;
}

function isMemberCall(node, name) {
    return node.type === "CallExpression"
        && node.callee.type === "MemberExpression"
        && memberName(node.callee) === name;
}

function isMemberCallInSet(node, names) {
    return node.type === "CallExpression"
        && node.callee.type === "MemberExpression"
        && names.has(memberName(node.callee));
}

function isThisCall(node, name) {
    return isMemberCall(node, name) && node.callee.object.type === "ThisExpression";
}

function isNamedCall(node, names) {
    return node.type === "CallExpression"
        && node.callee.type === "Identifier"
        && names.has(node.callee.name);
}

function isConstructorCall(node, name) {
    return node.type === "NewExpression"
        && node.callee.type === "Identifier"
        && node.callee.name === name;
}

function isLayoutMeasurement(node) {
    if (node.type !== "MemberExpression") return false;
    const name = memberName(node);
    return name !== undefined && /^(?:offset|client)/.test(name);
}

function findInitializedFields(classNode) {
    const fields = new Set(["root", "props"]);
    for (const member of classNode.body.body) {
        if (member.type === "PropertyDefinition" && member.value) {
            const name = memberNameFromDefinition(member);
            if (name) fields.add(name);
        }
    }
    return fields;
}

function memberNameFromDefinition(member) {
    if (!member.computed && member.key.type === "Identifier") return member.key.name;
    if (member.computed && member.key.type === "Literal" && typeof member.key.value === "string") {
        return member.key.value;
    }
    return undefined;
}

function findLifecycleFields(classNode) {
    const writes = new Map();
    for (const member of classNode.body.body) {
        const body = functionBody(member);
        const memberName = memberNameFromDefinition(member);
        if (member.type === "PropertyDefinition" && member.value && memberName) {
            writes.set(memberName, new Set(["field-initializer"]));
            continue;
        }
        if (!body) continue;
        const owner = memberName ?? "method";
        traverse(body, (node) => {
            const field = assignmentField(node);
            if (!field) return;
            const owners = writes.get(field) ?? new Set();
            owners.add(owner);
            writes.set(field, owners);
        });
    }
    const fields = new Set();
    writes.forEach((owners, field) => {
        if ([...owners].every((owner) => owner === "onMount" || owner === "onUpdate")) {
            fields.add(field);
        }
    });
    return fields;
}

function findClaimEvents(classNode) {
    const aliases = new Map();
    const helperReleases = new Map();
    const events = [];
    const members = classNode.body.body;

    for (const member of members) {
        const body = functionBody(member);
        if (!body) continue;
        traverseAll(body, (node) => {
            if (node.type !== "VariableDeclarator" || node.id.type !== "Identifier") return;
            const field = node.init && thisField(node.init);
            if (field) aliases.set(node.id.name, field);
        });
    }

    for (const member of members) {
        const body = functionBody(member);
        if (!body) continue;
        const helperName = memberNameFromDefinition(member);
        const releases = new Set();
        traverseAll(body, (node) => {
            const release = releaseField(node, aliases);
            if (release) releases.add(release);
        });
        if (helperName && releases.size > 0) helperReleases.set(helperName, releases);
    }

    for (const member of members) {
        const body = functionBody(member);
        if (!body) continue;
        traverseAll(body, (node) => {
            if (node.type === "CallExpression" && isThisCall(node, "child")) {
                const assignment = node.parent;
                const field = assignment?.type === "AssignmentExpression"
                    && assignment.right === node
                    ? thisField(assignment.left)
                    : undefined;
                if (field) events.push({ kind: "claim", field, node: assignment });
            }

            if (node.type !== "CallExpression") return;
            const release = releaseField(node, aliases);
            if (release) events.push({ kind: "release", field: release, node });

            if (isThisCall(node, memberName(node.callee)) && node.arguments.length === 0) {
                const helper = helperReleases.get(memberName(node.callee));
                helper?.forEach((field) => events.push({ kind: "release", field, node }));
            }
        });
    }

    return events.sort((left, right) => left.node.range[0] - right.node.range[0]);
}

function functionBody(member) {
    if (member.type === "MethodDefinition") return member.value.body;
    if (member.type === "PropertyDefinition" && isFunctionNode(member.value)) return member.value.body;
    return undefined;
}

function releaseField(node, aliases) {
    if (!isThisCall(node, "releaseChild") || node.arguments.length !== 1) return undefined;
    const argument = node.arguments[0];
    return thisField(argument) ?? (argument.type === "Identifier" ? aliases.get(argument.name) : undefined);
}

function areMutuallyExclusive(first, second) {
    let ancestor = first.parent;
    while (ancestor) {
        if (ancestor.type === "IfStatement"
            && isWithin(first, ancestor.consequent)
            && isWithin(second, ancestor.alternate)) return true;
        ancestor = ancestor.parent;
    }
    ancestor = second.parent;
    while (ancestor) {
        if (ancestor.type === "IfStatement"
            && isWithin(second, ancestor.consequent)
            && isWithin(first, ancestor.alternate)) return true;
        ancestor = ancestor.parent;
    }
    return false;
}

function isWithin(node, ancestor) {
    if (!ancestor) return false;
    let current = node;
    while (current) {
        if (current === ancestor) return true;
        current = current.parent;
    }
    return false;
}

export default tseslint.config(
    // Global ignores (flat-config replacement for ignorePatterns). The *.{js,jsx,mjs,cjs}
    // globs re-create the old `--ext .ts,.tsx` scope: only TypeScript is linted, so build
    // scripts, this config file, and vite/forge JS never enter the run.
    {
        ignores: [
            "scratches/**",
            "assets/editor-types/**",
            "out/**",
            ".vite/**",
            "dist/**",
            "release/**",
            "**/*.js",
            "**/*.jsx",
            "**/*.mjs",
            "**/*.cjs",
        ],
    },

    // The legacy .eslintrc did not report unused eslint-disable directives (eslintrc default
    // is "off"); ESLint 9 flat config defaults this to "warn". Keep the old behavior — the
    // codebase carries directives for rules that were renamed across the plugin upgrades, and
    // cleaning them up is a separate concern, not part of this toolchain migration.
    {
        linterOptions: {
            reportUnusedDisableDirectives: "off",
        },
    },

    // Main config — ts/tsx only.
    {
        files: ["**/*.ts", "**/*.tsx"],
        extends: [
            js.configs.recommended,
            // Array; bundles eslint-recommended (core-rule disables) + recommended TS rules.
            ...tseslint.configs.recommended,
            importPlugin.flatConfigs.recommended,
            importPlugin.flatConfigs.electron,
            importPlugin.flatConfigs.typescript,
        ],
        plugins: {
            "vanilla-view": vanillaViewPlugin,
        },
        languageOptions: {
            parser: tseslint.parser,
            globals: {
                ...globals.browser,
                ...globals.node,
                ...globals.es2021,
            },
        },
        settings: {
            // Classic resolver form. eslint-plugin-import@2.32 does not honor the newer
            // `import/resolver-next`, so the string form is required; eslint-import-resolver
            // -typescript@4 remains backward-compatible with it.
            "import/resolver": {
                typescript: { alwaysTryTypes: true },
                node: true,
            },
        },
        rules: {
            // ---- carried over verbatim from .eslintrc.json ----
            "no-useless-escape": "off",
            "@typescript-eslint/no-empty-function": "off",
            "import/no-named-as-default-member": "off",
            "@typescript-eslint/no-unused-vars": [
                "warn",
                {
                    argsIgnorePattern: "^_",
                    varsIgnorePattern: "^_",
                    // v8 changed the `caughtErrors` default from "none" to "all"; restore the
                    // pre-upgrade behavior of not flagging unused catch bindings.
                    caughtErrors: "none",
                    caughtErrorsIgnorePattern: "^_",
                    destructuredArrayIgnorePattern: "^_",
                    ignoreRestSiblings: true,
                },
            ],

            // ---- migrated to v8 successor rule names (same intent as the old off-switches) ----
            // old: @typescript-eslint/no-empty-interface (removed in v8, merged into this rule)
            "@typescript-eslint/no-empty-object-type": "off",
            // old: @typescript-eslint/no-var-requires (renamed in v8). The codebase intentionally
            // uses require(...) in documented spots (file-path.ts, fs.ts, etc.).
            "@typescript-eslint/no-require-imports": "off",

            // ---- newly-added v8 `recommended` rules disabled to preserve the pre-upgrade
            //      behavior (US-825 is a toolchain migration, not a code-cleanup task) ----
            // The script-API type surface uses `declare namespace` heavily.
            "@typescript-eslint/no-namespace": "off",
            // Intentional short-circuit / expression statements (e.g. `cond && doThing()`).
            "@typescript-eslint/no-unused-expressions": "off",

            // The @modelcontextprotocol/sdk 1.29 `exports` map uses a `./*` wildcard whose
            // `types` condition (`./dist/esm/*.d.ts`) can't satisfy the `.js`-suffixed deep
            // imports the SDK requires at runtime/bundle time — the TS resolver reports them
            // unresolved even though they build and run. Exempt just that package.
            "import/no-unresolved": ["error", { ignore: ["^@modelcontextprotocol/sdk/"] }],

            "vanilla-view/no-constructor-listeners": "error",
            "vanilla-view/no-constructor-timers": "error",
            "vanilla-view/no-constructor-measurement": "error",
            "vanilla-view/no-constructor-uncreated-field": "error",
            "vanilla-view/no-child-claim-twice": "error",
            "vanilla-view/no-indirect-view-subclass": "error",
            "vanilla-view/bind-handle-outside-mount": "error",
            "vanilla-view/no-hardcoded-ui-strings": "warn",
        },
    },

    // Declaration files.
    {
        files: ["**/*.d.ts"],
        rules: {
            "no-var": "off",
            "@typescript-eslint/no-explicit-any": "off",
        },
    },

    // Areas that intentionally use `any`.
    {
        files: [
            // av-grid's own generics default the row type to `any` (`AVGrid<R = any>`), so the
            // shim's props, instance type and prop-forwarding maps carry it through.
            "src/renderer/uikit/DataGrid/**/*.ts",
            "src/renderer/uikit/DataGrid/**/*.tsx",
            "src/renderer/editors/grid/**/*.ts",
            "src/renderer/editors/grid/**/*.tsx",
            "**/*.story.ts",
            "**/*.story.tsx",
            "assets/script-library/**/*.ts",
            "assets/script-library/**/*.tsx",
        ],
        rules: {
            "@typescript-eslint/no-explicit-any": "off",
        },
    },

    // Rule 6: UIKit must not reach into application-layer modules. Stories are harnesses and
    // are intentionally excluded; resolved paths distinguish uikit/shared from src/shared.
    {
        files: ["src/renderer/uikit/**/*.ts", "src/renderer/uikit/**/*.tsx"],
        ignores: ["src/renderer/uikit/**/*.story.ts", "src/renderer/uikit/**/*.story.tsx"],
        rules: {
            "import/no-restricted-paths": ["error", {
                zones: [{
                    target: "./src/renderer/uikit",
                    from: [
                        "./src/renderer/api",
                        "./src/renderer/ui",
                        "./src/renderer/components",
                        "./src/shared",
                    ],
                    message: "Rule 6: uikit/ imports only core/ and theme/. Take app concepts through props/callbacks, or move the contract to core/.",
                }],
            }],
        },
    },

    // C4-1: av-grid is reached only through uikit/DataGrid, so a later decision to vendor the
    // library's source changes one folder instead of every consumer.
    {
        files: ["src/**/*.ts", "src/**/*.tsx"],
        ignores: ["src/renderer/uikit/DataGrid/**"],
        rules: {
            "no-restricted-imports": ["error", {
                paths: [{
                    name: "av-grid",
                    message: "EPIC-057 C4-1: import from uikit/DataGrid, not from av-grid directly.",
                }, {
                    name: "react",
                    message: "EPIC-110 D4: React is not part of the Persephone renderer source. Nothing in src/ may import React.",
                }, {
                    name: "react-dom",
                    message: "EPIC-110 D4: React is not part of the Persephone renderer source. Nothing in src/ may import React.",
                }],
                patterns: ["av-grid/*", "react-dom/*"],
            }],
        },
    },

);
