import { mkdirSync } from "node:fs";
import path from "node:path";
import pino from "pino";
import pretty from "pino-pretty";
import { createStream as createRotatingStream } from "rotating-file-stream";
import type { PersistedConfig } from "./persisted-config.js";
import { resolvePaseoHome } from "./paseo-home.js";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";
export type LogFormat = "pretty" | "json";

export interface ResolvedLogConfig {
  level: LogLevel;
  console: {
    level: LogLevel;
    format: LogFormat;
  };
  file?: {
    level: LogLevel;
    path: string;
  };
}

interface LegacyLogConfig {
  level?: LogLevel;
  format?: LogFormat;
}

type LoggerConfigInput = PersistedConfig | LegacyLogConfig | undefined;

interface ResolveLogConfigOptions {
  paseoHome?: string;
  file?: boolean;
}

const LOG_LEVEL_PRIORITIES: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

const DEFAULT_CONSOLE_LEVEL: LogLevel = "info";
const DEFAULT_CONSOLE_FORMAT: LogFormat = "json";
const DEFAULT_FILE_LEVEL: LogLevel = "info";
const DEFAULT_DAEMON_LOG_FILENAME = "daemon.log";
const REDACT_PATHS = [
  "authorization",
  "Authorization",
  "headers.authorization",
  "headers.Authorization",
  "req.headers.authorization",
  "req.headers.Authorization",
  '["sec-websocket-protocol"]',
  "Sec-WebSocket-Protocol",
  'headers["sec-websocket-protocol"]',
  "headers.Sec-WebSocket-Protocol",
  'req.headers["sec-websocket-protocol"]',
  "req.headers.Sec-WebSocket-Protocol",
];

function resolveFilePath(paseoHome: string, configuredPath: string | undefined): string {
  const fallback = path.join(paseoHome, DEFAULT_DAEMON_LOG_FILENAME);
  if (!configuredPath) {
    return fallback;
  }

  if (path.isAbsolute(configuredPath)) {
    return configuredPath;
  }

  return path.resolve(paseoHome, configuredPath);
}

function minLogLevel(levels: LogLevel[]): LogLevel {
  let minLevel = levels[0];

  for (const level of levels) {
    if (LOG_LEVEL_PRIORITIES[level] < LOG_LEVEL_PRIORITIES[minLevel]) {
      minLevel = level;
    }
  }

  return minLevel;
}

function resolveConfiguredPaseoHome(options: ResolveLogConfigOptions | undefined): string {
  if (options?.paseoHome) {
    return options.paseoHome;
  }
  return resolvePaseoHome();
}

function normalizeLoggerConfigInput(config: LoggerConfigInput): PersistedConfig | undefined {
  if (!config) {
    return undefined;
  }

  if ("log" in config) {
    return config;
  }

  if ("level" in config || "format" in config) {
    const legacy = config;
    return {
      log: {
        ...(legacy.level ? { level: legacy.level } : {}),
        ...(legacy.format ? { format: legacy.format } : {}),
      },
    };
  }

  return config as PersistedConfig;
}

interface LogLevelResolution {
  consoleLevel: LogLevel;
  fileLevel?: LogLevel;
  consoleFormat: LogFormat;
}

function resolveLogLevelsAndFormat(
  persistedLog: NonNullable<ReturnType<typeof normalizeLoggerConfigInput>>["log"] | undefined,
): LogLevelResolution {
  const persistedGlobalLevel = persistedLog?.level;
  const consoleLevel: LogLevel =
    persistedLog?.console?.level ?? persistedGlobalLevel ?? DEFAULT_CONSOLE_LEVEL;
  const fileLevel = persistedLog?.file
    ? (persistedLog.file.level ?? persistedGlobalLevel ?? DEFAULT_FILE_LEVEL)
    : undefined;
  const consoleFormat: LogFormat =
    persistedLog?.console?.format ?? persistedLog?.format ?? DEFAULT_CONSOLE_FORMAT;
  return { consoleLevel, fileLevel, consoleFormat };
}

export function resolveLogConfig(
  configInput: LoggerConfigInput,
  options?: ResolveLogConfigOptions,
): ResolvedLogConfig {
  const persistedConfig = normalizeLoggerConfigInput(configInput);
  const paseoHome = resolveConfiguredPaseoHome(options);
  const persistedLog = persistedConfig?.log;

  const { consoleLevel, fileLevel, consoleFormat } = resolveLogLevelsAndFormat(persistedLog);
  const file =
    options?.file !== false && persistedLog?.file
      ? {
          level: fileLevel ?? DEFAULT_FILE_LEVEL,
          path: resolveFilePath(paseoHome, persistedLog.file.path),
        }
      : undefined;

  return {
    level: minLogLevel(file ? [consoleLevel, file.level] : [consoleLevel]),
    console: {
      level: consoleLevel,
      format: consoleFormat,
    },
    ...(file ? { file } : {}),
  };
}

// Log rotation: 50MB max per file, keep 7 rotated files, compress old logs.
const LOG_ROTATION_SIZE = "50M";
const LOG_ROTATION_KEEP = 7;
const LOG_ROTATION_COMPRESS = "gzip";

export function createRootLogger(
  configInput: LoggerConfigInput,
  options?: ResolveLogConfigOptions,
): pino.Logger {
  const config = resolveLogConfig(configInput, options);
  if (config.file) {
    mkdirSync(path.dirname(config.file.path), { recursive: true });
  }

  let stream: pino.DestinationStream;

  if (config.console.format === "pretty") {
    stream = pretty({
      colorize: true,
      singleLine: true,
      ignore: "pid,hostname",
      destination: config.file?.path ?? 1,
    });
  } else if (config.file) {
    // Production: rotating file stream (50MB per file, 7 retained, gzip compressed)
    const filePath = config.file.path;
    const dir = path.dirname(filePath);
    const filename = path.basename(filePath);
    stream = createRotatingStream(filename, {
      path: dir,
      size: LOG_ROTATION_SIZE,
      maxFiles: LOG_ROTATION_KEEP,
      compress: LOG_ROTATION_COMPRESS,
    });
  } else {
    stream = pino.destination({ dest: 1, sync: false });
  }

  return pino(
    {
      level: config.file?.level ?? config.console.level,
      redact: { paths: REDACT_PATHS, remove: true },
    },
    stream,
  );
}

export function createChildLogger(parent: pino.Logger, name: string): pino.Logger {
  return parent.child({ name });
}
