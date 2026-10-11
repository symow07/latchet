import { z } from "zod";
import { isPostgresUrl } from "./lib/database-url";

/**
 * The local developer database, used when DATABASE_URL is unset outside
 * production. Create it once with `createdb budget_dev`, then apply the
 * migrations: `DATABASE_URL=postgresql://$USER@localhost:5432/budget_dev bunx prisma migrate deploy`.
 */
export const DEV_DATABASE_URL = "postgresql://localhost:5432/budget_dev";

const envSchema = z.object({
  PORT: z.string().optional().default("3000"),
  NODE_ENV: z.string().optional(),
  BACKEND_URL: z.url("BACKEND_URL must be a valid URL").default("http://localhost:3000"),
  // Postgres. Required in production (validated below); elsewhere it defaults
  // to the local developer database, DEV_DATABASE_URL.
  DATABASE_URL: z
    .string()
    .refine(isPostgresUrl, "DATABASE_URL must be a postgres:// or postgresql:// URL naming a database")
    .optional(),
  // lib/crypto.ts derives the AES-256-GCM key protecting every Plaid access
  // token from this value, so a short secret is a weak key for data at rest —
  // not just a weak session secret.
  BETTER_AUTH_SECRET: z
    .string()
    .min(
      32,
      "BETTER_AUTH_SECRET must be at least 32 characters. " +
        "Note: rotating it makes every stored Plaid access token " +
        "undecryptable (lib/crypto.ts derives the AES key from it), so " +
        "affected users must relink. Lengthen it before deploying if " +
        "the current value is shorter."
    ),
  // Outgoing email (lib/email.ts). Set RESEND_API_KEY (recommended) or point
  // SMTP_SERVICE_URL at your own relay. Sign-in does not depend on either — it is
  // email and password. In dev, with neither set, outgoing mail is logged.
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(), // e.g. "Budget <noreply@yourdomain.com>"
  SMTP_SERVICE_URL: z.url("SMTP_SERVICE_URL must be a valid URL").optional(),
  // Comma-separated production origins trusted for auth cookies / CORS.
  TRUSTED_ORIGINS: z.string().optional(),
  CORS_ORIGINS: z.string().optional(),
  // Server-side OpenAI key powering the AI advisor + receipt OCR proxy (routes/ai.ts).
  // Optional at boot so a missing key degrades only the AI features (503) instead of
  // crashing the whole backend, including auth.
  OPENAI_API_KEY: z.string().optional(),
  // Encrypts Plaid access tokens at rest (lib/crypto.ts). Deliberately separate
  // from BETTER_AUTH_SECRET: coupling them meant the auth secret could never be
  // rotated, because changing it silently made every stored token undecryptable
  // and forced every user to relink their bank.
  //
  // Optional. When unset, the key is derived from BETTER_AUTH_SECRET exactly as
  // before, so existing deployments keep working untouched.
  //
  // Rotating this requires re-encrypting stored tokens. Rotating
  // BETTER_AUTH_SECRET, once this is set, costs only a forced re-login.
  TOKEN_ENCRYPTION_KEY: z
    .string()
    .min(32, "TOKEN_ENCRYPTION_KEY must be at least 32 characters")
    .optional(),
  // RevenueCat. The webhook secret is the Authorization header value configured
  // in the RevenueCat dashboard; the API key (v1 secret key) is used to query a
  // subscriber directly, which closes the gap between a purchase completing on
  // device and the webhook arriving. Optional: without them the app runs with
  // everyone on the free tier rather than failing.
  REVENUECAT_WEBHOOK_SECRET: z.string().min(16).optional(),
  REVENUECAT_API_KEY: z.string().optional(),
  // Plaid bank-linking credentials (routes/plaid.ts). Optional so the backend
  // boots without them; the Plaid routes return 503 until they are set.
  PLAID_CLIENT_ID: z.string().optional(),
  PLAID_SECRET: z.string().optional(),
  PLAID_ENV: z.enum(["sandbox", "development", "production"]).optional().default("sandbox"),
  // Countries this Plaid account is actually enabled for, comma-separated ISO
  // codes (e.g. "US,CA,GB,FR"). The Link flow narrows this by the user's own
  // currency; requesting a country the account is not enabled for errors, so
  // this is the operator's declaration of what is available.
  PLAID_COUNTRY_CODES: z.string().optional().default("US"),
  // Exchange-rate provider for GET /api/v1/rates. Default is open.er-api.com,
  // which needs no key and covers 160+ currencies including MAD and CNY. Point
  // this at a paid provider (with the key in the URL) for better SLAs.
  EXCHANGE_RATES_URL: z
    .url("EXCHANGE_RATES_URL must be a valid URL")
    .optional()
    .default("https://open.er-api.com/v6/latest/USD"),
  // Forward-to-inbox subscription detection (routes/email.ts inbound webhook).
  // INBOUND_EMAIL_DOMAIN is the domain that receives forwarded mail (e.g.
  // "in.realbudget.app"); per-user addresses are u_<token>@<domain>.
  // INBOUND_EMAIL_SECRET authenticates the provider's webhook POSTs.
  // Both optional → the forwarding endpoints 503 until configured.
  INBOUND_EMAIL_DOMAIN: z.string().optional(),
  INBOUND_EMAIL_SECRET: z.string().optional(),
})
  .superRefine((e, ctx) => {
    // A production server silently opening a developer default would come up
    // healthy against an empty database. Refuse to boot instead.
    if (e.NODE_ENV === "production" && !e.DATABASE_URL) {
      ctx.addIssue({
        code: "custom",
        path: ["DATABASE_URL"],
        message: "DATABASE_URL is required in production",
      });
    }
  })
  .transform((e) => ({ ...e, DATABASE_URL: e.DATABASE_URL ?? DEV_DATABASE_URL }));

function validateEnv() {
  try {
    const parsed = envSchema.parse(process.env);
    console.log("✅ Environment variables validated successfully");
    return parsed;
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error("❌ Environment variable validation failed:");
      error.issues.forEach((err) => {
        console.error(`  - ${err.path.join(".")}: ${err.message}`);
      });
      process.exit(1);
    }
    throw error;
  }
}

export const env = validateEnv();
export type Env = z.infer<typeof envSchema>;

declare global {
  namespace NodeJS {
    interface ProcessEnv extends z.infer<typeof envSchema> {}
  }
}
