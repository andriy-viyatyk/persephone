import type { ITransformer, ITransformerDescriptor } from "../../api/types/io.transformer";
import { encryption } from "../../api/shell/encryption";

/**
 * DecryptTransformer — decrypts/encrypts content using AES-GCM.
 *
 * Read:  encrypted text bytes → decrypt with password → plaintext bytes
 * Write: plaintext bytes → encrypt with password → encrypted text bytes
 *
 * persistent: false — password must never be saved to disk.
 * Password is stored in an ES2022 #private field — truly hidden at runtime.
 */
export class DecryptTransformer implements ITransformer {
    readonly type = "decrypt";
    readonly persistent = false;
    readonly config: Record<string, unknown> = {};

    readonly #password: string;

    constructor(password: string) {
        this.#password = password;
    }

    async read(data: Buffer): Promise<Buffer> {
        const encryptedText = data.toString("utf-8");
        const plaintext = await encryption.decrypt(encryptedText, this.#password);
        return Buffer.from(plaintext, "utf-8");
    }

    async write(data: Buffer): Promise<Buffer> {
        const plaintext = data.toString("utf-8");
        const encryptedText = await encryption.encrypt(plaintext, this.#password);
        return Buffer.from(encryptedText, "utf-8");
    }

    clone(): ITransformer {
        return new DecryptTransformer(this.#password);
    }

    toDescriptor(): ITransformerDescriptor {
        return {
            type: "decrypt",
            config: {},
        };
    }
}
