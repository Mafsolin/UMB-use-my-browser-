import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

export type SpawnOptions = {
  detached: boolean;
  env: NodeJS.ProcessEnv;
  stdio: "ignore";
  windowsHide: boolean;
};

type SpawnedDaemon = {
  once(event: "error", listener: (error: Error) => void): unknown;
  unref(): void;
};

export type DaemonLifecycleOptions = {
  daemonHttpUrl?: string;
  daemonPort?: string | number;
  runtimePath?: string;
  attempts?: number;
  pollIntervalMs?: number;
  healthTimeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof globalThis.fetch;
  spawn?: (command: string, args: string[], options: SpawnOptions) => SpawnedDaemon;
  access?: (path: string) => Promise<void>;
  sleep?: (milliseconds: number) => Promise<void>;
};

export type DaemonEndpoints = {
  httpUrl: string;
  wsUrl: string;
  port: number;
};

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 44777;
const DEFAULT_HTTP_URL = `http://${DEFAULT_HOST}:${DEFAULT_PORT}`;
const MAX_TIMEOUT_MS = 2_147_483_647;
const starts = new Map<string, Promise<void>>();

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized === "::1") return true;
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(normalized);
  return Boolean(match && match.slice(1).every((part) => Number(part) <= 255) && Number(match![1]) === 127);
}

function parsePort(value: string | number | undefined, label: string): number | undefined {
  if (value === undefined || value === "") return undefined;
  const port = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${label} must be an integer between 1 and 65535.`);
  }
  return port;
}

export function resolveDaemonEndpoints(options: Pick<DaemonLifecycleOptions,
  "daemonHttpUrl" | "daemonPort" | "env"> = {}): DaemonEndpoints {
  const env = options.env ?? process.env;
  const explicitHttpUrl = options.daemonHttpUrl ?? env.UMB_DAEMON_HTTP_URL;
  const configuredPort = parsePort(options.daemonPort ?? env.UMB_DAEMON_PORT, "UMB_DAEMON_PORT");
  const rawHttpUrl = explicitHttpUrl ?? (configuredPort === undefined
    ? DEFAULT_HTTP_URL
    : `http://${DEFAULT_HOST}:${configuredPort}`);
  let url: URL;
  try {
    url = new URL(rawHttpUrl);
  } catch {
    throw new Error(`UMB daemon HTTP URL is invalid: ${rawHttpUrl}`);
  }
  if (url.protocol !== "http:" || !isLoopbackHostname(url.hostname)) {
    throw new Error(`UMB daemon HTTP URL must use http:// and a loopback host: ${rawHttpUrl}`);
  }
  if (url.username || url.password || (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) {
    throw new Error(`UMB daemon HTTP URL must contain only a loopback origin: ${rawHttpUrl}`);
  }

  const urlPort = Number(url.port || "80");
  if (explicitHttpUrl !== undefined && configuredPort !== undefined && configuredPort !== urlPort) {
    throw new Error(`UMB_DAEMON_PORT (${configuredPort}) conflicts with UMB_DAEMON_HTTP_URL port (${urlPort}).`);
  }
  const wsUrl = `ws://${url.host}/extension`;
  url.pathname = "";
  const httpUrl = url.origin;
  return { httpUrl, wsUrl, port: urlPort };
}

function isHealthPayload(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  if (body.ok !== true || !body.daemon || typeof body.daemon !== "object" || Array.isArray(body.daemon) ||
      !body.extension || typeof body.extension !== "object" || Array.isArray(body.extension)) return false;
  const daemon = body.daemon as Record<string, unknown>;
  const extension = body.extension as Record<string, unknown>;
  return Number.isSafeInteger(daemon.pid) && Number(daemon.pid) > 0 &&
    typeof daemon.startedAt === "string" && !Number.isNaN(Date.parse(daemon.startedAt)) &&
    typeof extension.connected === "boolean";
}

function boundedTimeout(timeoutMs: number): number {
  if (!Number.isFinite(timeoutMs)) return MAX_TIMEOUT_MS;
  return Math.max(1, Math.min(MAX_TIMEOUT_MS, Math.trunc(timeoutMs)));
}

export async function isDaemonHealthy(
  daemonHttpUrl = process.env.UMB_DAEMON_HTTP_URL ?? DEFAULT_HTTP_URL,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
  timeoutMs = 1_000
): Promise<boolean> {
  try {
    const response = await fetchImpl(`${daemonHttpUrl.replace(/\/$/, "")}/health`, {
      signal: AbortSignal.timeout(boundedTimeout(timeoutMs))
    });
    if (!response.ok) return false;
    return isHealthPayload(await response.json());
  } catch {
    return false;
  }
}

export function ensureDaemonRunning(options: DaemonLifecycleOptions = {}): Promise<void> {
  let endpoints: DaemonEndpoints;
  try {
    endpoints = resolveDaemonEndpoints(options);
  } catch (error) {
    return Promise.reject(error);
  }
  const existing = starts.get(endpoints.httpUrl);
  if (existing) return existing;

  const start = ensureDaemonRunningOnce(endpoints, options)
    .finally(() => starts.delete(endpoints.httpUrl));
  starts.set(endpoints.httpUrl, start);
  return start;
}

async function ensureDaemonRunningOnce(
  endpoints: DaemonEndpoints,
  options: DaemonLifecycleOptions
): Promise<void> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.healthTimeoutMs ?? 1_000;
  const healthy = () => isDaemonHealthy(endpoints.httpUrl, fetchImpl, timeoutMs);
  if (await healthy()) return;

  const runtimePath = options.runtimePath ?? path.resolve(import.meta.dirname, "runtime.js");
  await (options.access ?? access)(runtimePath);

  // Close the cross-process race between the first health check and spawning.
  if (await healthy()) return;

  const spawnImpl = options.spawn ?? spawn;
  const child = spawnImpl(process.execPath, [runtimePath], {
    detached: true,
    env: {
      ...(options.env ?? process.env),
      UMB_DAEMON_PORT: String(endpoints.port),
      UMB_DAEMON_HTTP_URL: endpoints.httpUrl,
      UMB_DAEMON_WS_URL: endpoints.wsUrl
    },
    stdio: "ignore",
    windowsHide: true
  });
  let spawnError: Error | undefined;
  child.once("error", (error) => { spawnError = error; });
  child.unref();

  const attempts = options.attempts ?? 20;
  const pollIntervalMs = options.pollIntervalMs ?? 250;
  const sleep = options.sleep ?? ((milliseconds: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await sleep(pollIntervalMs);
    if (await healthy()) return;
    if (spawnError) throw spawnError;
  }

  throw new Error(`UMB daemon did not become healthy at ${endpoints.httpUrl}.`);
}
