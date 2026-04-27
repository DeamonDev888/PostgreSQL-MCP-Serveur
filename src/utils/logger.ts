import fs from "fs";
import path from "path";

class Logger {
  private logDir: string;
  private logFile: string;
  private stream: fs.WriteStream | null = null;
  private isDev: boolean;

  constructor() {
    this.logDir = path.join(process.cwd(), "logs");
    this.logFile = path.join(
      this.logDir,
      `postgresql-mcp-${new Date().toISOString().split("T")[0]}.log`,
    );
    this.isDev = process.env.NODE_ENV !== "production";

    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }

    this.stream = fs.createWriteStream(this.logFile, { flags: "a" });
  }

  private formatMessage(level: string, ...args: any[]): string {
    const timestamp = new Date().toISOString();
    const message = args
      .map((arg) =>
        typeof arg === "object" ? JSON.stringify(arg, null, 2) : String(arg),
      )
      .join(" ");

    return `[${timestamp}] [${level}] ${message}`;
  }

  private writeLog(level: string, ...args: any[]): void {
    const message = this.formatMessage(level, ...args);

    if (this.stream) {
      this.stream.write(message + "\n");
    }

    if (this.isDev) {
      process.stderr.write(message + "\n");
    }
  }

  info(...args: any[]): void {
    this.writeLog("INFO", ...args);
  }

  warn(...args: any[]): void {
    this.writeLog("WARN", ...args);
  }

  error(...args: any[]): void {
    this.writeLog("ERROR", ...args);
    process.stderr.write(this.formatMessage("ERROR", ...args) + "\n");
  }

  debug(...args: any[]): void {
    if (this.isDev) {
      this.writeLog("DEBUG", ...args);
    }
  }

  close(): void {
    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }
  }
}

export default new Logger();
