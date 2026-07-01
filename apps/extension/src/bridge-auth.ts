export const DEFAULT_BRIDGE_PROTOCOL = "umb-v1";
const BEARER_PROTOCOL_PREFIX = "bearer.";

export function hasBridgeBearerToken(token: string | undefined): boolean {
  return typeof token === "string" && token.trim().length > 0;
}

export function buildBridgeSubprotocols(token: string | undefined): string[] {
  if (!hasBridgeBearerToken(token)) {
    return [DEFAULT_BRIDGE_PROTOCOL];
  }
  return [DEFAULT_BRIDGE_PROTOCOL, `${BEARER_PROTOCOL_PREFIX}${token}`];
}

export function isBearerProtocol(protocol: string | undefined | null): boolean {
  return Boolean(protocol && protocol.startsWith(BEARER_PROTOCOL_PREFIX));
}

export function extractBearerToken(protocol: string): string | undefined {
  if (!isBearerProtocol(protocol)) {
    return undefined;
  }
  const token = protocol.slice(BEARER_PROTOCOL_PREFIX.length);
  return token.length > 0 ? token : undefined;
}
