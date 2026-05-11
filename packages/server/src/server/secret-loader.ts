import { readFileSync, existsSync } from "node:fs";

const DOCKER_SECRETS_DIR = "/run/secrets";

/**
 * Load a secret value from Docker secrets or fall back to env var.
 *
 * Resolution order:
 * 1. Docker secret file at /run/secrets/<name> (trimmed)
 * 2. Environment variable with the given key
 * 3. undefined
 */
export function loadSecret(
  name: string,
  options?: { env?: NodeJS.ProcessEnv; secretsDir?: string },
): string | undefined {
  const secretsDir = options?.secretsDir ?? DOCKER_SECRETS_DIR;
  const secretPath = `${secretsDir}/${name}`;

  if (existsSync(secretPath)) {
    try {
      return readFileSync(secretPath, "utf8").trim();
    } catch {
      // Fall through to env var
    }
  }

  const env = options?.env ?? process.env;
  return env[name];
}

/**
 * Load multiple secrets at once. Returns a record of name → value.
 * Missing secrets are omitted from the result.
 */
export function loadSecrets(
  names: string[],
  options?: { env?: NodeJS.ProcessEnv; secretsDir?: string },
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const name of names) {
    const value = loadSecret(name, options);
    if (value !== undefined) {
      result[name] = value;
    }
  }
  return result;
}

/** Well-known secret names used by Paseo */
export const PASEO_SECRETS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "PASEO_PASSWORD",
  "GITHUB_TOKEN",
] as const;
