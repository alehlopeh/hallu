// Tiny leveled logger. "debug" (the default) also prints every executed SQL
// statement; "info" keeps the operational lines but drops SQL; "silent" is quiet.

export type LogLevel = "debug" | "info" | "silent";

const RANK: Record<LogLevel, number> = { debug: 0, info: 1, silent: 2 };
let threshold = RANK.debug;

export function setLogLevel(level: LogLevel): void {
  threshold = RANK[level];
}

export function debug(msg: string): void {
  if (threshold <= RANK.debug) console.log(`[hallu] ${msg}`);
}

export function info(msg: string): void {
  if (threshold <= RANK.info) console.log(`[hallu] ${msg}`);
}
