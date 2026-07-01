import { z } from "zod";

export const BridgeCommandType = {
  OpenTabs: "openTabs",
  ClaimTab: "claimTab",
  NewTab: "newTab",
  Goto: "goto",
  GetUrl: "getUrl",
  GetTitle: "getTitle",
  DomSnapshot: "domSnapshot",
  Click: "click",
  Fill: "fill",
  Scroll: "scroll",
  Screenshot: "screenshot",
  Finalize: "finalize",
  NameSession: "nameSession"
} as const;

export const capabilityFlagsSchema = z.object({
  canReadBackgroundTab: z.boolean().default(true),
  canInteractBackgroundTab: z.boolean().default(true),
  requiresForegroundForInput: z.boolean().default(false)
});

export const bridgePermissionsSchema = z.object({
  allowNavigation: z.boolean(),
  allowTyping: z.boolean(),
  allowExternalSideEffects: z.boolean()
});

export const bridgeSessionSchema = z.object({
  sessionId: z.string().uuid(),
  clientId: z.string().min(1),
  createdAt: z.string().datetime(),
  permissions: bridgePermissionsSchema,
  name: z.string().min(1).optional()
});

export const bridgeConnectionStatusSchema = z.object({
  connected: z.boolean(),
  lastConnectedAt: z.string().datetime().optional(),
  clientLabel: z.string().min(1).optional(),
  sessionActive: z.boolean().optional(),
  sessionId: z.string().uuid().optional(),
  sessionName: z.string().min(1).optional(),
  attachedTabCount: z.number().int().nonnegative().optional(),
  connectedProcessLabel: z.string().min(1).optional()
});

export const bridgeCommandSchema = z.object({
  type: z.enum([
    BridgeCommandType.OpenTabs,
    BridgeCommandType.ClaimTab,
    BridgeCommandType.NewTab,
    BridgeCommandType.Goto,
    BridgeCommandType.GetUrl,
    BridgeCommandType.GetTitle,
    BridgeCommandType.DomSnapshot,
    BridgeCommandType.Click,
    BridgeCommandType.Fill,
    BridgeCommandType.Scroll,
    BridgeCommandType.Screenshot,
    BridgeCommandType.Finalize,
    BridgeCommandType.NameSession
  ]),
  sessionId: z.string().uuid(),
  params: z.record(z.string(), z.unknown())
});

export type BridgePermissions = z.infer<typeof bridgePermissionsSchema>;
export type BridgeSession = z.infer<typeof bridgeSessionSchema>;
export type BridgeCommand = z.infer<typeof bridgeCommandSchema>;
export type CapabilityFlags = z.infer<typeof capabilityFlagsSchema>;
export type BridgeConnectionStatus = z.infer<typeof bridgeConnectionStatusSchema>;
