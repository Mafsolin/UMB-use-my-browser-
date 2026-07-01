import type { BridgePermissions, BridgeSession } from "@umb/protocol";
export declare class SessionManager {
    private readonly sessions;
    createSession(input: {
        clientId: string;
        permissions: BridgePermissions;
    }): BridgeSession;
    getSession(sessionId: string): BridgeSession;
    nameSession(sessionId: string, name: string): BridgeSession;
    assertAllowed(sessionId: string, action: string): void;
}
