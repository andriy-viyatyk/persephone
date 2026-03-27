# US-275: DecryptTransformer

## Status

**Status:** Planned
**Priority:** High
**Epic:** EPIC-012
**Started:** —
**Completed:** —

## Summary

Implement `DecryptTransformer` that decrypts/encrypts content using AES-GCM (same algorithm as current `encryption.ts`). `persistent: false` — password must never be saved to disk.

## Why

- Needed by US-268 (TextFileIOModel migration) for the clone-and-try encryption flow
- Replaces direct `encryption.decrypt()`/`encryption.encrypt()` calls with a pipe transformer

## Background

### Current encryption format
- On disk: `"ENC-v001:" + base64(iv + ciphertext)` — a UTF-8 text string
- `encryptText(plaintext, password)` → encrypted string
- `decryptText(encryptedString, password)` → plaintext
- Detection: `isEncrypted(text)` checks for `"ENC-v001:"` prefix

### DecryptTransformer in the pipe
- `read(data)`: Buffer (encrypted text bytes) → decode to string → decrypt → encode plaintext to Buffer
- `write(data, original)`: Buffer (plaintext bytes) → decode to string → encrypt → encode encrypted text to Buffer
- `persistent: false` — config contains password, must not be serialized to disk
- `toDescriptor()` still works (needed by `clone()`) — returns `{ type: "decrypt", config: { password } }` which is only used in-memory, never written to IPageState

### Clone-and-try flow (how page will use it in US-268)
```
1. Page reads content → sees "ENC-v001:..." → shows lock icon
2. User enters password
3. Page clones pipe → adds DecryptTransformer(password) → tries readText()
4. Success → swap pipes → show plaintext
5. Failure → dispose clone → show error
```

## Acceptance Criteria

- [ ] `DecryptTransformer` implements `ITransformer` — read decrypts, write encrypts
- [ ] Uses same AES-GCM algorithm as `encryption.ts` (reuses its functions)
- [ ] `persistent: false`
- [ ] `toDescriptor()` returns `{ type: "decrypt", config: { password } }` (for clone)
- [ ] Registered as `"decrypt"` in transformer registry
- [ ] No regressions in existing functionality

## Files to Create/Modify

| File | Change |
|------|--------|
| `src/renderer/content/transformers/DecryptTransformer.ts` | **NEW** |
| `src/renderer/content/registry.ts` | Register `"decrypt"` transformer type |

## Related

- Epic: [EPIC-012](../../epics/EPIC-012.md)
- Depends on: US-261 (ITransformer interface)
- Needed by: US-268 (TextFileIOModel migration — clone-and-try encryption)
- Current impl: `src/renderer/api/shell/encryption.ts`
