/**
 * The two emails Better Auth sends for us — a password-reset link and an
 * email-verification link — in the account's language.
 *
 * Dependency-free, so the copy, the escaping, the language choice and the
 * link rewriting are unit-tested without a database or a mail provider
 * (auth-emails.test.ts). auth.ts decides when to send and through what.
 *
 * Both links point at this backend, which checks the token and then redirects
 * to the app's own scheme (latchet://…), so they only do anything on the
 * phone where Latchet is installed. The copy says so: opened on a laptop, the
 * redirect has nowhere to go.
 */

export const AUTH_EMAIL_LOCALES = ["en", "fr", "ar", "zh"] as const;
export type AuthEmailLocale = (typeof AUTH_EMAIL_LOCALES)[number];

/**
 * How long each link lives. auth.ts hands these to Better Auth, and the copy
 * below states them in words ("an hour", "24 hours") — change one, change the
 * other.
 */
export const RESET_LINK_TTL_SECONDS = 60 * 60;
export const VERIFY_LINK_TTL_SECONDS = 24 * 60 * 60;

/** Where the server's redirects land in the app (mobile/src/app/reset-password.tsx, verify-email.tsx). */
export const APP_RESET_PASSWORD_URL = "latchet://reset-password";
export const APP_VERIFY_EMAIL_URL = "latchet://verify-email";

export interface AuthEmail {
  subject: string;
  html: string;
  /** Plain-text alternative; carries the same link, on a line of its own. */
  text: string;
}

export interface AuthEmailInput {
  /** The account's display name. Untrusted: whatever was typed at sign-up. */
  name: string | null | undefined;
  url: string;
  locale: AuthEmailLocale;
}

function isAuthEmailLocale(tag: string): tag is AuthEmailLocale {
  return (AUTH_EMAIL_LOCALES as readonly string[]).includes(tag);
}

/** "fr-CA" → "fr", "zh_Hans" → "zh"; null when it is not a language we write. */
function narrow(tag: string | null | undefined): AuthEmailLocale | null {
  const base = (tag ?? "").trim().toLowerCase().split(/[-_;]/)[0] ?? "";
  return isAuthEmailLocale(base) ? base : null;
}

/**
 * The language to write in.
 *
 * The account's saved language (UserSettings.locale) wins. An account that has
 * none yet — the verification mail goes out at sign-up, before the phone has
 * synced its settings — falls back to the app's language, which the app sends
 * as Accept-Language on every auth request. English otherwise.
 */
export function authEmailLocale(
  saved: string | null | undefined,
  acceptLanguage?: string | null
): AuthEmailLocale {
  if (saved != null && saved !== "") return narrow(saved) ?? "en";
  for (const part of (acceptLanguage ?? "").split(",")) {
    const found = narrow(part);
    if (found) return found;
  }
  return "en";
}

/** Escape text for HTML element content and double-quoted attributes. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Point the link's callbackURL at the app when the request named none.
 *
 * Better Auth builds the verification link with callbackURL "/" when sign-up
 * names none, which would redirect to this backend's own root after verifying —
 * a blank page, in a browser. A reset request without redirectTo gets an empty
 * one, which Better Auth turns into its /error page. Either way the person is
 * left in a browser with nothing to do. A callback the client did name
 * (already checked against trustedOrigins by Better Auth) is kept.
 */
export function withAppCallback(url: string, appTarget: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const current = parsed.searchParams.get("callbackURL");
  if (current && !current.startsWith("/")) return url;
  parsed.searchParams.set("callbackURL", appTarget);
  return parsed.toString();
}

/**
 * Point the link's callbackURL at the app, whatever the request named.
 *
 * For the reset link. Its redirect carries the token, and redirectTo is chosen
 * by whoever asks for the reset — which need not be the account's owner. Any
 * trusted origin passes Better Auth's check, and the trusted list includes
 * exp://*\/* (Expo Go, which connects to whatever host the URL names): a
 * stranger could ask for a reset of someone else's account with redirectTo
 * exp://their-own-host/…, and the genuine email would then hand the owner's
 * token to that host. The app only ever asks for APP_RESET_PASSWORD_URL, so
 * nothing legitimate is lost by pinning it.
 */
export function pinAppCallback(url: string, appTarget: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  parsed.searchParams.set("callbackURL", appTarget);
  return parsed.toString();
}

interface Copy {
  subject: string;
  intro: string;
  button: string;
  note: string;
  ignore: string;
}

interface LocaleCopy {
  greeting: (name: string) => string;
  greetingAnon: string;
  signoff: string;
  reset: Copy;
  verify: Copy;
}

const COPY: Record<AuthEmailLocale, LocaleCopy> = {
  en: {
    greeting: (name) => `Hi ${name},`,
    greetingAnon: "Hi,",
    signoff: "— Latchet",
    reset: {
      subject: "Reset your Latchet password",
      intro:
        "Someone asked to reset the password for the Latchet account at this address. If it was you, open this link on the phone where Latchet is installed and choose a new password:",
      button: "Choose a new password",
      note: "The link works once and expires in an hour. Using it signs you out of Latchet on your other devices.",
      ignore: "If you didn't ask for this, ignore this email. Your password won't change.",
    },
    verify: {
      subject: "Confirm your email for Latchet",
      intro:
        "Confirm that this is your email address by opening this link on the phone where Latchet is installed:",
      button: "Confirm email",
      note: "The link expires in 24 hours. You can send a new one from Settings in the app.",
      ignore: "If you didn't create a Latchet account, ignore this email.",
    },
  },
  fr: {
    greeting: (name) => `Bonjour ${name},`,
    greetingAnon: "Bonjour,",
    signoff: "— Latchet",
    reset: {
      subject: "Réinitialisez votre mot de passe Latchet",
      intro:
        "Quelqu'un a demandé à réinitialiser le mot de passe du compte Latchet associé à cette adresse. Si c'est vous, ouvrez ce lien sur le téléphone où Latchet est installé et choisissez un nouveau mot de passe :",
      button: "Choisir un nouveau mot de passe",
      note: "Le lien ne fonctionne qu'une fois et expire dans une heure. L'utiliser vous déconnecte de Latchet sur vos autres appareils.",
      ignore: "Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail. Votre mot de passe ne changera pas.",
    },
    verify: {
      subject: "Confirmez votre adresse e-mail pour Latchet",
      intro:
        "Confirmez qu'il s'agit bien de votre adresse e-mail en ouvrant ce lien sur le téléphone où Latchet est installé :",
      button: "Confirmer mon adresse",
      note: "Le lien expire dans 24 heures. Vous pouvez en demander un nouveau depuis les Réglages de l'app.",
      ignore: "Si vous n'avez pas créé de compte Latchet, ignorez cet e-mail.",
    },
  },
  ar: {
    greeting: (name) => `مرحبًا ${name}،`,
    greetingAnon: "مرحبًا،",
    signoff: "— Latchet",
    reset: {
      subject: "إعادة تعيين كلمة مرور Latchet",
      intro:
        "طلب أحدهم إعادة تعيين كلمة المرور لحساب Latchet المرتبط بهذا العنوان. إن كنت أنت، فافتح هذا الرابط على الهاتف المثبّت عليه Latchet واختر كلمة مرور جديدة:",
      button: "اختيار كلمة مرور جديدة",
      note: "يعمل الرابط مرة واحدة وتنتهي صلاحيته بعد ساعة. استخدامه يسجّل خروجك من Latchet على أجهزتك الأخرى.",
      ignore: "إن لم تطلب ذلك، فتجاهل هذه الرسالة. لن تتغيّر كلمة مرورك.",
    },
    verify: {
      subject: "أكّد بريدك الإلكتروني في Latchet",
      intro: "أكّد أن هذا عنوان بريدك الإلكتروني بفتح هذا الرابط على الهاتف المثبّت عليه Latchet:",
      button: "تأكيد البريد الإلكتروني",
      note: "تنتهي صلاحية الرابط بعد 24 ساعة. يمكنك طلب رابط جديد من الإعدادات في التطبيق.",
      ignore: "إن لم تنشئ حسابًا في Latchet، فتجاهل هذه الرسالة.",
    },
  },
  zh: {
    greeting: (name) => `${name}，你好：`,
    greetingAnon: "你好：",
    signoff: "— Latchet",
    reset: {
      subject: "重置你的 Latchet 密码",
      intro: "有人请求重置与此邮箱关联的 Latchet 账户密码。如果是你本人，请在安装了 Latchet 的手机上打开此链接，设置新密码：",
      button: "设置新密码",
      note: "该链接只能使用一次，一小时后失效。使用后，你在其他设备上的 Latchet 将退出登录。",
      ignore: "如果不是你本人操作，请忽略此邮件，你的密码不会改变。",
    },
    verify: {
      subject: "确认你在 Latchet 的邮箱",
      intro: "请在安装了 Latchet 的手机上打开此链接，确认这是你的邮箱地址：",
      button: "确认邮箱",
      note: "该链接 24 小时后失效。你可以在应用的设置中重新发送。",
      ignore: "如果你没有创建 Latchet 账户，请忽略此邮件。",
    },
  },
};

/** The identity's light palette (mobile/src/lib/identity/tokens.ts). */
const COLOR = {
  ground: "#F6F3EF",
  surface: "#FBF9F6",
  ink: "#24201C",
  inkDim: "#645D56",
  hairline: "#E4DED7",
  espresso: "#3B2A21",
  onEspresso: "#F6F3EF",
};

function build(kind: "reset" | "verify", input: AuthEmailInput): AuthEmail {
  const locale = isAuthEmailLocale(input.locale) ? input.locale : "en";
  const copy = COPY[locale];
  const c = copy[kind];
  // A name is one line of display text. Collapse whitespace so a name with a
  // newline in it cannot lay out lines of its own in the plain-text body.
  const name = (input.name ?? "").replace(/\s+/g, " ").trim();
  const greeting = name ? copy.greeting(name) : copy.greetingAnon;
  const dir = locale === "ar" ? "rtl" : "ltr";
  const url = input.url;

  // The link sits on a line of its own: mail clients only auto-link a URL
  // they can find the end of, and anything reading the body for it does too.
  const text = [greeting, "", c.intro, "", url, "", c.note, "", c.ignore, "", copy.signoff].join("\n");

  const p = (body: string, style = "") =>
    `<p style="margin:0 0 16px;font-size:16px;line-height:24px;${style}">${body}</p>`;
  const html = [
    "<!doctype html>",
    `<html lang="${locale}" dir="${dir}">`,
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(c.subject)}</title>`,
    "</head>",
    `<body style="margin:0;padding:24px 16px;background:${COLOR.ground};color:${COLOR.ink};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">`,
    `<div dir="${dir}" style="max-width:480px;margin:0 auto;padding:24px;background:${COLOR.surface};border:1px solid ${COLOR.hairline};border-radius:16px;">`,
    p(escapeHtml(greeting)),
    p(escapeHtml(c.intro)),
    `<p style="margin:0 0 16px;"><a href="${escapeHtml(url)}" style="display:inline-block;padding:14px 22px;border-radius:14px;background:${COLOR.espresso};color:${COLOR.onEspresso};font-size:16px;font-weight:600;text-decoration:none;">${escapeHtml(c.button)}</a></p>`,
    // The bare link as well, for clients that strip buttons.
    p(
      `<a href="${escapeHtml(url)}" style="color:${COLOR.inkDim};word-break:break-all;">${escapeHtml(url)}</a>`,
      `font-size:13px;line-height:18px;color:${COLOR.inkDim};`
    ),
    p(escapeHtml(c.note), `color:${COLOR.inkDim};`),
    p(escapeHtml(c.ignore), `color:${COLOR.inkDim};`),
    p(escapeHtml(copy.signoff), "margin:0;"),
    "</div>",
    "</body>",
    "</html>",
  ].join("\n");

  return { subject: c.subject, html, text };
}

export function passwordResetEmail(input: AuthEmailInput): AuthEmail {
  return build("reset", input);
}

export function verificationEmail(input: AuthEmailInput): AuthEmail {
  return build("verify", input);
}
