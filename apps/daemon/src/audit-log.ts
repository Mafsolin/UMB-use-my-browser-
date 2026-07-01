import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";

export type AuditLogEntry = {
  timestamp: string;
  sessionId: string;
  clientId: string;
  sessionName?: string;
  commandType: string;
  tabId?: string;
  origin?: string;
  result: "ok" | "error";
  message?: string;
};

export class AuditLogger {
  constructor(
    private readonly filePath = path.join(process.cwd(), ".umb-runtime", "audit.log.jsonl")
  ) {}

  async write(entry: AuditLogEntry): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, `${JSON.stringify(entry)}\n`, "utf8");
  }

  getPath(): string {
    return this.filePath;
  }
}
