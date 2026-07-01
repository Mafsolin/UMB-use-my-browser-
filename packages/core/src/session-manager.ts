import { randomUUID } from "node:crypto";
import type { BridgePermissions, BridgeSession } from "@umb/protocol";
import { isSideEffectAction } from "./policy.js";

export class SessionManager {
  private readonly sessions = new Map<string, BridgeSession>();

  createSession(input: {
    clientId: string;
    permissions: BridgePermissions;
  }): BridgeSession {
    const session: BridgeSession = {
      sessionId: randomUUID(),
      clientId: input.clientId,
      createdAt: new Date().toISOString(),
      permissions: input.permissions
    };

    this.sessions.set(session.sessionId, session);
    return session;
  }

  getSession(sessionId: string): BridgeSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown session: ${sessionId}`);
    }

    return session;
  }

  nameSession(sessionId: string, name: string): BridgeSession {
    const session = this.getSession(sessionId);
    const updatedSession: BridgeSession = {
      ...session,
      name
    };

    this.sessions.set(sessionId, updatedSession);
    return updatedSession;
  }

  assertAllowed(sessionId: string, action: string): void {
    const session = this.getSession(sessionId);

    if (action === "navigate" && !session.permissions.allowNavigation) {
      throw new Error(`Navigation is disabled for session ${sessionId}.`);
    }

    if (action === "type" && !session.permissions.allowTyping) {
      throw new Error(`Typing is disabled for session ${sessionId}.`);
    }

    if (
      isSideEffectAction(action) &&
      !session.permissions.allowExternalSideEffects
    ) {
      throw new Error(`Side effects are disabled by session permissions for ${sessionId}: ${action}`);
    }
  }
}
