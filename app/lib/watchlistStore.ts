import { Redis } from "@upstash/redis";

let redisClient: Redis | null = null;

export function getRedis() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    throw new Error("Redis watchlist storage is not configured.");
  }

  redisClient ??= new Redis({ url, token });
  return redisClient;
}

export function watchlistKey(userId: string) {
  return `watchlist:${userId}`;
}
