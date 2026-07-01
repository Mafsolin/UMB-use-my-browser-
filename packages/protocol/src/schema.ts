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
  Submit: "submit",
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

export const tabIdSchema = z
  .string()
  .min(1, "tabId must not be empty")
  .max(64, "tabId is too long")
  .regex(/^[A-Za-z0-9_-]+$/u, "tabId contains unsupported characters");

export const navigationUrlSchema = z
  .string()
  .url("url must be a valid URL");

export const selectorSchema = z
  .string()
  .min(1, "selector must not be empty")
  .max(2048, "selector is too long");

export const valueSchema = z
  .string()
  .max(64 * 1024, "value is too large");

export const coordinateSchema = z
  .number()
  .finite("x and y must be finite numbers");

export const sessionNameSchema = z
  .string()
  .min(1, "name must not be empty")
  .max(256, "name is too long");

export const keepStatusSchema = z.enum(["deliverable", "handoff"]);

export const keepEntrySchema = z.object({
  id: tabIdSchema,
  status: keepStatusSchema
});

export const keepListSchema = z.array(keepEntrySchema);

const sessionIdField = z.string().uuid("sessionId must be a valid UUID");
const emptyParams = z.object({}).strict();
const tabIdParams = z.object({ tabId: tabIdSchema }).strict();
const gotoParams = z
  .object({ tabId: tabIdSchema, url: navigationUrlSchema })
  .strict();
const clickParams = z
  .object({ tabId: tabIdSchema, selector: selectorSchema })
  .strict();
const fillParams = z
  .object({ tabId: tabIdSchema, selector: selectorSchema, value: valueSchema })
  .strict();
const submitParams = z
  .object({ tabId: tabIdSchema, selector: selectorSchema })
  .strict();
const scrollParams = z
  .object({ tabId: tabIdSchema, x: coordinateSchema, y: coordinateSchema })
  .strict();
const nameSessionParams = z.object({ name: sessionNameSchema }).strict();
const finalizeParams = z.object({ keep: keepListSchema }).strict();

export const openTabsCommandSchema = z.object({
  type: z.literal(BridgeCommandType.OpenTabs),
  sessionId: sessionIdField,
  params: emptyParams
}).strict();

export const claimTabCommandSchema = z.object({
  type: z.literal(BridgeCommandType.ClaimTab),
  sessionId: sessionIdField,
  params: tabIdParams
}).strict();

export const newTabCommandSchema = z.object({
  type: z.literal(BridgeCommandType.NewTab),
  sessionId: sessionIdField,
  params: emptyParams
}).strict();

export const gotoCommandSchema = z.object({
  type: z.literal(BridgeCommandType.Goto),
  sessionId: sessionIdField,
  params: gotoParams
}).strict();

export const getUrlCommandSchema = z.object({
  type: z.literal(BridgeCommandType.GetUrl),
  sessionId: sessionIdField,
  params: tabIdParams
}).strict();

export const getTitleCommandSchema = z.object({
  type: z.literal(BridgeCommandType.GetTitle),
  sessionId: sessionIdField,
  params: tabIdParams
}).strict();

export const domSnapshotCommandSchema = z.object({
  type: z.literal(BridgeCommandType.DomSnapshot),
  sessionId: sessionIdField,
  params: tabIdParams
}).strict();

export const clickCommandSchema = z.object({
  type: z.literal(BridgeCommandType.Click),
  sessionId: sessionIdField,
  params: clickParams
}).strict();

export const fillCommandSchema = z.object({
  type: z.literal(BridgeCommandType.Fill),
  sessionId: sessionIdField,
  params: fillParams
}).strict();

export const submitCommandSchema = z.object({
  type: z.literal(BridgeCommandType.Submit),
  sessionId: sessionIdField,
  params: submitParams
}).strict();

export const scrollCommandSchema = z.object({
  type: z.literal(BridgeCommandType.Scroll),
  sessionId: sessionIdField,
  params: scrollParams
}).strict();

export const screenshotCommandSchema = z.object({
  type: z.literal(BridgeCommandType.Screenshot),
  sessionId: sessionIdField,
  params: tabIdParams
}).strict();

export const nameSessionCommandSchema = z.object({
  type: z.literal(BridgeCommandType.NameSession),
  sessionId: sessionIdField,
  params: nameSessionParams
}).strict();

export const finalizeCommandSchema = z.object({
  type: z.literal(BridgeCommandType.Finalize),
  sessionId: sessionIdField,
  params: finalizeParams
}).strict();

export const bridgeCommandSchema = z.discriminatedUnion("type", [
  openTabsCommandSchema,
  claimTabCommandSchema,
  newTabCommandSchema,
  gotoCommandSchema,
  getUrlCommandSchema,
  getTitleCommandSchema,
  domSnapshotCommandSchema,
  clickCommandSchema,
  fillCommandSchema,
  scrollCommandSchema,
  screenshotCommandSchema,
  submitCommandSchema,
  nameSessionCommandSchema,
  finalizeCommandSchema
]);

export type BridgePermissions = z.infer<typeof bridgePermissionsSchema>;
export type BridgeSession = z.infer<typeof bridgeSessionSchema>;
export type BridgeCommand = z.infer<typeof bridgeCommandSchema>;
export type BridgeCommandParams<T extends BridgeCommand["type"]> = Extract<
  BridgeCommand,
  { type: T }
>["params"];
export type CapabilityFlags = z.infer<typeof capabilityFlagsSchema>;
export type BridgeConnectionStatus = z.infer<typeof bridgeConnectionStatusSchema>;
export type KeepEntry = z.infer<typeof keepEntrySchema>;
