import fs from 'fs';
import path from 'path';

class Logger {
  private logDir: string;
  private logFile: string;

  constructor() {
    this.logDir = path.join(process.cwd(), 'logs');
    this.logFile = path.join(this.logDir, `postgresql-mcp-${new Date().toISOString().split('T')[0]}.log`);

    // Créer le dossier de logs s'il n'existe pas
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  private formatMessage(level: string, ...args: any[]): string {
    const timestamp = new Date().toISOString();
    const message = args.map(arg =>
      typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
    ).join(' ');

    return `[${timestamp}] [${level}] ${message}`;
  }

  private writeLog(level: string, ...args: any[]): void {
    const message = this.formatMessage(level, ...args);

    // Écrire dans le fichier de log
    fs.appendFileSync(this.logFile, message + '\n');

    // Afficher dans stderr pour ne pas interférer avec MCP
    console.error(message);
  }

  info(...args: any[]): void {
    this.writeLog('INFO', ...args);
  }

  warn(...args: any[]): void {
    this.writeLog('WARN', ...args);
  }

  error(...args: any[]): void {
    this.writeLog('ERROR', ...args);
  }

  debug(...args: any[]): void {
    if (process.env.NODE_ENV === 'development') {
      this.writeLog('DEBUG', ...args);
    }
  }
}

export default new Logger();