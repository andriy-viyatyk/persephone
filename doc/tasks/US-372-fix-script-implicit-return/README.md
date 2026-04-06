# US-372: Fix Script Implicit Return with Block-Body Callbacks

## Goal

Fix the script runner's implicit return detection so that `return` statements inside callbacks (e.g., `.map(n => { return ...; })`) don't prevent the last expression from being returned.

## Background

### The bug

When a script contains a `return` keyword **anywhere** (even inside a callback), `wrapScriptWithImplicitReturn` treats the entire script as "already has a return" and wraps it without adding an implicit return for the last expression.

**File:** `src/renderer/scripting/ScriptRunnerBase.ts` line 107:
```typescript
if (/\breturn\b/.test(script)) {
    return `return (async function() {\n${SCRIPT_PREFIX}${script}\n}).call(this);`;
}
```

This regex matches `return` anywhere in the script text — including inside `.map()`, `.filter()`, `.forEach()`, `.reduce()` callbacks, nested functions, etc.

### Reproduction

```javascript
// Returns undefined (bug)
const lines = [1, 2, 3].map(n => { return n * 2; });
lines.join(",");

// Returns "2,4,6" (works — expression-body arrow)
const lines = [1, 2, 3].map(n => n * 2);
lines.join(",");
```

### Root cause

Line 107: `/\breturn\b/.test(script)` is a flat regex search. It finds `return` inside the `.map()` callback's block body and assumes the script has its own top-level return handling. The script is then wrapped as:

```javascript
return (async function() {
    // ... script as-is, no implicit return on last expression ...
}).call(this);
```

The last expression `lines.join(",")` is executed but its value is discarded.

### The fix

The `return` check needs to distinguish between:
- **Top-level `return`** (user explicitly returning) — respect it, don't add implicit return
- **`return` inside callbacks/nested functions** — ignore it, still add implicit return

## Implementation Plan

### Approach: Check only top-level `return` statements

Instead of a flat regex, parse the script minimally to determine if any `return` is at the top level (not inside `{ }` blocks of callbacks/functions).

**Simple heuristic:** Track brace depth. A `return` at brace depth 0 is a top-level return. A `return` inside `{ }` is in a callback/function.

```typescript
private hasTopLevelReturn(script: string): boolean {
    let depth = 0;
    // Simple tokenizer — skip strings and comments
    const tokens = script.match(
        /\/\/[^\n]*|\/\*[\s\S]*?\*\/|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`|\breturn\b|[{}]/g
    ) || [];
    for (const token of tokens) {
        if (token === "{") depth++;
        else if (token === "}") depth--;
        else if (token === "return" && depth === 0) return true;
        // Skip strings and comments (already matched as full tokens)
    }
    return false;
}
```

Then replace line 107:
```typescript
// Before:
if (/\breturn\b/.test(script)) {

// After:
if (this.hasTopLevelReturn(script)) {
```

### Edge cases to verify

| Script | Expected behavior |
|--------|------------------|
| `[1,2].map(n => { return n; }).join(",");` | Implicit return on `.join()` |
| `const x = fn(); return x;` | Top-level return detected, no implicit |
| `if (true) { return 42; }` | Top-level return (depth 0 at the `return` after `if` — actually depth 1). Need to handle `if`/`for` blocks vs function blocks |
| `function foo() { return 1; } foo();` | `return` inside function definition, not top-level. Implicit return on `foo()` |
| `const r = await fetch(url); r.json();` | No return anywhere, implicit return on `r.json()` |

**Wait — concern:** `if (cond) { return x; }` has `return` at brace depth 1, but it IS a top-level return (inside an `if` block, not a function). The simple brace-depth approach would miss this.

### Revised approach: Only skip `return` inside function/arrow bodies

Instead of tracking all braces, track only function/arrow scopes:

```typescript
private hasTopLevelReturn(script: string): boolean {
    // Quick check — no return at all?
    if (!/\breturn\b/.test(script)) return false;
    
    let funcDepth = 0;
    const tokens = script.match(
        /\/\/[^\n]*|\/\*[\s\S]*?\*\/|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`|\b(?:return|function)\b|=>|\{|\}/g
    ) || [];
    
    let prevWasArrow = false;
    for (const token of tokens) {
        if (token.startsWith("//") || token.startsWith("/*") || 
            token.startsWith("'") || token.startsWith('"') || token.startsWith("`")) {
            continue; // skip strings and comments
        }
        if (token === "function") { funcDepth++; /* next { is function body */ }
        if (token === "=>") { prevWasArrow = true; continue; }
        if (token === "{") {
            if (prevWasArrow) funcDepth++;  // arrow function body
            prevWasArrow = false;
        }
        if (token === "}") {
            if (funcDepth > 0) funcDepth--;
        }
        if (token === "return" && funcDepth === 0) return true;
        prevWasArrow = false;
    }
    return false;
}
```

This is more accurate but still imperfect (e.g., `function` keyword in strings, object methods). For a script runner this level of accuracy is sufficient — edge cases are rare and users can always add explicit returns.

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/scripting/ScriptRunnerBase.ts` | Replace `/\breturn\b/.test(script)` with `hasTopLevelReturn()` method |

## Acceptance Criteria

- [ ] `.map(n => { return n; }).join(",")` returns the joined string (not undefined)
- [ ] `.filter(n => { return n > 0; }).length` returns the count
- [ ] `.reduce((a, b) => { return a + b; }, 0)` returns the sum
- [ ] Explicit top-level `return 42;` still works
- [ ] `if (cond) { return x; }` top-level return still works
- [ ] `function foo() { return 1; } foo();` returns result of `foo()`
- [ ] Nested functions with `return` don't prevent implicit return on last expression
- [ ] Strings containing the word "return" don't trigger false positive
