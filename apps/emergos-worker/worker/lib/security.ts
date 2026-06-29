import { makeId, nowIso } from "./db";
import type { RuntimeEnv } from "./runtime-env";

export function getClientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? request.headers.get("X-Forwarded-For") ?? "unknown";
}

export async function hashValue(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function assertBodySize(request: Request, maxBytes: number): Response | null {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > maxBytes) {
    return Response.json({ error: "Submission is too large." }, { status: 413 });
  }
  return null;
}

export async function rateLimit(
  db: D1Database,
  routeKey: string,
  actorHash: string,
  limit: number,
  windowSeconds: number
): Promise<boolean> {
  const since = new Date(Date.now() - windowSeconds * 1000).toISOString();
  const row = await db
    .prepare("SELECT COUNT(*) AS count FROM rate_limit_attempts WHERE route_key = ? AND actor_hash = ? AND created_at >= ?")
    .bind(routeKey, actorHash, since)
    .first<{ count: number }>();

  if ((row?.count ?? 0) >= limit) return false;

  await db
    .prepare("INSERT INTO rate_limit_attempts (id, route_key, actor_hash, created_at) VALUES (?, ?, ?, ?)")
    .bind(makeId("rate"), routeKey, actorHash, nowIso())
    .run();

  return true;
}

export async function validateTurnstile(request: Request, env: RuntimeEnv, formData: FormData, expectedAction?: string): Promise<Response | null> {
  if (env.BYPASS_TURNSTILE === "true") return null;

  const token = String(formData.get("cf-turnstile-response") ?? "");
  if (!env.TURNSTILE_SECRET_KEY) {
    return Response.json({ error: "Turnstile is not configured for this deployment." }, { status: 503 });
  }
  if (!token || token.length > 2048) {
    return Response.json({ error: "Human verification is required." }, { status: 400 });
  }

  const body = new FormData();
  body.append("secret", env.TURNSTILE_SECRET_KEY);
  body.append("response", token);
  body.append("remoteip", getClientIp(request));
  body.append("idempotency_key", crypto.randomUUID());

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body
  });
  const result = (await response.json()) as { success?: boolean; action?: string; "error-codes"?: string[] };

  if (!result.success) {
    return Response.json({ error: "Human verification failed.", codes: result["error-codes"] ?? [] }, { status: 400 });
  }

  if (expectedAction && result.action && result.action !== expectedAction) {
    return Response.json({ error: "Human verification action mismatch." }, { status: 400 });
  }

  return null;
}
