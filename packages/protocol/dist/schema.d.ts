import { z } from "zod";
export declare const BridgeCommandType: {
    readonly OpenTabs: "openTabs";
    readonly ClaimTab: "claimTab";
    readonly NewTab: "newTab";
    readonly Goto: "goto";
    readonly GetUrl: "getUrl";
    readonly GetTitle: "getTitle";
    readonly DomSnapshot: "domSnapshot";
    readonly Click: "click";
    readonly Fill: "fill";
    readonly Scroll: "scroll";
    readonly Screenshot: "screenshot";
    readonly Finalize: "finalize";
    readonly NameSession: "nameSession";
};
export declare const capabilityFlagsSchema: z.ZodObject<{
    canReadBackgroundTab: z.ZodDefault<z.ZodBoolean>;
    canInteractBackgroundTab: z.ZodDefault<z.ZodBoolean>;
    requiresForegroundForInput: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>;
export declare const bridgePermissionsSchema: z.ZodObject<{
    allowNavigation: z.ZodBoolean;
    allowTyping: z.ZodBoolean;
    allowExternalSideEffects: z.ZodBoolean;
}, z.core.$strip>;
export declare const bridgeSessionSchema: z.ZodObject<{
    sessionId: z.ZodString;
    clientId: z.ZodString;
    createdAt: z.ZodString;
    permissions: z.ZodObject<{
        allowNavigation: z.ZodBoolean;
        allowTyping: z.ZodBoolean;
        allowExternalSideEffects: z.ZodBoolean;
    }, z.core.$strip>;
    name: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const bridgeConnectionStatusSchema: z.ZodObject<{
    connected: z.ZodBoolean;
    lastConnectedAt: z.ZodOptional<z.ZodString>;
    clientLabel: z.ZodOptional<z.ZodString>;
    sessionActive: z.ZodOptional<z.ZodBoolean>;
    sessionId: z.ZodOptional<z.ZodString>;
    sessionName: z.ZodOptional<z.ZodString>;
    attachedTabCount: z.ZodOptional<z.ZodNumber>;
    connectedProcessLabel: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const bridgeCommandSchema: z.ZodObject<{
    type: z.ZodEnum<{
        openTabs: "openTabs";
        claimTab: "claimTab";
        newTab: "newTab";
        goto: "goto";
        getUrl: "getUrl";
        getTitle: "getTitle";
        domSnapshot: "domSnapshot";
        click: "click";
        fill: "fill";
        scroll: "scroll";
        screenshot: "screenshot";
        finalize: "finalize";
        nameSession: "nameSession";
    }>;
    sessionId: z.ZodString;
    params: z.ZodRecord<z.ZodString, z.ZodUnknown>;
}, z.core.$strip>;
export type BridgePermissions = z.infer<typeof bridgePermissionsSchema>;
export type BridgeSession = z.infer<typeof bridgeSessionSchema>;
export type BridgeCommand = z.infer<typeof bridgeCommandSchema>;
export type CapabilityFlags = z.infer<typeof capabilityFlagsSchema>;
export type BridgeConnectionStatus = z.infer<typeof bridgeConnectionStatusSchema>;
