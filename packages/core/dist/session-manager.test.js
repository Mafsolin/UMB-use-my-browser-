import { describe, expect, it } from "vitest";
import { SessionManager } from "./session-manager.js";
describe("SessionManager", () => {
    it("creates a session with explicit client identity", () => {
        const manager = new SessionManager();
        const session = manager.createSession({
            clientId: "claude-code",
            permissions: {
                allowNavigation: true,
                allowTyping: true,
                allowExternalSideEffects: false
            }
        });
        expect(session.clientId).toBe("claude-code");
        expect(session.permissions.allowExternalSideEffects).toBe(false);
    });
    it("rejects side-effect actions when permission is false", () => {
        const manager = new SessionManager();
        const session = manager.createSession({
            clientId: "gemini-cli",
            permissions: {
                allowNavigation: true,
                allowTyping: true,
                allowExternalSideEffects: false
            }
        });
        expect(() => manager.assertAllowed(session.sessionId, "submitForm")).toThrow(/side effects are disabled/i);
    });
    it("can name a session for handoff tracking", () => {
        const manager = new SessionManager();
        const session = manager.createSession({
            clientId: "umb-cli",
            permissions: {
                allowNavigation: true,
                allowTyping: true,
                allowExternalSideEffects: true
            }
        });
        const renamed = manager.nameSession(session.sessionId, "invoice-research");
        expect(renamed.name).toBe("invoice-research");
        expect(manager.getSession(session.sessionId).name).toBe("invoice-research");
    });
    it("rejects navigation when navigation permission is false", () => {
        const manager = new SessionManager();
        const session = manager.createSession({
            clientId: "umb-cli",
            permissions: {
                allowNavigation: false,
                allowTyping: true,
                allowExternalSideEffects: true
            }
        });
        expect(() => manager.assertAllowed(session.sessionId, "navigate")).toThrow(/navigation is disabled/i);
    });
    it("rejects typing when typing permission is false", () => {
        const manager = new SessionManager();
        const session = manager.createSession({
            clientId: "umb-cli",
            permissions: {
                allowNavigation: true,
                allowTyping: false,
                allowExternalSideEffects: true
            }
        });
        expect(() => manager.assertAllowed(session.sessionId, "type")).toThrow(/typing is disabled/i);
    });
});
