#!/usr/bin/env node
import { spawn } from "node:child_process";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Options = {
  projectName: string;
  profile: string;
  country: string;
  locale: string;
  deployment: "cloudflare" | "local";
  modules: string[];
  templateDir: string;
  install: boolean;
  migrate: boolean;
  yes: boolean;
};

const defaultModules = ["missingPeople", "foundPeople", "tips", "flyers", "shelters", "hospitals", "aidCenters", "emergencyContacts", "organizations", "publicUpdates"];
const profileDefaults: Record<string, { country: string; locale: string; area: string }> = {
  earthquake: { country: "VE", locale: "es-VE", area: "Earthquake response" },
  flood: { country: "DE", locale: "de", area: "Flood response" },
  hurricane: { country: "US", locale: "en", area: "Hurricane response" },
  wildfire: { country: "US", locale: "en", area: "Wildfire response" },
  conflict: { country: "UA", locale: "en", area: "Displacement response" },
  multi: { country: "US", locale: "en", area: "Crisis response" }
};

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const options = await resolveOptions(parsed);
  const targetDir = resolve(process.cwd(), safeProjectDir(options.projectName));

  await mkdir(targetDir, { recursive: true });
  await cp(options.templateDir, targetDir, {
    recursive: true,
    filter: (source) =>
      !source.includes("node_modules") &&
      !source.includes(".wrangler") &&
      !source.includes("/dist") &&
      !source.endsWith(".dev.vars") &&
      !source.endsWith("worker-configuration.d.ts")
  });

  await writeConfig(targetDir, options);
  await writePackageJson(targetDir, options);
  await rewriteWrangler(targetDir, options);
  await writeDevVarsExample(targetDir);
  await writeStarterReadme(targetDir, options);

  if (options.install) await run("pnpm", ["install"], targetDir);
  if (options.migrate) await run("pnpm", ["db:migrations:apply:local"], targetDir);

  console.log(`Created emergOS starter at ${targetDir}`);
  console.log("");
  console.log("Next steps:");
  console.log(`  cd ${safeProjectDir(options.projectName)}`);
  if (!options.install) console.log("  pnpm install");
  console.log("  cp .dev.vars.example .dev.vars");
  if (!options.migrate) console.log("  pnpm db:migrations:apply:local");
  console.log("  pnpm dev");
  console.log("");
  console.log("Deploy when ready:");
  console.log("  pnpm build");
  console.log("  pnpm db:migrations:apply");
  console.log("  pnpm deploy");
}

function parseArgs(args: string[]): Partial<Options> {
  const flags = new Map<string, string>();
  const positional: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith("--")) {
      const [key, inlineValue] = arg.slice(2).split("=");
      const next = args[index + 1];
      const value = inlineValue ?? (next && !next.startsWith("--") ? next : "true");
      if (!inlineValue && next && !next.startsWith("--")) index += 1;
      flags.set(key, value);
    } else {
      positional.push(arg);
    }
  }

  const projectName = positional[0] ?? "emergos-site";
  return {
    projectName,
    profile: flags.get("profile"),
    country: flags.get("country"),
    locale: flags.get("locale"),
    deployment: normalizeDeployment(flags.get("deployment")),
    modules: flags.get("modules")?.split(",").map((value) => value.trim()).filter(Boolean),
    templateDir: resolveTemplateDir(flags.get("template")),
    install: flags.get("install") === "true",
    migrate: flags.get("migrate") === "true",
    yes: flags.get("yes") === "true" || flags.get("y") === "true"
  };
}

async function resolveOptions(parsed: Partial<Options>): Promise<Options> {
  const interactive = process.stdin.isTTY && !parsed.yes;
  const defaults = profileDefaults[parsed.profile ?? "earthquake"] ?? profileDefaults.earthquake;

  if (!interactive) {
    return {
      projectName: parsed.projectName ?? "emergos-site",
      profile: parsed.profile ?? "earthquake",
      country: parsed.country ?? defaults.country,
      locale: parsed.locale ?? defaults.locale,
      deployment: parsed.deployment ?? "cloudflare",
      modules: parsed.modules?.length ? parsed.modules : defaultModules,
      templateDir: parsed.templateDir ?? resolveTemplateDir(),
      install: parsed.install ?? false,
      migrate: parsed.migrate ?? false,
      yes: parsed.yes ?? false
    };
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const projectName = await ask(rl, "Project name", parsed.projectName ?? "emergos-site");
    const profile = await ask(rl, "Disaster profile", parsed.profile ?? "earthquake");
    const profileDefault = profileDefaults[profile] ?? defaults;
    const country = await ask(rl, "Country code", parsed.country ?? profileDefault.country);
    const locale = await ask(rl, "Default locale", parsed.locale ?? profileDefault.locale);
    const deployment = normalizeDeployment(await ask(rl, "Deployment mode (cloudflare/local)", parsed.deployment ?? "cloudflare")) ?? "cloudflare";
    const moduleList = await ask(rl, "Modules", (parsed.modules?.length ? parsed.modules : defaultModules).join(","));
    const install = await askBoolean(rl, "Install dependencies now?", parsed.install ?? false);
    const migrate = install ? await askBoolean(rl, "Apply local D1 migrations now?", parsed.migrate ?? false) : false;
    return {
      projectName,
      profile,
      country,
      locale,
      deployment,
      modules: moduleList.split(",").map((value) => value.trim()).filter(Boolean),
      templateDir: parsed.templateDir ?? resolveTemplateDir(),
      install,
      migrate,
      yes: false
    };
  } finally {
    rl.close();
  }
}

async function ask(rl: ReturnType<typeof createInterface>, label: string, fallback: string): Promise<string> {
  const answer = await rl.question(`${label} (${fallback}): `);
  return answer.trim() || fallback;
}

async function askBoolean(rl: ReturnType<typeof createInterface>, label: string, fallback: boolean): Promise<boolean> {
  const answer = await rl.question(`${label} (${fallback ? "Y/n" : "y/N"}): `);
  if (!answer.trim()) return fallback;
  return ["y", "yes", "true", "1"].includes(answer.trim().toLowerCase());
}

function normalizeDeployment(value?: string): Options["deployment"] | undefined {
  if (!value) return undefined;
  return value === "local" ? "local" : "cloudflare";
}

function resolveTemplateDir(explicit?: string): string {
  if (explicit) return resolve(process.cwd(), explicit);
  if (process.env.EMERGOS_TEMPLATE_DIR) return resolve(process.env.EMERGOS_TEMPLATE_DIR);

  const currentDir = dirname(fileURLToPath(import.meta.url));
  return resolve(currentDir, "../template");
}

function safeProjectDir(projectName: string): string {
  return projectName.trim().replace(/[^a-zA-Z0-9._-]/g, "-") || "emergos-site";
}

function packageName(projectName: string): string {
  return safeProjectDir(projectName).toLowerCase();
}

async function writeConfig(targetDir: string, options: Options): Promise<void> {
  const moduleEntries = defaultModules
    .map((module) => `    ${module}: ${options.modules.includes(module)}`)
    .join(",\n");

  const content = `export type DisasterProfile =
  | "earthquake"
  | "flood"
  | "hurricane"
  | "storm"
  | "wildfire"
  | "landslide"
  | "volcano"
  | "heatwave"
  | "coldwave"
  | "epidemic"
  | "conflict"
  | "displacement"
  | "industrial"
  | "infrastructure"
  | "multi";

export type EmergOSConfig = {
  brand?: {
    name?: string;
    primaryColor?: string;
    backgroundColor?: string;
  };
  disaster?: {
    profile?: DisasterProfile;
    country?: string;
    defaultLocale?: string;
    affectedAreaLabel?: string;
  };
  modules?: Partial<Record<string, boolean>>;
};

export function defineEmergOSConfig(config: EmergOSConfig): EmergOSConfig {
  return config;
}

export default defineEmergOSConfig({
  brand: {
    name: "emergOS",
    primaryColor: "#C91525",
    backgroundColor: "#FFFFFF"
  },
  disaster: {
    profile: "${options.profile}",
    country: "${options.country}",
    defaultLocale: "${options.locale}",
    affectedAreaLabel: "${options.country} ${options.profile} response"
  },
  modules: {
${moduleEntries}
  }
});
`;

  await writeFile(resolve(targetDir, "emergos.config.ts"), content, "utf8");
}

async function writePackageJson(targetDir: string, options: Options): Promise<void> {
  const path = resolve(targetDir, "package.json");
  const pkg = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  pkg.name = packageName(options.projectName);
  pkg.private = true;
  pkg.description = `${options.country} ${options.profile} emergOS response site`;
  await writeFile(path, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
}

async function rewriteWrangler(targetDir: string, options: Options): Promise<void> {
  const path = resolve(targetDir, "wrangler.jsonc");
  const wrangler = await readFile(path, "utf8");
  const updated = wrangler
    .replace('"name": "emergos"', `"name": "${packageName(options.projectName)}"`)
    .replace('"DISASTER_PROFILE": "earthquake"', `"DISASTER_PROFILE": "${options.profile}"`)
    .replace('"COUNTRY_CODE": "VE"', `"COUNTRY_CODE": "${options.country}"`)
    .replace('"DEFAULT_LOCALE": "en"', `"DEFAULT_LOCALE": "${options.locale}"`)
    .replace('"AFFECTED_AREA_LABEL": "Crisis response"', `"AFFECTED_AREA_LABEL": "${options.country} ${options.profile} response"`)
    .replace('"PUBLIC_SITE_NAME": "emergOS"', `"PUBLIC_SITE_NAME": "${options.projectName}"`)
    .replace('"database_name": "emergos-db"', `"database_name": "${packageName(options.projectName)}-db"`)
    .replace('"bucket_name": "emergos-media"', `"bucket_name": "${packageName(options.projectName)}-media"`)
    .replaceAll('"queue": "emergos-jobs"', `"queue": "${packageName(options.projectName)}-jobs"`);
  await writeFile(path, updated, "utf8");
}

async function writeDevVarsExample(targetDir: string): Promise<void> {
  const content = `TURNSTILE_SECRET_KEY=
SESSION_SECRET=
ADMIN_BOOTSTRAP_EMAIL=owner@example.org
EMAIL_FORWARD_TO=
EMAIL_FROM=
OPTIONAL_EMAIL_PROVIDER_API_KEY=
OPTIONAL_SMS_PROVIDER_API_KEY=
OPTIONAL_WHATSAPP_PROVIDER_API_KEY=
ENABLE_WORKERS_AI=false
ENABLE_VECTORIZE=false
ENABLE_PWA=true
BYPASS_TURNSTILE=true
`;
  await writeFile(resolve(targetDir, ".dev.vars.example"), content, "utf8");
}

async function writeStarterReadme(targetDir: string, options: Options): Promise<void> {
  const content = `# ${options.projectName}

Generated by \`create-emergos\`.

## Configuration

- Disaster profile: \`${options.profile}\`
- Country: \`${options.country}\`
- Locale: \`${options.locale}\`
- Deployment mode: \`${options.deployment}\`
- Modules: \`${options.modules.join(",")}\`

## Local Development

\`\`\`bash
pnpm install
cp .dev.vars.example .dev.vars
pnpm db:migrations:apply:local
pnpm dev
\`\`\`

## Cloudflare setup

Before the first production deploy, create or connect:

- D1 database matching \`${packageName(options.projectName)}-db\`
- R2 bucket matching \`${packageName(options.projectName)}-media\`
- KV namespace for \`CONFIG_KV\`
- Queue matching \`${packageName(options.projectName)}-jobs\`
- Secrets: \`TURNSTILE_SECRET_KEY\`, \`SESSION_SECRET\`, and \`ADMIN_BOOTSTRAP_EMAIL\`

Then replace placeholder IDs in \`wrangler.jsonc\`.

## Deploy to Cloudflare

\`\`\`bash
pnpm build
pnpm db:migrations:apply
pnpm deploy
\`\`\`
`;

  await writeFile(resolve(targetDir, "README.md"), content, "utf8");
}

async function run(command: string, args: string[], cwd: string): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
    child.on("error", reject);
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
