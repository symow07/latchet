/**
 * Cloudflare Email Worker → Real Budget inbound webhook.
 *
 * Receives every email sent to *@<INBOUND_EMAIL_DOMAIN> (via Cloudflare Email
 * Routing catch-all) and POSTs it as JSON to the backend's
 * POST /api/email/inbound, authenticated with the shared X-Inbound-Secret.
 *
 * Setup: see inbound-email-setup.md in this folder.
 * Configure two Worker environment variables (Settings → Variables):
 *   BACKEND_URL     e.g. https://your-app.up.railway.app
 *   INBOUND_SECRET  the same value as the backend's INBOUND_EMAIL_SECRET
 */

export default {
  async email(message, env) {
    // Read the raw message body (bounded — parsing only needs headers + text).
    const raw = await new Response(message.raw).text();
    const text = extractTextBody(raw).slice(0, 20000);

    const payload = {
      to: message.to,
      from: message.headers.get("from") ?? message.from,
      subject: message.headers.get("subject") ?? "",
      text,
    };

    const res = await fetch(`${env.BACKEND_URL}/api/email/inbound`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Inbound-Secret": env.INBOUND_SECRET,
      },
      body: JSON.stringify(payload),
    });

    // Non-2xx → let Cloudflare retry by rejecting; 2xx (including routed-but-
    // ignored acks) ends processing.
    if (!res.ok && res.status !== 401 && res.status !== 503) {
      message.setReject("temporary failure, retry");
    }
  },
};

/** Best-effort text extraction from a raw RFC 822 message: prefers the
 *  text/plain MIME part, falls back to a crude HTML strip. */
function extractTextBody(raw) {
  const headerEnd = raw.indexOf("\r\n\r\n");
  const body = headerEnd === -1 ? raw : raw.slice(headerEnd + 4);

  const boundaryMatch = raw.match(/boundary="?([^";\r\n]+)"?/i);
  if (boundaryMatch) {
    const parts = body.split(`--${boundaryMatch[1]}`);
    const plain = parts.find((p) => /content-type:\s*text\/plain/i.test(p));
    if (plain) return decodePart(plain);
    const html = parts.find((p) => /content-type:\s*text\/html/i.test(p));
    if (html) return stripHtml(decodePart(html));
  }
  return stripHtml(body);
}

function decodePart(part) {
  const bodyStart = part.indexOf("\r\n\r\n");
  let content = bodyStart === -1 ? part : part.slice(bodyStart + 4);
  if (/content-transfer-encoding:\s*base64/i.test(part)) {
    try {
      content = atob(content.replace(/\s+/g, ""));
    } catch {
      /* keep as-is */
    }
  } else if (/content-transfer-encoding:\s*quoted-printable/i.test(part)) {
    content = content
      .replace(/=\r?\n/g, "")
      .replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
  }
  return content;
}

function stripHtml(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}
