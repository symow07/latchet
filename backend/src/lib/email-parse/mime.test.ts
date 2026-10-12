import { describe, expect, test } from "bun:test";
import { parseMime } from "./mime";
import { htmlToText } from "./html-text";
import { binary, encode, mail, MOJIBAKE, multipart, qp, text, word } from "./test-utils";

const BASE = { To: "someone@example.com", Date: "Mon, 12 Oct 2026 09:15:00 +0200", "Message-ID": "<t1@example.com>" };

function clean(s: string) {
  expect(s).not.toMatch(MOJIBAKE);
}

describe("parseMime", () => {
  test("mime decoding: UTF-8 quoted-printable body, RFC 2047 subject and display name", async () => {
    const raw = mail(
      { ...BASE, From: `${word("Café Netflix", "UTF-8", "Q")} <info@account.netflix.com>`, Subject: `${word("Votre reçu – 12,99 €", "UTF-8", "B")}` },
      text("plain", "Votre abonnement a été renouvelé.\nMontant : 12,99 €\n", "UTF-8", "quoted-printable"),
    );
    const msg = await parseMime(raw);
    expect(msg.subject).toBe("Votre reçu – 12,99 €");
    expect(msg.fromName).toBe("Café Netflix");
    expect(msg.fromAddress).toBe("info@account.netflix.com");
    expect(msg.senderDomain).toBe("netflix.com");
    expect(msg.messageId).toBe("<t1@example.com>");
    expect(msg.dateISO).toBe("2026-10-12");
    expect(msg.text).toContain("a été renouvelé");
    expect(msg.text).toContain("12,99 €");
    clean(msg.subject + msg.text);
  });

  test("mime decoding: ISO-8859-1 body with a Q-encoded subject", async () => {
    const raw = mail(
      { ...BASE, From: "PayPal <service@paypal.co.uk>", Subject: word("Reçu de paiement", "ISO-8859-1", "Q") },
      text("plain", "Vous avez envoyé un paiement de £11.99 GBP à Spotify AB.\nS.à r.l.", "ISO-8859-1", "quoted-printable"),
    );
    const msg = await parseMime(raw);
    expect(msg.subject).toBe("Reçu de paiement");
    expect(msg.text).toContain("envoyé un paiement de £11.99 GBP");
    expect(msg.text).toContain("S.à r.l.");
    clean(msg.subject + msg.text);
  });

  test("mime decoding: windows-1252 euro sign (0x80) and typographic quotes", async () => {
    const bytes = encode("Montant : 19,99 € – « merci » “Free”", "windows-1252");
    expect(bytes.includes(0x80)).toBe(true);
    const raw = mail({ ...BASE, From: "Free Mobile <freemobile@free-mobile.fr>", Subject: word("Votre facture – octobre", "windows-1252", "Q") }, text("plain", "Montant : 19,99 € – « merci » “Free”", "windows-1252", "quoted-printable"));
    const msg = await parseMime(raw);
    expect(msg.text).toBe("Montant : 19,99 € – « merci » “Free”");
    expect(msg.subject).toBe("Votre facture – octobre");
  });

  test("mime decoding: ISO-8859-15 (Latin-9) euro sign as 0xA4, which Bun's TextDecoder cannot read", async () => {
    const bytes = encode("29,99 € œuvre", "ISO-8859-15");
    expect(bytes.includes(0xa4)).toBe(true);
    const raw = mail({ ...BASE, From: "Basic-Fit <noreply@basic-fit.com>", Subject: word("Prélèvement mensuel", "ISO-8859-15", "Q") }, text("plain", "Nous avons prélevé 29,99 € : Œuvre", "ISO-8859-15", "quoted-printable"));
    const msg = await parseMime(raw);
    expect(msg.text).toBe("Nous avons prélevé 29,99 € : Œuvre");
    expect(msg.subject).toBe("Prélèvement mensuel");
    clean(msg.text);
  });

  test("mime decoding: windows-1256 Arabic body, subject and sender name", async () => {
    const raw = mail(
      { ...BASE, From: `${word("اتصالات المغرب", "windows-1256")} <factures@iam.ma>`, Subject: word("تجديد اشتراكك", "windows-1256") },
      text("plain", "تم تجديد اشتراكك بنجاح. المبلغ: 99,00 درهم", "windows-1256", "quoted-printable"),
    );
    const msg = await parseMime(raw);
    expect(msg.fromName).toBe("اتصالات المغرب");
    expect(msg.subject).toBe("تجديد اشتراكك");
    expect(msg.text).toBe("تم تجديد اشتراكك بنجاح. المبلغ: 99,00 درهم");
    expect(msg.senderDomain).toBe("iam.ma");
    clean(msg.subject + msg.text);
  });

  test("mime decoding: ISO-8859-6 Arabic in base64", async () => {
    const raw = mail({ ...BASE, From: "Shahid <noreply@shahid.net>", Subject: word("تم إلغاء اشتراكك", "ISO-8859-6") }, text("plain", "تم إلغاء اشتراكك في شاهد VIP بنجاح.", "ISO-8859-6", "base64"));
    const msg = await parseMime(raw);
    expect(msg.subject).toBe("تم إلغاء اشتراكك");
    expect(msg.text).toBe("تم إلغاء اشتراكك في شاهد VIP بنجاح.");
  });

  test("mime decoding: GB2312, GBK and GB18030 Chinese", async () => {
    for (const cs of ["GB2312", "GBK", "GB18030"]) {
      const raw = mail({ ...BASE, From: `${word("爱奇艺", cs)} <vip@iqiyi.com>`, Subject: word("爱奇艺VIP会员自动续费成功", cs) }, text("plain", "扣款金额：25.00元\n下次扣款日期：2026年11月12日", cs, "base64"));
      const msg = await parseMime(raw);
      expect(msg.subject).toBe("爱奇艺VIP会员自动续费成功");
      expect(msg.fromName).toBe("爱奇艺");
      expect(msg.text).toContain("扣款金额：25.00元");
      clean(msg.subject + msg.text);
    }
  });

  test("mime decoding: Big5 traditional Chinese", async () => {
    const raw = mail({ ...BASE, From: "PChome <service@pchome.com.tw>", Subject: word("您的訂單已出貨", "Big5") }, text("plain", "訂單金額：NT$1,280，感謝您的訂購。", "Big5", "base64"));
    const msg = await parseMime(raw);
    expect(msg.subject).toBe("您的訂單已出貨");
    expect(msg.text).toBe("訂單金額：NT$1,280，感謝您的訂購。");
  });

  test("mime decoding: format=flowed with delsp joins soft-wrapped lines", async () => {
    const raw = mail(
      { ...BASE, From: "Spotify <no-reply@spotify.com>", Subject: "Receipt" },
      { headers: ['Content-Type: text/plain; charset="utf-8"; format=flowed; delsp=yes', "Content-Transfer-Encoding: 8bit"], body: "Your Premium plan renewed today for $11.99. Your next  \r\npayment is on November 12, 2026.\r\n\r\nThanks!" },
    );
    const msg = await parseMime(raw);
    expect(msg.text).toContain("Your next payment is on November 12, 2026.");
  });

  test("mime decoding: single-part HTML becomes text — hidden preheaders, styles, scripts and comments dropped; entities decoded; rows kept on one line", async () => {
    const html = `<!DOCTYPE html><html><head><title>Ignore me</title><style>.x{color:red}</style><script>var total = "$999";</script></head><body>
<div style="display:none;max-height:0;overflow:hidden">Preheader $0.00 today</div>
<span class="preheader" style="color:transparent; visibility:hidden; mso-hide:all">Hidden &euro;1</span>
<!--[if mso]><p>Outlook only $5.00</p><![endif]-->
<p>Bonjour&nbsp;Camille,</p>
<table><tr><td><p>Sous-total</p></td><td><p>21,66&nbsp;&euro;</p></td></tr><tr><td><b>Total</b></td><td><b>25,99&#160;&#8364;</b></td></tr><tr><td>Remise</td><td>&#128;0,00</td></tr></table>
<div>Merci &amp; à bientôt</div></body></html>`;
    const raw = mail({ ...BASE, From: "CANAL+ <noreply@canalplus.com>", Subject: "Facture" }, text("html", html, "UTF-8", "quoted-printable"));
    const msg = await parseMime(raw);
    const lines = msg.text.split("\n");
    expect(lines).toContain("Total 25,99 €");
    expect(lines).toContain("Sous-total 21,66 €");
    expect(msg.text).toContain("Bonjour Camille,");
    expect(msg.text).toContain("Remise €0,00");
    expect(msg.text).toContain("Merci & à bientôt");
    expect(msg.text).not.toContain("Preheader");
    expect(msg.text).not.toContain("Hidden");
    expect(msg.text).not.toContain("Outlook only");
    expect(msg.text).not.toContain("Ignore me");
    expect(msg.text).not.toContain("999");
    expect(msg.text).not.toContain("color:red");
  });

  test("mime decoding: nested multipart/mixed → related → alternative uses the plain part when it carries the content", async () => {
    const root = multipart("mixed", [
      multipart("related", [
        multipart("alternative", [
          text("plain", "Your receipt\nTotal: $20.00\nPaid October 3, 2026", "UTF-8", "quoted-printable"),
          text("html", "<p>Your receipt</p><table><tr><td>Total:</td><td>$20.00</td></tr></table><p>Paid October 3, 2026</p>", "UTF-8", "base64"),
        ]),
        binary("image/png", new Uint8Array([0x89, 0x50, 0x4e, 0x47]), ["Content-ID: <logo>"]),
      ]),
      binary('application/octet-stream; name="notes.bin"', new Uint8Array([1, 2, 3]), ['Content-Disposition: attachment; filename="notes.bin"']),
    ]);
    const msg = await parseMime(mail({ ...BASE, From: "OpenAI <invoice+statements@stripe.com>", Subject: "Your receipt from OpenAI" }, root));
    expect(msg.text).toBe("Your receipt\nTotal: $20.00\nPaid October 3, 2026");
    expect(msg.senderDomain).toBe("stripe.com");
    expect(msg.attachmentsText).toEqual([]);
  });

  test("mime decoding: a stub text/plain part loses to the HTML that carries the amounts", async () => {
    const root = multipart("alternative", [
      text("plain", "View this email in your browser.", "UTF-8", "quoted-printable"),
      text("html", "<p>Thanks for your order</p><table><tr><td>Total</td><td>£12.99</td></tr></table>", "UTF-8", "quoted-printable"),
    ]);
    const msg = await parseMime(mail({ ...BASE, From: "Shop <orders@shop.example.co.uk>", Subject: "Receipt" }, root));
    expect(msg.text).toContain("Total £12.99");
    expect(msg.senderDomain).toBe("example.co.uk");
  });

  test("mime decoding: a manual forward from a personal mailbox is read as the original email", async () => {
    const body = `FYI\n\n---------- Forwarded message ---------\nFrom: Netflix <info@account.netflix.com>\nDate: Mon, Oct 5, 2026 at 9:15 AM\nSubject: Your Netflix membership has been renewed\nTo: <jane@gmail.com>\n\nYour membership was renewed. Amount: €13.49\n`;
    const msg = await parseMime(mail({ ...BASE, From: "Jane Doe <jane@gmail.com>", Subject: "Fwd: Your Netflix membership has been renewed" }, text("plain", body)));
    expect(msg.fromAddress).toBe("info@account.netflix.com");
    expect(msg.fromName).toBe("Netflix");
    expect(msg.senderDomain).toBe("netflix.com");
    expect(msg.subject).toBe("Your Netflix membership has been renewed");
    expect(msg.dateISO).toBe("2026-10-05");
    expect(msg.text).toContain("Amount: €13.49");
    expect(msg.text).not.toContain("FYI");
  });

  test("mime decoding: a forward sent as a message/rfc822 attachment is read as the original", async () => {
    const inner = Buffer.from(mail({ From: "Deezer <noreply@deezer.com>", Subject: word("Résiliation confirmée", "UTF-8", "Q"), Date: "Sat, 03 Oct 2026 18:22:10 +0200" }, text("plain", "Nous confirmons la résiliation de ton abonnement."))).toString("latin1");
    const root = multipart("mixed", [text("plain", "see attached"), { headers: ["Content-Type: message/rfc822", 'Content-Disposition: attachment; filename="fwd.eml"'], body: inner }]);
    const msg = await parseMime(mail({ ...BASE, From: "Camille <camille@laposte.net>", Subject: "Fwd: Résiliation" }, root));
    expect(msg.senderDomain).toBe("deezer.com");
    expect(msg.subject).toBe("Résiliation confirmée");
    expect(msg.text).toContain("résiliation de ton abonnement");
    expect(msg.dateISO).toBe("2026-10-03");
  });

  test("mime decoding: a raw 8-bit GB2312 subject (no encoded words) is re-read in the declared charset", async () => {
    const subject = encode("腾讯视频VIP续费提醒", "GB2312").toString("latin1");
    const body = encode("续费金额为25元", "GB2312").toString("latin1");
    const raw = new Uint8Array(
      Buffer.from(`From: vip@qq.com\r\nSubject: ${subject}\r\nDate: Mon, 12 Oct 2026 10:00:00 +0800\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=GB2312\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${body}\r\n`, "latin1"),
    );
    const msg = await parseMime(raw);
    expect(msg.subject).toBe("腾讯视频VIP续费提醒");
    expect(msg.text).toBe("续费金额为25元");
  });

  test("mime decoding: string input, a missing Date and garbage never throw", async () => {
    const msg = await parseMime("From: a@b.example\r\nSubject: hi\r\n\r\nhello");
    expect(msg.subject).toBe("hi");
    expect(msg.text).toBe("hello");
    expect(msg.dateISO).toBeNull();
    const junk = await parseMime(new Uint8Array([0, 1, 2, 255, 254, 10, 13]));
    expect(typeof junk.text).toBe("string");
    const empty = await parseMime("");
    expect(empty.subject).toBe("");
  });

  test("mime decoding: the date is the sender's own calendar day", async () => {
    const msg = await parseMime(mail({ ...BASE, Date: "Mon, 12 Oct 2026 23:30:00 -0700", From: "a@b.example", Subject: "x" }, text("plain", "x")));
    expect(msg.dateISO).toBe("2026-10-12");
  });
});

describe("htmlToText", () => {
  test("mime decoding: html layout tables keep blocks apart and rows together", () => {
    const out = htmlToText(`<table><tr><td><table><tr><td>Subtotal</td><td>$10.00</td></tr><tr><td>Total</td><td>$10.80</td></tr></table></td><td><p>Questions?</p><p>Contact us</p></td></tr></table><ul><li>One<li>Two</ul><p>a<br>b</p>`);
    expect(out.split("\n")).toEqual(["Subtotal $10.00", "Total $10.80", "Questions?", "Contact us", "One", "Two", "a", "b"]);
  });

  test("mime decoding: html entities, numeric references and inline-block columns", () => {
    expect(htmlToText("<p>&euro;12&comma;99 &#x20AC; &#8364; &#128; &nbsp;&lt;b&gt; &unknown; &amp</p>")).toBe("€12,99 € € €  <b> &unknown; &");
    expect(htmlToText(`<div style="display:inline-block">Total</div><div style="display: inline-block">£4.99</div>`)).toBe("Total £4.99");
    expect(htmlToText(`<p hidden>secret</p><p style="opacity:0">gone</p><p style="font-size:0"><span style="font-size:14px">kept</span></p>`)).toBe("kept");
  });
});
