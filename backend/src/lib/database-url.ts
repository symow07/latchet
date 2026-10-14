import { userInfo } from "node:os";

/**
 * Postgres connection URLs.
 *
 * libpq (psql, createdb, pg_dump) fills in a missing user name from PGUSER, or
 * else the operating-system user, so `postgresql://localhost:5432/latchet_dev`
 * works at a shell. Prisma does not: it sends an empty user name, which
 * Postgres refuses before authentication even starts ("no PostgreSQL user name
 * specified in startup packet", Prisma error P1010). The local URLs this
 * project defaults to are written the libpq way, so they are completed here,
 * the way libpq would, before Prisma sees them. A URL that names its user — any
 * hosted database's — is returned unchanged.
 */

/** True for a postgres:// or postgresql:// URL with a database name. */
export function isPostgresUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") return false;
  return databaseName(value) !== "";
}

/** The database a Postgres URL points at ("" when it names none). */
export function databaseName(value: string): string {
  try {
    return decodeURIComponent(new URL(value).pathname.replace(/^\//, ""));
  } catch {
    return "";
  }
}

function osUserName(): string {
  try {
    return userInfo().username;
  } catch {
    // No passwd entry (some containers). Leave the URL as it was.
    return "";
  }
}

/**
 * The URL with libpq's default user filled in when it names none: PGUSER if
 * set, otherwise the operating-system user. Everything else is untouched.
 */
export function withDefaultUser(
  value: string,
  env: Record<string, string | undefined> = process.env,
  osUser: () => string = osUserName
): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return value;
  }
  if (url.username || !url.host) return value;
  const user = env.PGUSER || osUser();
  if (!user) return value;
  url.username = encodeURIComponent(user);
  return url.toString();
}

/** The same server, connected to another database (e.g. the maintenance one). */
export function withDatabase(value: string, database: string): string {
  const url = new URL(value);
  url.pathname = `/${encodeURIComponent(database)}`;
  return url.toString();
}

/** The schema Prisma uses for this URL: its `schema` parameter, else public. */
export function prismaSchema(value: string): string {
  try {
    return new URL(value).searchParams.get("schema") || "public";
  } catch {
    return "public";
  }
}

/**
 * The URL for a plain Postgres driver (Bun.SQL, psql): Prisma's own query
 * parameters (connection_limit, schema, pool_timeout, pgbouncer, …) removed.
 * Bun.SQL forwards unknown parameters to the server as settings, which the
 * server rejects, and libpq refuses them outright. Only sslmode is kept.
 */
export function forPlainDriver(value: string): string {
  const url = new URL(value);
  const sslmode = url.searchParams.get("sslmode");
  url.search = "";
  if (sslmode) url.searchParams.set("sslmode", sslmode);
  return url.toString();
}
