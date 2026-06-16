import { SecretRedactor } from './redaction';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Where log lines go. Default impl wraps a VS Code OutputChannel. */
export interface LogSink {
  append(line: string): void;
}

/**
 * Structured logger. Every line is JSON and is run through the redactor before
 * it reaches the sink — so even a secret accidentally placed in `meta` cannot be
 * written (SEC-4: assert no key substring in any log).
 */
export class Logger {
  constructor(
    private readonly sink: LogSink,
    private readonly redactor?: SecretRedactor,
  ) {}

  private write(level: LogLevel, msg: string, meta?: unknown): void {
    const entry: Record<string, unknown> = {
      t: new Date().toISOString(),
      level,
      msg,
    };
    if (meta !== undefined) {
      entry.meta = meta;
    }
    let line: string;
    try {
      line = JSON.stringify(entry);
    } catch {
      line = JSON.stringify({ t: entry.t, level, msg, meta: '[unserializable]' });
    }
    if (this.redactor) {
      line = this.redactor.redactText(line);
    }
    this.sink.append(line);
  }

  debug(msg: string, meta?: unknown): void {
    this.write('debug', msg, meta);
  }
  info(msg: string, meta?: unknown): void {
    this.write('info', msg, meta);
  }
  warn(msg: string, meta?: unknown): void {
    this.write('warn', msg, meta);
  }
  error(msg: string, meta?: unknown): void {
    this.write('error', msg, meta);
  }
}
