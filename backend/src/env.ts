import { z } from "zod";

const envSchema = z.object({
  PORT: z.string().optional().default("3000"),
  NODE_ENV: z.string().optional(),
  BACKEND_URL: z.url("BACKEND_URL must be a valid URL").default("http://localhost:3000"),
  DATABASE_URL: z.string().default("file:./prisma/dev.db"),
  BETTER_AUTH_SECRET: z.string().min(1, "BETTER_AUTH_SECRET is required"),
  SMTP_SERVICE_URL: z.url("SMTP_SERVICE_URL must be a valid URL").default("https://smtp.vibecodeapp.com/v1/send/otp"),
  // Server-side OpenAI key powering the AI advisor + receipt OCR proxy (routes/ai.ts).
  // Optional at boot so a missing key degrades only the AI features (503) instead of
  // crashing the whole backend, including auth.
  OPENAI_API_KEY: z.string().optional(),
  // Plaid bank-linking credentials (routes/plaid.ts). Optional so the backend
  // boots without them; the Plaid routes return 503 until they are set.
  PLAID_CLIENT_ID: z.string().optional(),
  PLAID_SECRET: z.string().optional(),
  PLAID_ENV: z.enum(["sandbox", "development", "production"]).optional().default("sandbox"),
  // Google OAuth credentials for the Gmail-based subscription scanner
  // (routes/email.ts). Optional so the backend boots without them; the email
  // routes return 503 until they are set.
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().optional(),
  // Forward-to-inbox subscription detection (routes/email.ts inbound webhook).
  // INBOUND_EMAIL_DOMAIN is the domain that receives forwarded mail (e.g.
  // "in.realbudget.app"); per-user addresses are u_<token>@<domain>.
  // INBOUND_EMAIL_SECRET authenticates the provider's webhook POSTs.
  // Both optional → the forwarding endpoints 503 until configured.
  INBOUND_EMAIL_DOMAIN: z.string().optional(),
  INBOUND_EMAIL_SECRET: z.string().optional(),
});

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
