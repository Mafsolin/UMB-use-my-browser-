import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const DAEMON_HTTP_URL = process.env.UMB_DAEMON_HTTP_URL ?? "http://127.0.0.1:44777";
const DAEMON_WS_URL = process.env.UMB_DAEMON_WS_URL ?? "ws://127.0.0.1:44777/extension";
const HOST_NAME = "com.umb.use_my_browser";

type NativeHostRequest = {
  type?: string;
  extensionId?: string;
};

type AuthBootstrap = {
  token: string;
  allowedOrigins: string[];
};

type DaemonHealth = {
  daemon?: {
    pid?: number;
    startedAt?: string;
  };
};

type NativeHostRuntimeDependencies = {
  ensureDaemonRunning: () => Promise<void>;
  fetchAuthBootstrap: (extensionId: string | undefined) => Promise<AuthBootstrap | null>;
  fetchDaemonHealth: () => Promise<DaemonHealth | null>;
};

type NativeHostResponse = {
  ok: boolean;
  bearerToken?: string;
  allowedOrigins?: string[];
  daemonHttpUrl?: string;
  daemonPid?: number;
  daemonStartedAt?: string;
  hostName: string;
  nativeHostPid?: number;
  wsUrl?: string;
  error?: string;
};

async function daemonHealthy(): Promise<boolean> {
  try {
    const response = await fetch(`${DAEMON_HTTP_URL}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

export function buildAuthBootstrapUrl(extensionId: string | undefined): string {
  const url = new URL(`${DAEMON_HTTP_URL}/internal/auth-bootstrap`);
  if (extensionId) {
    url.searchParams.set("extensionId", extensionId);
  }
  return url.toString();
}

async function fetchAuthBootstrap(extensionId: string | undefined): Promise<AuthBootstrap | null> {
  try {
    const response = await fetch(buildAuthBootstrapUrl(extensionId));
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as {
      token?: unknown;
      allowedOrigins?: unknown;
    };
    if (
      typeof body.token !== "string" ||
      body.token.length === 0 ||
      !Array.isArray(body.allowedOrigins) ||
      !body.allowedOrigins.every((entry) => typeof entry === "string")
    ) {
      return null;
    }
    return {
      token: body.token,
      allowedOrigins: body.allowedOrigins as string[]
    };
  } catch {
    return null;
  }
}

async function ensureDaemonRunning(): Promise<void> {
  if (await daemonHealthy()) {
    return;
  }

  const runtimePath = path.resolve(import.meta.dirname, "runtime.js");
  await access(runtimePath);

  const child = spawn(process.execPath, [runtimePath], {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();

  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await daemonHealthy()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`UMB daemon did not become healthy at ${DAEMON_HTTP_URL}.`);
}

async function fetchDaemonHealth(): Promise<DaemonHealth | null> {
  try {
    const response = await fetch(`${DAEMON_HTTP_URL}/health`);
    if (!response.ok) {
      return null;
    }
    return await response.json() as DaemonHealth;
  } catch {
    return null;
  }
}

export async function handleRequest(
  request: NativeHostRequest,
  dependencies: NativeHostRuntimeDependencies = {
    ensureDaemonRunning,
    fetchAuthBootstrap,
    fetchDaemonHealth
  }
): Promise<NativeHostResponse> {
  const daemonHealth = await dependencies.fetchDaemonHealth();
  let auth = await dependencies.fetchAuthBootstrap(request.extensionId);

  const baseResponse = {
    daemonHttpUrl: DAEMON_HTTP_URL,
    daemonPid: daemonHealth?.daemon?.pid,
    daemonStartedAt: daemonHealth?.daemon?.startedAt,
    hostName: HOST_NAME,
    nativeHostPid: process.pid,
    wsUrl: DAEMON_WS_URL,
    bearerToken: auth?.token,
    allowedOrigins: auth?.allowedOrigins
  };

  switch (request.type) {
    case "ping":
      return {
        ok: true,
        ...baseResponse
      };
    case "getDaemonInfo":
    case undefined: {
      await dependencies.ensureDaemonRunning();
      auth = await dependencies.fetchAuthBootstrap(request.extensionId);
      if (!auth) {
        throw new Error("UMB daemon auth bootstrap did not return credentials.");
      }
      const refreshedHealth = await dependencies.fetchDaemonHealth();
      return {
        ok: true,
        ...baseResponse,
        bearerToken: auth.token,
        allowedOrigins: auth.allowedOrigins,
        daemonPid: refreshedHealth?.daemon?.pid,
        daemonStartedAt: refreshedHealth?.daemon?.startedAt
      };
    }
    default:
      return {
        ok: false,
        hostName: HOST_NAME,
        error: `Unsupported UMB native host request: ${request.type}`
      };
  }
}

function writeMessage(message: NativeHostResponse): void {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  process.stdout.write(header);
  process.stdout.write(payload);
}

async function* readMessages(): AsyncGenerator<NativeHostRequest, void, void> {
  let buffer = Buffer.alloc(0);

  for await (const chunk of process.stdin) {
    const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    buffer = Buffer.concat([buffer, bufferChunk]);

    while (buffer.length >= 4) {
      const messageLength = buffer.readUInt32LE(0);
      if (buffer.length < 4 + messageLength) {
        break;
      }

      const messageBuffer = buffer.subarray(4, 4 + messageLength);
      buffer = buffer.subarray(4 + messageLength);
      yield JSON.parse(messageBuffer.toString("utf8")) as NativeHostRequest;
    }
  }

  if (buffer.length > 0) {
    throw new Error("UMB native host received an incomplete message.");
  }
}

async function main() {
  let receivedMessage = false;

  for await (const request of readMessages()) {
    receivedMessage = true;
    const response = await handleRequest(request);
    writeMessage(response);
  }

  if (!receivedMessage) {
    throw new Error("UMB native host received an empty message stream.");
  }
}

const isMainModule =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  main().catch((error) => {
    writeMessage({
      ok: false,
      hostName: HOST_NAME,
      error: error instanceof Error ? error.message : String(error)
    });
    process.exit(1);
  });
}
