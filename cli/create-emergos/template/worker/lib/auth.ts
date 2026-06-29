import { audit, makeId, nowIso } from "./db";
import type { Role } from "../../src/lib/contracts";
import type { RuntimeEnv } from "./runtime-env";

const writeRoles: Role[] = ["owner", "admin", "moderator", "verifier", "organization_manager"];
const adminRoles: Role[] = ["owner", "admin"];

export type Actor = {
  email: string;
  role: Role;
  userId: string | null;
};

export async function requireActor(request: Request, env: RuntimeEnv, roles: Role[] = writeRoles): Promise<Actor | Response> {
  const accessEmail = request.headers.get("cf-access-authenticated-user-email");
  const localEmail = request.headers.get("x-emergos-admin-email");
  const email = accessEmail || (localEmail && localEmail === env.ADMIN_BOOTSTRAP_EMAIL ? localEmail : null);

  if (!email) {
    return Response.json({ error: "Admin authentication required." }, { status: 401 });
  }

  if (email === env.ADMIN_BOOTSTRAP_EMAIL) {
    return { email, role: "owner", userId: null };
  }

  const user = await env.DB.prepare("SELECT id, role FROM users WHERE email = ?").bind(email).first<{ id: string; role: Role }>();
  if (!user || !roles.includes(user.role)) {
    return Response.json({ error: "Insufficient permissions." }, { status: 403 });
  }

  return { email, role: user.role, userId: user.id };
}

export async function ensureBootstrapUser(env: RuntimeEnv): Promise<void> {
  if (!env.ADMIN_BOOTSTRAP_EMAIL) return;
  const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(env.ADMIN_BOOTSTRAP_EMAIL).first<{ id: string }>();
  if (existing) return;

  const id = makeId("user");
  const timestamp = nowIso();
  await env.DB.prepare(
    "INSERT INTO users (id, email, name, role, auth_provider, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(id, env.ADMIN_BOOTSTRAP_EMAIL, "Bootstrap owner", "owner", "cloudflare_access", timestamp, timestamp)
    .run();
  await audit(env.DB, {
    actorEmail: env.ADMIN_BOOTSTRAP_EMAIL,
    action: "user_bootstrapped",
    entityType: "user",
    entityId: id,
    reason: "ADMIN_BOOTSTRAP_EMAIL"
  });
}

export function rolesForAdminOnly(): Role[] {
  return adminRoles;
}
