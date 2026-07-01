import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const DAEMON_HTTP_URL = process.env.UMB_DAEMON_HTTP_URL ?? "http://127.0.0.1:44777";
const DAEMON_WS_URL = process.env.UMB_DAEMON_WS_URL ?? "ws://127.0.0.1:44777/extension";
const HOST_NAME = "com.umb.use_my_browser";

type NativeHostRequest = {
  type?: string;
};

type NativeHostResponse = {
  ok: boolean;
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

async function handleRequest(request: NativeHostRequest): Promise<NativeHostResponse> {
  const daemonHealth = await (async () => {
    try {
      const response = await fetch(`${DAEMON_HTTP_URL}/health`);
      if (!response.ok) {
        return null;
      }

      return (await response.json()) as {
        daemon?: {
          pid?: number;
          startedAt?: string;
        };
      };
    } catch {
      return null;
    }
  })();

  switch (request.type) {
    case "ping":
      return {
        ok: true,
        daemonHttpUrl: DAEMON_HTTP_URL,
        daemonPid: daemonHealth?.daemon?.pid,
        daemonStartedAt: daemonHealth?.daemon?.startedAt,
        hostName: HOST_NAME,
        nativeHostPid: process.pid,
        wsUrl: DAEMON_WS_URL
      };
    case "getDaemonInfo":
    case undefined:
      await ensureDaemonRunning();
      const refreshedHealth = await fetch(`${DAEMON_HTTP_URL}/health`).then((response) =>
        response.json()
      ) as {
        daemon?: {
          pid?: number;
          startedAt?: string;
        };
      };
      return {
        ok: true,
        daemonHttpUrl: DAEMON_HTTP_URL,
        daemonPid: refreshedHealth?.daemon?.pid,
        daemonStartedAt: refreshedHealth?.daemon?.startedAt,
        hostName: HOST_NAME,
        nativeHostPid: process.pid,
        wsUrl: DAEMON_WS_URL
      };
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

main().catch((error) => {
  writeMessage({
    ok: false,
    hostName: HOST_NAME,
    error: error instanceof Error ? error.message : String(error)
  });
  process.exit(1);
});
