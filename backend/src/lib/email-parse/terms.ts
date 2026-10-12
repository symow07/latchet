/**
 * The words that make an email a bill, and which kind of bill: English,
 * French, Arabic and Chinese, with Spanish and German lightly. Phrases are
 * specific on purpose — "cancel anytime" is not a cancellation and "start your
 * free trial" is not a trial ending.
 */

/** A Latin phrase bounded by non-letters (\b is ASCII-only and fails beside é). */
const L = (src: string) => `(?<![\\p{L}\\p{N}])(?:${src})(?![\\p{L}])`;
const re = (parts: string[]) => new RegExp(parts.join("|"), "iu");

const SUBSCRIPTIONISH = "subscription|membership|plan|account|service|premium|abonnement|forfait|contrat|offre|suscripción|abonnement|mitgliedschaft";

export const CANCELLATION_RE = re([
  // English
  L(`(?:${SUBSCRIPTIONISH}|trial|auto-?renew(?:al)?)\\s+(?:has\\s+been|have\\s+been|was|is\\s+now|is|will\\s+be)\\s+(?:successfully\\s+)?(?:cancell?ed|terminated|deactivated)`),
  L("(?:we(?:'ve|’ve| have)?|you(?:'ve|’ve| have)?)\\s+(?:successfully\\s+)?cancell?ed\\s+(?:your|the|this)(?!\\s+(?:order|item|purchase|booking|reservation|ride|trip|delivery|appointment|transfer|payment)s?(?![\\p{L}]))"),
  L("cancell?ation\\s+(?:confirmation|confirmed|is\\s+confirmed|complete|completed|request\\s+(?:received|confirmed)|of\\s+your)"),
  L("confirm(?:ing|ation\\s+of)\\s+(?:your\\s+)?cancell?ation"),
  L("(?:subscription|membership|plan|trial)\\s+(?:cancell?ed|cancell?ation)"),
  L("auto-?renew(?:al)?\\s+(?:has\\s+been\\s+|is\\s+(?:now\\s+)?)?(?:turned\\s+off|disabled|switched\\s+off)"),
  L("(?:will\\s+not|won't|won’t)\\s+(?:be\\s+)?(?:renew|renewed|auto-?renew)"),
  L("sorry\\s+to\\s+see\\s+you\\s+go"),
  // French
  L("(?:abonnement|forfait|contrat|offre|souscription|essai|adhésion)\\s+(?:a\\s+(?:bien\\s+)?été|est|sera)\\s+(?:bien\\s+)?(?:résiliée?|annulée?|clôturée?|arrêtée?|désactivée?)s?"),
  L("(?:confirmation|prise\\s+en\\s+compte|enregistrement)\\s+de\\s+(?:votre\\s+|la\\s+)?(?:résiliation|désabonnement|annulation)"),
  L("résiliation\\s+(?:de\\s+votre|confirmée|effective|enregistrée|de\\s+l'abonnement|de\\s+l’abonnement)"),
  L("(?:nous\\s+avons|vous\\s+avez)\\s+(?:bien\\s+)?(?:résilié|annulé)"),
  L("renouvellement\\s+automatique\\s+(?:a\\s+été\\s+|est\\s+)?(?:désactivé|annulé|arrêté)"),
  // Spanish, German
  L("suscripción\\s+(?:ha\\s+sido\\s+)?cancelada|(?:hemos|has)\\s+cancelado|confirmación\\s+de\\s+(?:la\\s+)?(?:cancelación|baja)"),
  L("(?:abonnement|mitgliedschaft|vertrag|abo)\\s+(?:wurde\\s+)?(?:gekündigt|storniert|beendet)|kündigungsbestätigung|bestätigung\\s+(?:ihrer|der)\\s+kündigung"),
  // Chinese
  "已取消(?:订阅|自动续费|续费|会员|服务)?|取消(?:订阅|自动续费|续费)?成功|退订成功|已退订|(?:已|成功)\\s*(?:成功)?(?:关闭|取消)[^。，,\\n]{0,16}?(?:自动续费|免密支付|自动扣款|代扣|续订)|(?:关闭|取消)[^。，,\\n]{0,16}?(?:自动续费|续订|订阅)[^。，,\\n]{0,6}?成功|(?:自动续费|免密支付|自动扣款|代扣)(?:服务)?已(?:关闭|取消|解约|停止)|解约成功|已解约|已停止自动续费|(?:将)?不再(?:自动)?(?:扣费|扣款|续费|扣除|续订)",
  // Arabic
  "تم\\s+(?:إلغاء|الغاء|ايقاف|إيقاف)\\s+(?:اشتراك|الاشتراك|التجديد|خدمة|الخدمة)|تأكيد\\s+(?:إلغاء|الإلغاء|الغاء)|لن\\s+يتم\\s+تجديد|تم\\s+إلغاء\\s+تجديد",
]);

export const PRICE_CHANGE_RE = re([
  L("price\\s+(?:change|increase|update|adjustment|rise)s?"),
  L("(?:new|updated|upcoming)\\s+(?:monthly\\s+|annual\\s+|yearly\\s+)?(?:price|pricing|rate|plan\\s+price|membership\\s+price)"),
  L("(?:price|rate|cost|fee)s?\\s+(?:is|are|will\\s+be)\\s+(?:changing|going\\s+up|increasing|rising|updating)"),
  L("(?:price|rate|cost|fee)s?\\s+(?:will|is\\s+going\\s+to|is\\s+set\\s+to|are\\s+going\\s+to)\\s+(?:change|increase|go\\s+up|rise)"),
  L("(?:increase|raise|change|update|adjust)(?:s|d)?\\s+(?:the\\s+)?(?:price|cost|fee)\\s+(?:of|for)\\s+(?:your|the|our)"),
  L("(?:change|increase|update)s?\\s+(?:to|in)\\s+(?:your\\s+|the\\s+|our\\s+)?(?:subscription\\s+|membership\\s+|plan\\s+|monthly\\s+)?(?:price|pricing|rate)"),
  L("(?:we(?:'re|’re| are)|we\\s+will\\s+be)\\s+(?:raising|increasing|updating|changing|adjusting)\\s+(?:the|our|your)\\s+(?:price|prices|pricing)"),
  L("(?:changement|évolution|modification|hausse|augmentation|ajustement|révision)\\s+(?:de\\s+(?:votre\\s+|vos\\s+|nos\\s+|la\\s+|l'|l’)?|du\\s+|des\\s+)(?:prix|tarifs?|tarification|mensualité|abonnement)"),
  L("(?:changement|évolution|modification|hausse|augmentation|ajustement|révision)s?\\s+tarifaires?"),
  L("(?:nouveaux?|nouvelles?)\\s+(?:prix|tarifs?|tarification)"),
  L("(?:votre\\s+)?(?:prix|tarif)\\s+(?:évolue|change|augmente|va\\s+(?:évoluer|changer|augmenter)|passe(?:ra)?\\s+de)"),
  L("(?:cambio|aumento|actualización)\\s+(?:de|del|en\\s+el)\\s+(?:precio|tarifa)|nuevo\\s+precio"),
  L("preiserhöhung|preisänderung|preisanpassung|neuer\\s+preis"),
  "价格调整|调价|价格变更|价格变动|涨价|价格上调|资费调整|费用调整|新价格|价格将(?:调整|上调|变更)|续费价格(?:调整|变更)",
  "تغيير\\s+(?:في\\s+)?(?:السعر|الأسعار|سعر)|تعديل\\s+(?:في\\s+)?(?:السعر|الأسعار|سعر)|زيادة\\s+(?:في\\s+)?(?:السعر|الأسعار|سعر)|السعر\\s+الجديد|الأسعار\\s+الجديدة|رفع\\s+(?:السعر|الأسعار)",
]);

export const TRIAL_ENDING_RE = re([
  L("trial(?:\\s+period)?[^.\\n]{0,60}?(?<![\\p{L}])(?:ends|will\\s+end|is\\s+ending|ending|expires|will\\s+expire|is\\s+about\\s+to\\s+end|is\\s+(?:almost|nearly)\\s+over|wraps\\s+up)(?![\\p{L}])"),
  L("(?:end|ending)\\s+of\\s+(?:your\\s+|the\\s+)?(?:free\\s+)?trial"),
  L("(?:days?|hours?)\\s+left\\s+(?:in|on|of)\\s+your\\s+(?:free\\s+)?trial"),
  L("(?:after|when)\\s+(?:your|the)\\s+(?:free\\s+)?trial(?:\\s+period)?\\s+ends"),
  L("(?:période\\s+d['’]essai|essai(?:\\s+gratuit)?|offre\\s+d['’]essai)[^.\\n]{0,40}?(?:se\\s+termine|prend\\s+fin|expire|arrive\\s+à\\s+(?:son\\s+terme|échéance|sa\\s+fin)|s['’]achève|va\\s+(?:se\\s+terminer|prendre\\s+fin|expirer))"),
  L("fin\\s+de\\s+(?:votre\\s+|la\\s+|l['’])\\s*(?:période\\s+d['’]essai|essai)"),
  L("(?:prueba|periodo\\s+de\\s+prueba)(?:\\s+gratuita)?\\s+(?:termina|finaliza|vence|terminará)|fin\\s+de\\s+(?:tu|su)\\s+prueba"),
  L("(?:testzeitraum|probezeitraum|probeabo|testphase|probemonat|gratis-?testphase)\\s+(?:endet|läuft\\s+(?:ab|aus))|kostenlose\\s+(?:testphase|probezeit)\\s+endet"),
  "试用(?:期|会员)?(?:即将|将于|将在|还有|于)?.{0,12}?(?:到期|结束|截止)|免费试用(?:期)?.{0,12}?(?:到期|结束)|体验(?:期|会员)(?:即将|将于)?.{0,12}?(?:到期|结束)|试用期至",
  "(?:الفترة|فترة|فترتك)\\s+(?:ال)?تجريبية(?:\\s+المجانية)?\\s*(?:ستنتهي|تنتهي|على\\s+وشك|قاربت|ستنقضي|تنقضي)|(?:تنتهي|ستنتهي)\\s+(?:فترتك|الفترة|فترة|تجربتك|التجربة)\\s+(?:ال)?(?:تجريبية|المجانية)|(?:التجربة|تجربتك)\\s+المجانية\\s+(?:ستنتهي|تنتهي)",
]);

export const RENEWAL_RE = re([
  L("(?:has\\s+been|have\\s+been|was|were|successfully|is)\\s+renewed"),
  L("(?:subscription|membership|plan)\\s+(?:renewal|renewed|renews|will\\s+renew)"),
  L("auto-?renew(?:al|ed|s|ing)?|automatic(?:ally)?\\s+renew(?:al|ed|s)?"),
  L("(?:will|is\\s+going\\s+to|is\\s+set\\s+to|is\\s+about\\s+to)\\s+(?:automatically\\s+)?renew"),
  L("renews?\\s+(?:on|in|automatically|soon|tomorrow|today)"),
  L("renews?\\s+(?=\\d{1,2}\\s*\\p{L}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?\\s+\\d)|renewal\\s+price"),
  L("(?:upcoming|next)\\s+(?:renewal|payment|charge|billing|bill)"),
  L("renewal\\s+(?:notice|reminder|confirmation|date|receipt)"),
  L("(?:recurring|automatic)\\s+(?:payment|charge|billing)"),
  L("renouvel(?:é|ée|és|ées|lement|le|lera|leront|ler)|reconduction|reconduite?"),
  L("(?:prélèvement|débit|paiement)\\s+(?:mensuel|annuel|automatique|récurrent)"),
  L("abonnement\\s+(?:a\\s+été\\s+)?(?:prolongé|reconduit)"),
  L("(?:sera|seront)\\s+(?:automatiquement\\s+)?(?:prélevée?s?|débitée?s?)"),
  L("renov(?:ación|ado|ada|ará|amos)|se\\s+renovará|pago\\s+(?:recurrente|automático)"),
  L("verlänger(?:t|ung|n)|automatische\\s+(?:verlängerung|zahlung)"),
  "续费|续订|自动扣款|自动扣费|代扣|连续包月|连续包年|连续包季|自动续期|会员(?:已)?续期|免密支付",
  "تجديد|يتجدد|سيتجدد|التجديد\\s+التلقائي|الدفع\\s+التلقائي|الاقتطاع\\s+الشهري",
]);

export const RECEIPT_RE = re([
  L("receipt|invoice|e-?receipt"),
  L("subscription\\s+confirm(?:ation|ed)|confirmation\\s+of\\s+(?:your\\s+)?subscription|you(?:'re|’re|\\s+are)\\s+(?:now\\s+)?subscribed\\s+to"),
  L("confirmation\\s+(?:de\\s+(?:votre\\s+|ton\\s+)?|d['’])(?:abonnement|souscription)"),
  L("(?:payment|purchase|order|transaction)\\s+(?:confirmation|confirmed|received|successful|complete|completed|processed|summary)"),
  L("thank(?:s|\\s+you)\\s+for\\s+your\\s+(?:payment|purchase|order|subscription|renewal)"),
  L("you(?:'ve|’ve|\\s+have)?\\s+(?:paid|been\\s+charged|sent\\s+(?:a|an\\s+automatic)\\s+payment)"),
  L("(?:amount|total)\\s+(?:paid|charged)|billing\\s+statement|(?:your\\s+)?(?:bill|statement)\\s+is\\s+(?:ready|available)"),
  L("reçu|facture|ticket\\s+de\\s+caisse|récapitulatif\\s+de\\s+(?:votre\\s+)?commande"),
  L("(?:confirmation|accusé\\s+de\\s+réception)\\s+de\\s+(?:votre\\s+)?(?:paiement|commande|achat|règlement)"),
  L("paiement\\s+(?:reçu|effectué|accepté|confirmé|validé|réussi)|merci\\s+(?:pour|de)\\s+votre\\s+(?:paiement|achat|commande|règlement)"),
  L("montant\\s+(?:prélevé|débité|payé|réglé)"),
  L("recibo|factura|confirmación\\s+de\\s+(?:pago|compra|pedido)|pago\\s+(?:recibido|realizado|confirmado)|gracias\\s+por\\s+tu\\s+(?:compra|pago)"),
  L("rechnung|quittung|zahlungsbestätigung|kaufbestätigung|bestellbestätigung|zahlung\\s+erhalten"),
  "收据|发票|电子发票|账单|(?:扣款|扣费|支付|实付|付款)金额|支付成功|付款成功|交易成功|购买成功|订单(?:支付|付款)成功|消费(?:凭证|提醒)|扣费凭证|付款凭证|支付凭证|交易凭证|已支付|已付款|开通成功|扣款成功|扣费成功",
  "تم\\s+(?:تفعيل\\s+)?(?:اشتراكك|الاشتراك)|订阅成功|开通成功|إيصال|ايصال|فاتورة|فاتورتك|فاتورتكم|تم\\s+(?:الدفع|استلام\\s+(?:الدفع|دفعتك|المبلغ)|تأكيد\\s+الدفع)|تأكيد\\s+(?:الدفع|الطلب|الشراء)|المبلغ\\s+المدفوع",
]);

/** Shipping, sign-in and account-security mail: never a bill, whatever amounts it shows. */
export const NON_BILLING_RE = re([
  L("(?:has|have)\\s+(?:been\\s+)?shipped|(?:is|are)\\s+on\\s+(?:its|their)\\s+way|out\\s+for\\s+delivery|(?:has\\s+been|was)\\s+delivered"),
  L("(?:shipping|delivery|shipment|dispatch)\\s+(?:confirmation|notification|update)|track\\s+(?:your\\s+)?(?:package|parcel|order|shipment)|your\\s+(?:package|parcel)"),
  L("(?:reset|change|forgot(?:ten)?)\\s+(?:your\\s+)?password|password\\s+(?:reset|change|assistance)|verification\\s+code|one-?time\\s+(?:code|passcode|password)"),
  L("(?:security|login|sign-?in)\\s+(?:alert|code|notification|attempt)|new\\s+(?:sign-?in|login|device)|verify\\s+your\\s+(?:email|account|identity)|confirm\\s+your\\s+email"),
  L("(?:colis|commande)\\s+(?:a\\s+été\\s+|est\\s+)?(?:expédiée?|livrée?|en\\s+cours\\s+de\\s+livraison|en\\s+route)|suivi\\s+de\\s+(?:votre\\s+)?(?:colis|commande)|avis\\s+d['’]expédition"),
  L("réinitialis(?:er|ation)\\s+(?:de\\s+)?(?:votre\\s+)?mot\\s+de\\s+passe|mot\\s+de\\s+passe\\s+oublié|code\\s+de\\s+(?:vérification|confirmation|sécurité)|nouvelle\\s+connexion"),
  L("pedido\\s+(?:ha\\s+sido\\s+)?enviado|restablecer\\s+(?:tu\\s+)?contraseña|versandbestätigung|passwort\\s+zurücksetzen"),
  "已发货|已出货|出货通知|发货通知|配送通知|已寄出|已签收|派送中|配送中|物流(?:信息|通知|更新)|快递|验证码|重置密码|找回密码|登录提醒|安全提醒|新设备登录|账号安全",
  "تم\\s+شحن|شحنتك|طلبك\\s+في\\s+الطريق|تم\\s+التوصيل|إعادة\\s+تعيين\\s+كلمة\\s+(?:المرور|السر)|رمز\\s+(?:التحقق|التأكيد)|تسجيل\\s+دخول\\s+جديد",
]);

/** Promotions and newsletters: not a bill unless a completed charge is also there. */
export const MARKETING_RE = re([
  "\\d+\\s?%\\s*(?:off|de\\s+réduction|de\\s+remise|خصم)",
  L("(?:special|limited[- ]time|exclusive)\\s+offer|black\\s+friday|cyber\\s+monday|flash\\s+sale|newsletter|this\\s+week\\s+(?:in|at|on)|deals?\\s+(?:of|for)\\s+the"),
  L("(?:save|économisez|ahorra|sparen\\s+sie)\\s+(?:up\\s+to|jusqu['’]à|hasta|bis\\s+zu|\\d)"),
  L("(?:try|essayez|start|commencez|démarrez)\\s+(?:it\\s+)?(?:for\\s+)?(?:free|gratuitement|votre\\s+essai)|start\\s+your\\s+free\\s+trial|get\\s+\\d+\\s+months?\\s+(?:for|free)"),
  L("offre\\s+(?:spéciale|exclusive|limitée)|soldes|bons\\s+plans"),
  "限时|优惠券|特惠|促销|大促|秒杀|低至",
  "عرض\\s+(?:خاص|حصري|محدود)|تخفيضات|خصم\\s+\\d",
]);

/** A charge that already happened. */
export const COMPLETED_RE = re([
  L("(?:has|have)\\s+been\\s+(?:successfully\\s+)?(?:renewed|charged|processed|paid|billed|debited)|was\\s+(?:successfully\\s+)?(?:renewed|charged|processed|billed)"),
  L("(?:we(?:'ve|’ve|\\s+have)?)\\s+(?:successfully\\s+)?(?:charged|billed|renewed|received|processed)"),
  L("(?:payment|charge|transaction|renewal|purchase)\\s+(?:was\\s+|has\\s+been\\s+)?(?:received|successful|succeeded|confirmed|processed|completed?)"),
  L("(?:you(?:'ve|’ve)\\s+been|you\\s+were)\\s+(?:charged|billed)|you\\s+paid|amount\\s+(?:paid|charged)"),
  L("thank(?:s|\\s+you)\\s+for\\s+your\\s+(?:payment|purchase|order|renewal)|receipt"),
  L("a\\s+(?:bien\\s+)?été\\s+(?:renouvelée?|prélevée?|débitée?|payée?|réglée?|reçue?|effectuée?|validée?|acceptée?|confirmée?)|avons\\s+(?:bien\\s+)?(?:reçu|enregistré|prélevé|débité|encaissé)"),
  L("paiement\\s+(?:reçu|effectué|accepté|confirmé|validé|réussi)|merci\\s+pour\\s+votre\\s+(?:paiement|achat|règlement|commande)|reçu"),
  L("ha\\s+sido\\s+renovad[oa]|hemos\\s+(?:cobrado|recibido)|pago\\s+(?:recibido|realizado|confirmado)|wurde\\s+(?:verlängert|abgebucht|bezahlt)|zahlung\\s+(?:erhalten|bestätigt)"),
  "(?:续费|扣款|扣费|支付|付款|开通|续订|续期|购买|交易)成功|已(?:扣款|扣费|续费|支付|付款|续订|开通|续期)|本次(?:扣款|续费|扣费)|收据",
  "تم\\s+(?:تجديد|التجديد|الدفع|خصم|استلام|اقتطاع|تفعيل)|شكرا\\s+(?:لك\\s+|لكم\\s+)?على\\s+(?:الدفع|الشراء)|إيصال",
]);

/** A charge still to come. */
export const UPCOMING_RE = re([
  L("will\\s+(?:be\\s+)?(?:automatically\\s+)?(?:renew|renewed|charged|billed|debited)|(?:is|are)\\s+(?:about|going|set|scheduled)\\s+to\\s+(?:renew|be\\s+charged)"),
  L("upcoming\\s+(?:renewal|payment|charge|bill)|renews?\\s+(?:on|in|soon|tomorrow)|reminder|heads\\s+up"),
  L("sera\\s+(?:automatiquement\\s+)?(?:renouvelée?|prélevée?|débitée?|facturée?|reconduite?)|va\\s+être\\s+(?:renouvelée?|prélevée?|débitée?)|rappel|prochainement|arrive\\s+à\\s+échéance"),
  L("se\\s+renovará|wird\\s+(?:automatisch\\s+)?verlängert"),
  "将(?:于|在)?.{0,16}?(?:自动)?(?:续费|扣款|扣费|续订)|即将(?:自动)?(?:续费|扣款|扣费|到期)|续费提醒|扣费提醒|到期提醒",
  "سيتم\\s+(?:تجديد|خصم|اقتطاع|تحصيل)|سوف\\s+يتم|سيتجدد|تذكير",
]);

/** Billing-related but none of the five kinds: a failed payment, an expiring card. */
export const OTHER_BILLING_RE = re([
  L("payment\\s+(?:failed|declined|unsuccessful|issue|problem)|(?:update|updating)\\s+your\\s+(?:payment|billing)\\s+(?:method|details|information)|card\\s+(?:has\\s+)?(?:expired|expiring|declined)"),
  L("échec\\s+(?:de|du)\\s+paiement|paiement\\s+(?:refusé|rejeté|échoué)|mettre\\s+à\\s+jour\\s+(?:votre\\s+)?moyen\\s+de\\s+paiement"),
  "扣款失败|支付失败|付款失败|余额不足",
  "فشل\\s+(?:الدفع|عملية\\s+الدفع)|تعذر\\s+(?:الدفع|خصم)",
]);

/** Words that start the footer, where other amounts and disclaimers live. */
export const FOOTER_RE = re([
  L("unsubscribe|privacy\\s+policy|terms\\s+of\\s+(?:use|service)|all\\s+rights\\s+reserved|this\\s+(?:e-?mail|message)\\s+was\\s+sent\\s+to|you\\s+are\\s+receiving\\s+this|manage\\s+(?:your\\s+)?(?:email\\s+)?preferences"),
  L("se\\s+désabonner|désinscri(?:re|vez|ption)|politique\\s+de\\s+confidentialité|tous\\s+droits\\s+réservés|mentions\\s+légales"),
  "©|退订|隐私政策|版权所有|جميع\\s+الحقوق\\s+محفوظة",
]);

/** Kinds in the order they win when several match. */
export const KIND_ORDER = ["cancellation", "price_change", "trial_ending", "renewal", "receipt"] as const;
export type RuleKind = (typeof KIND_ORDER)[number];

export const KIND_RES: Record<RuleKind, RegExp> = {
  cancellation: CANCELLATION_RE,
  price_change: PRICE_CHANGE_RE,
  trial_ending: TRIAL_ENDING_RE,
  renewal: RENEWAL_RE,
  receipt: RECEIPT_RE,
};

/**
 * Search terms for providers' queries (Gmail `subject:(…)`, Outlook `$search`),
 * in every language above. Multi-word terms are phrases.
 */
export const BILLING_TERMS: readonly string[] = Object.freeze([
  // English
  "receipt", "invoice", "subscription", "renewal", "renewed", "auto-renew", "membership", "payment received",
  "payment confirmation", "your payment", "billing", "free trial", "trial ends", "price change", "price increase",
  "order confirmation", "cancellation", "has been canceled", "has been cancelled",
  // French
  "reçu", "facture", "abonnement", "renouvellement", "prélèvement", "paiement", "essai gratuit", "résiliation",
  "nouveau tarif", "évolution tarifaire",
  // Spanish, German
  "recibo", "factura", "suscripción", "renovación", "Rechnung", "Abonnement", "Zahlung", "Kündigung", "Verlängerung",
  // Arabic
  "فاتورة", "إيصال", "اشتراك", "تجديد", "الدفع", "الفترة التجريبية", "إلغاء الاشتراك",
  // Chinese
  "收据", "发票", "账单", "订阅", "续费", "自动续费", "扣款", "扣费", "会员", "支付成功", "试用", "价格调整", "取消",
]);

const BILLING_SUBJECT_RE = re([
  ...[CANCELLATION_RE, PRICE_CHANGE_RE, TRIAL_ENDING_RE, RENEWAL_RE, RECEIPT_RE, OTHER_BILLING_RE].map((r) => r.source),
  L("subscription|membership|billing|payment|charged|your\\s+(?:plan|bill)|abonnement|paiement|prélèvement|suscripción|pago|zahlung"),
  "订阅|会员|扣款|扣费|账单|支付|付款|اشتراك|الدفع|دفع|فاتورة",
]);

/** Senders that only write about money. */
const BILLING_SENDER_RE =
  /(?:^|[<\s"])(?:billing|invoices?|receipts?|payments?|factur(?:e|ation)|rechnung|subscriptions?|renewals?|orders?)[\w.+-]*@|@(?:email\.apple\.com|itunes\.com|.*\bpaypal\.[a-z.]+|stripe\.com|paddle\.com|fastspring\.com|squareup\.com|messaging\.squareup\.com)(?:>|\s|$)|googleplay-noreply@google\.com|no_reply@email\.apple\.com|service@intl\.alipay\.com|@mail\.alipay\.com|wxpay|tenpay/i;

/**
 * A cheap prefilter on headers only: worth fetching the full body? Errs on
 * the side of yes; shipping and password mail is turned away.
 */
export function looksLikeBilling(meta: { from: string; subject: string }): boolean {
  const subject = (meta.subject ?? "").slice(0, 300);
  const from = (meta.from ?? "").slice(0, 300);
  if (NON_BILLING_RE.test(subject)) return false;
  if (BILLING_SUBJECT_RE.test(subject)) return true;
  return BILLING_SENDER_RE.test(from);
}
