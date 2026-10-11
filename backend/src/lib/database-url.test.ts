import { test, expect } from "bun:test";
import {
  isPostgresUrl, databaseName, withDefaultUser, withDatabase, prismaSchema, forPlainDriver,
} from "./database-url";

test("only postgres URLs that name a database are accepted", () => {
  expect(isPostgresUrl("postgresql://localhost:5432/budget_dev")).toBe(true);
  expect(isPostgresUrl("postgres://u:p@db.internal:5432/railway?sslmode=require")).toBe(true);
  // The old single-file URL, and anything that is not a URL at all.
  expect(isPostgresUrl("file:dev.db")).toBe(false);
  expect(isPostgresUrl("mysql://localhost/budget")).toBe(false);
  expect(isPostgresUrl("localhost:5432/budget")).toBe(false);
  expect(isPostgresUrl("")).toBe(false);
  // A server with no database is not somewhere the app can run.
  expect(isPostgresUrl("postgresql://localhost:5432")).toBe(false);
  expect(isPostgresUrl("postgresql://localhost:5432/")).toBe(false);
});

test("the database name is read from the path", () => {
  expect(databaseName("postgresql://localhost:5432/budget_test")).toBe("budget_test");
  expect(databaseName("postgresql://u@h/budget_test?connection_limit=5")).toBe("budget_test");
  expect(databaseName("not a url")).toBe("");
});

test("a URL without a user gets libpq's default, as psql would use", () => {
  // Prisma sends an empty user name otherwise, which Postgres refuses outright.
  const url = withDefaultUser("postgresql://localhost:5432/budget_dev", {}, () => "apple");
  expect(url).toBe("postgresql://apple@localhost:5432/budget_dev");
});

test("PGUSER wins over the operating-system user, as in libpq", () => {
  const url = withDefaultUser("postgresql://localhost:5432/budget_dev", { PGUSER: "ci" }, () => "apple");
  expect(url).toBe("postgresql://ci@localhost:5432/budget_dev");
});

test("a URL that names its user is returned exactly as given", () => {
  // Hosted databases always carry credentials; re-serialising them could alter
  // a percent-encoded password, so the string is not even re-built.
  const hosted = "postgresql://postgres:p%40ss%2Fw0rd@db.railway.internal:5432/railway?sslmode=require";
  expect(withDefaultUser(hosted, { PGUSER: "ci" }, () => "apple")).toBe(hosted);
});

test("query parameters survive, and nothing is invented when no user is known", () => {
  expect(withDefaultUser("postgresql://localhost:5432/budget_test?connection_limit=3", {}, () => "apple"))
    .toBe("postgresql://apple@localhost:5432/budget_test?connection_limit=3");
  expect(withDefaultUser("postgresql://localhost:5432/budget_test", {}, () => ""))
    .toBe("postgresql://localhost:5432/budget_test");
  expect(withDefaultUser("not a url", {}, () => "apple")).toBe("not a url");
});

test("switching database keeps the server, user and parameters", () => {
  expect(withDatabase("postgresql://apple@localhost:5432/budget_test?sslmode=disable", "postgres"))
    .toBe("postgresql://apple@localhost:5432/postgres?sslmode=disable");
});

test("Prisma's schema parameter is honoured, public otherwise", () => {
  expect(prismaSchema("postgresql://u@h/budget_test?schema=ci")).toBe("ci");
  expect(prismaSchema("postgresql://u@h/budget_test")).toBe("public");
});

test("a plain driver gets the URL without Prisma's parameters, which the server would reject", () => {
  expect(forPlainDriver("postgresql://u@h:5432/budget_test?schema=ci&connection_limit=3&sslmode=require"))
    .toBe("postgresql://u@h:5432/budget_test?sslmode=require");
  expect(forPlainDriver("postgresql://u@h:5432/budget_test?pgbouncer=true"))
    .toBe("postgresql://u@h:5432/budget_test");
});
