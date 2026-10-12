import { describe, expect, test } from "bun:test";
import { extractFinding } from "./extract";
import { BILLING_TERMS, looksLikeBilling } from "./terms";
import type { ParsedMessage } from "./types";

const NOW = new Date("2026-10-12T12:00:00Z");

function msg(from: [string, string], subject: string, text: string, dateISO = "2026-10-12"): ParsedMessage {
  const [name, address] = from;
  return { messageId: null, fromAddress: address, fromName: name, senderDomain: address.split("@")[1]!.split(".").slice(-2).join("."), subject, dateISO, text, attachmentsText: [] };
}

const kindOf = async (m: ParsedMessage) => (await extractFinding(m, { now: NOW }))?.kind ?? null;

describe("kinds", () => {
  test("email kind: renewals in English, French, Arabic and Chinese, completed or upcoming", async () => {
    const en = await extractFinding(msg(["Netflix", "info@account.netflix.com"], "Your membership has been renewed", "We've charged $15.49 for your Standard plan. Next billing date: November 12, 2026."), { now: NOW });
    expect(en).toMatchObject({ kind: "renewal", chargedISO: "2026-10-12", nextChargeISO: "2026-11-12", amount: 15.49, currency: "USD" });
    const fr = await extractFinding(msg(["Spotify", "no-reply@spotify.com"], "Votre abonnement sera renouvelé le 15 octobre", "Votre abonnement Premium sera renouvelé automatiquement le 15 octobre 2026 pour 11,12 € par mois."), { now: NOW });
    expect(fr).toMatchObject({ kind: "renewal", nextChargeISO: "2026-10-15", chargedISO: null, amount: 11.12, currency: "EUR", cadence: "monthly" });
    expect(await kindOf(msg(["اتصالات المغرب", "noreply@iam.ma"], "تجديد اشتراكك", "تم تجديد اشتراكك الشهري بنجاح. المبلغ: 99,00 درهم"))).toBe("renewal");
    const zh = await extractFinding(msg(["QQ音乐", "vip@qq.com"], "绿钻自动续费成功", "您的绿钻豪华版已自动续费成功，扣款金额：15元，下次扣款日期：2026年11月12日。"), { now: NOW });
    expect(zh).toMatchObject({ kind: "renewal", amount: 15, currency: "CNY", nextChargeISO: "2026-11-12" });
  });

  test("email kind: receipts and invoices", async () => {
    expect(await kindOf(msg(["Uber", "noreply@uber.com"], "Your Thursday morning trip with Uber", "Thanks for riding. Total $14.20. Payment: Visa ••••4242. Receipt"))).toBe("receipt");
    expect(await kindOf(msg(["Orange", "facture@orange.fr"], "Votre facture Orange est disponible", "Montant de votre facture : 42,99 € TTC"))).toBe("receipt");
    expect(await kindOf(msg(["inwi", "facture@inwi.ma"], "فاتورتكم متوفرة", "المبلغ الإجمالي: 149,00 درهم"))).toBe("receipt");
    expect(await kindOf(msg(["微信支付", "wxpay@tenpay.com"], "微信支付凭证", "你已成功付款 ¥32.00 给 瑞幸咖啡"))).toBe("receipt");
  });

  test("email kind: trial endings in four languages carry the end date", async () => {
    const en = await extractFinding(msg(["Disney+", "disneyplus@mail.disneyplus.com"], "Your free trial ends soon", "Your free trial ends on 15 October 2026. After that you'll be charged £4.99/month."), { now: NOW });
    expect(en).toMatchObject({ kind: "trial_ending", trialEndsISO: "2026-10-15", amount: 4.99, currency: "GBP", cadence: "monthly" });
    const fr = await extractFinding(msg(["Deezer", "noreply@deezer.com"], "Ton essai gratuit se termine bientôt", "Ton essai gratuit se termine le 20 octobre 2026. Ensuite, 11,99 €/mois."), { now: NOW });
    expect(fr).toMatchObject({ kind: "trial_ending", trialEndsISO: "2026-10-20", amount: 11.99 });
    const ar = await extractFinding(msg(["OSN+", "noreply@osnplus.com"], "تنتهي فترتك التجريبية", "ستنتهي الفترة التجريبية المجانية في 19 أكتوبر 2026، وبعدها سيتم خصم 35 درهم شهرياً."), { now: NOW });
    expect(ar).toMatchObject({ kind: "trial_ending", trialEndsISO: "2026-10-19", amount: 35, currency: "MAD" });
    const zh = await extractFinding(msg(["优酷", "vip@youku.com"], "会员试用即将到期", "您的会员免费试用将于2026年10月16日到期，到期后按20元/月自动续费。"), { now: NOW });
    expect(zh).toMatchObject({ kind: "trial_ending", trialEndsISO: "2026-10-16", amount: 20, currency: "CNY", cadence: "monthly" });
  });

  test("email kind: price changes keep the new price and the old one", async () => {
    const en = await extractFinding(msg(["Netflix", "info@account.netflix.com"], "An update on your Netflix membership", "Starting with your billing date on or after 1 November 2026, your Standard plan price will change from €13.49 to €14.99 per month."), { now: NOW });
    expect(en).toMatchObject({ kind: "price_change", amount: 14.99, previousAmount: 13.49, currency: "EUR", cadence: "monthly" });
    const fr = await extractFinding(msg(["Free", "abonne@free.fr"], "Évolution tarifaire de votre forfait", "À partir du 1er décembre 2026, votre forfait Freebox passera de 39,99 € à 42,99 € par mois."), { now: NOW });
    expect(fr).toMatchObject({ kind: "price_change", amount: 42.99, previousAmount: 39.99, nextChargeISO: "2026-12-01" });
    const ar = await extractFinding(msg(["شاهد", "noreply@shahid.net"], "تغيير في سعر اشتراكك", "اعتبارا من 1 ديسمبر 2026 سيتغير سعر اشتراكك الشهري من 39 درهم إلى 45 درهم."), { now: NOW });
    expect(ar).toMatchObject({ kind: "price_change", amount: 45, previousAmount: 39, currency: "MAD" });
    const zh = await extractFinding(msg(["网易云音乐", "noreply@music.163.com"], "会员价格调整通知", "自2026年11月20日起，连续包月价格由15元/月调整为18元/月。"), { now: NOW });
    expect(zh).toMatchObject({ kind: "price_change", amount: 18, previousAmount: 15, currency: "CNY", nextChargeISO: "2026-11-20" });
  });

  test("email kind: a cancellation is a cancellation even when it mentions a price", async () => {
    const en = await extractFinding(msg(["Spotify", "no-reply@spotify.com"], "Your Premium subscription has been canceled", "We've canceled your Premium plan ($11.99/month). You'll keep Premium until November 12, 2026."), { now: NOW });
    expect(en).toMatchObject({ kind: "cancellation", nextChargeISO: null });
    expect(await kindOf(msg(["Canal+", "noreply@canalplus.com"], "Confirmation de résiliation", "Votre abonnement CANAL+ (25,99 €/mois) a bien été résilié."))).toBe("cancellation");
    expect(await kindOf(msg(["شاهد", "noreply@shahid.net"], "إشعار", "تم إلغاء اشتراكك في شاهد VIP بنجاح (39 درهم شهرياً)."))).toBe("cancellation");
    expect(await kindOf(msg(["京东", "noreply@jd.com"], "通知", "您已成功关闭京东PLUS会员自动续费服务，年费198元将不再扣除。"))).toBe("cancellation");
    // "If you've cancelled…" in a renewal is not a cancellation.
    expect(await kindOf(msg(["Hulu", "hulu@hulumail.com"], "Your subscription renewed", "Your plan renewed for $7.99. If you have already cancelled your subscription, please ignore this email."))).toBe("renewal");
  });

  test("email kind: a cancelled retail order is not a subscription cancellation", async () => {
    const order = await extractFinding(
      msg(["Amazon.com", "order-update@amazon.com"], "Your order has been cancelled", "Hello Emily, we've cancelled your order 113-4829301-2210947 as requested. A refund of $34.99 will be issued to your Visa."),
      { now: NOW },
    );
    expect(order?.kind ?? null).not.toBe("cancellation");
    expect(await kindOf(msg(["Uber", "noreply@uber.com"], "Trip update", "You've cancelled your trip. A cancellation fee of $5.00 was charged."))).not.toBe("cancellation");
    // The same words about a subscription are one.
    expect(await kindOf(msg(["Amazon.com", "prime@amazon.com"], "Membership update", "We've cancelled your Prime membership as requested. You won't be charged again."))).toBe("cancellation");
  });

  test("email kind: an upcoming renewal that also carries a promotion is kept; a newsletter's fine print is not a renewal", async () => {
    const kept = await extractFinding(
      msg(["Hulu", "hulu@hulumail.com"], "Your account", "Your Hulu plan renews on November 2, 2026 for $9.99. Upgrade to an annual plan and save 20%!"),
      { now: NOW },
    );
    expect(kept).toMatchObject({ kind: "renewal", nextChargeISO: "2026-11-02", amount: 9.99, chargedISO: null });
    expect(
      await kindOf(msg(["Hulu", "news@hulumail.com"], "New this week on Hulu", "Watch the new season now. Save 20% on an annual plan. Subscription auto-renews monthly until cancelled. Unsubscribe")),
    ).toBeNull();
  });

  test("email kind: shipping, password resets, newsletters and marketing are not billing", async () => {
    expect(await kindOf(msg(["Amazon.com", "shipment-tracking@amazon.com"], "Your order has shipped", "Order total: $34.99. Track your package."))).toBeNull();
    expect(await kindOf(msg(["Netflix", "info@account.netflix.com"], "Reset your password", "Your plan ($15.49/month) is unaffected."))).toBeNull();
    expect(await kindOf(msg(["Disney+", "news@mail.disneyplus.com"], "New on Disney+ this week", "Plans from £4.99/month. Start your free trial today. Unsubscribe"))).toBeNull();
    expect(await kindOf(msg(["Spotify", "no-reply@spotify.com"], "Get 3 months of Premium for £0", "Limited-time offer: try Premium free, then £11.99/month. Cancel anytime."))).toBeNull();
    expect(await kindOf(msg(["京东", "noreply@jd.com"], "您的订单已发货", "订单金额：￥199.00，快递单号 SF1234567890"))).toBeNull();
    expect(await kindOf(msg(["Orange", "ne-pas-repondre@orange.fr"], "Votre code de vérification", "Votre code est 482913. Forfait 42,99 €/mois."))).toBeNull();
    expect(await kindOf(msg(["Jumia", "noreply@jumia.ma"], "تم شحن طلبك", "المجموع: 459 درهم"))).toBeNull();
  });

  test("email kind: other billing mail (a failed payment) is 'other', and header prefilters accept bills in every language", async () => {
    expect(await kindOf(msg(["Netflix", "info@account.netflix.com"], "Your payment failed", "We couldn't process your payment. Please update your payment method."))).toBe("other");
    for (const subject of ["Your receipt from Apple.", "Votre facture Free Mobile", "فاتورتكم لشهر أكتوبر", "爱奇艺VIP会员自动续费成功", "Su recibo de pago", "Ihre Rechnung", "Your free trial ends soon", "Price change for your plan"]) {
      expect(looksLikeBilling({ from: "x@example.com", subject })).toBe(true);
    }
    expect(looksLikeBilling({ from: "no_reply@email.apple.com", subject: "Apple" })).toBe(true);
    expect(looksLikeBilling({ from: "shipment-tracking@amazon.com", subject: "Your order has shipped" })).toBe(false);
    expect(looksLikeBilling({ from: "a@b.com", subject: "Reset your password" })).toBe(false);
    expect(looksLikeBilling({ from: "friend@gmail.com", subject: "Lunch on Friday?" })).toBe(false);
    for (const term of ["receipt", "facture", "فاتورة", "续费", "Rechnung", "recibo"]) expect(BILLING_TERMS).toContain(term);
    expect(Object.isFrozen(BILLING_TERMS)).toBe(true);
  });
});
