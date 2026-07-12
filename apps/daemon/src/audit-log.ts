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
  private directoryReady?: Promise<void>;
  private appendQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath = path.join(process.cwd(), ".umb-runtime", "audit.log.jsonl")
  ) {}

  write(entry: AuditLogEntry): Promise<void> {
    const line = `${JSON.stringify(entry)}\n`;
    const operation = this.appendQueue.then(async () => {
      this.directoryReady ??= mkdir(path.dirname(this.filePath), { recursive: true }).then(
        () => undefined
      );
      await this.directoryReady;
      await appendFile(this.filePath, line, "utf8");
    });
    this.appendQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  getPath(): string {
    return this.filePath;
  }
}
