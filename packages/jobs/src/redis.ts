import IORedis, { type RedisOptions } from "ioredis";

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
}

function booleanValue(value: string | undefined, name: string): boolean {
  if (value === undefined || value === "") return false;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be "true" or "false"`);
}

export function redisOptions(
  env: NodeJS.ProcessEnv = process.env,
): RedisOptions {
  const port = positiveInteger(env.REDIS_PORT, 6379, "REDIS_PORT");
  if (port < 1 || port > 65535) {
    throw new Error("REDIS_PORT must be between 1 and 65535");
  }
  const options: RedisOptions = {
    host: env.REDIS_HOST || "127.0.0.1",
    port,
    db: positiveInteger(env.REDIS_DB, 0, "REDIS_DB"),
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy: (attempt) => Math.min(attempt * 250, 5000),
  };
  if (env.REDIS_PASSWORD) options.password = env.REDIS_PASSWORD;
  if (booleanValue(env.REDIS_TLS, "REDIS_TLS")) {
    options.tls = { rejectUnauthorized: true };
  }
  return options;
}

export function createRedisConnection(env?: NodeJS.ProcessEnv): IORedis {
  return new IORedis(redisOptions(env));
}
