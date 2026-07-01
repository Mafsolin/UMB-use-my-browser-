import { describe, expect, it } from "vitest";
import { BridgeCommandType, bridgeCommandSchema, bridgeSessionSchema } from "./schema.js";
describe("universal bridge protocol", () => {
    it("defines a client-neutral session shape", () => {
        const session = bridgeSessionSchema.parse({
            sessionId: "123e4567-e89b-12d3-a456-426614174000",
            clientId: "codex",
            createdAt: "2026-06-30T12:00:00.000Z",
            name: "shopping-handoff",
            permissions: {
                allowNavigation: true,
                allowTyping: true,
                allowExternalSideEffects: false
            }
        });
        expect(session.clientId).toBe("codex");
        expect(session.name).toBe("shopping-handoff");
    });
    it("defines the core browser command set", () => {
        const command = bridgeCommandSchema.parse({
            type: BridgeCommandType.NewTab,
            sessionId: "123e4567-e89b-12d3-a456-426614174000",
            params: {}
        });
        expect(command.type).toBe("newTab");
    });
});
