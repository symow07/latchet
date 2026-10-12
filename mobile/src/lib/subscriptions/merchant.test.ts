import { describe, expect, test } from 'bun:test';
import { ALIASES } from './aliases';
import { cleanMerchant, displayNameFor, merchantInfo, merchantKey } from './merchant';

const keyOf = (texts: string[]) => texts.map((t) => [t, merchantKey(t)]);
const allAre = (texts: string[], key: string) => expect(keyOf(texts)).toEqual(texts.map((t) => [t, key]));

describe('merchant key', () => {
  test('a SEPA direct debit loses PRLV SEPA, the reference and the creditor id', () => {
    const raw = 'PRLV SEPA FREE MOBILE REF:FM100234 ICS FR12ZZZ456789';
    expect(merchantKey(raw)).toBe('free_mobile');
    expect(cleanMerchant(raw)).toBe('Free Mobile');
    // Société Générale names the creditor after "DE:"; BNP writes slashes.
    allAre(
      [
        'PRELEVEMENT EUROPEEN 1234567890 DE: FREE MOBILE ID: FR35ZZZ526354 MOTIF: FreeMobile 0612345678 REF: 202609A MANDAT FM-123456',
        'PRLV SEPA FREE MOBILE ECH/150926 ID EMETTEUR/FR35ZZZ526354 MDT/FM1234567 REF/2026091',
        'PRÉLÈVEMENT SEPA FREE MOBILE',
        'free-mobile.fr',
      ],
      'free_mobile'
    );
    expect(merchantKey('PRLV SEPA Free Telecom ECH/050926 ID EMETTEUR/FR28ZZZ123456 MDT/FB098765')).toBe('freebox');
  });

  test('card numbers and card wording are stripped', () => {
    allAre(
      [
        'CARD 4921 XXXX XXXX 1234 SPOTIFY P1A2B3C',
        '4921 **** **** 1234 SPOTIFY',
        'CB*1234 SPOTIFY',
        'CARTE X4521 02/09 SPOTIFY',
        'SPOTIFY XXXX1234',
      ],
      'spotify'
    );
    allAre(
      [
        'CB NETFLIX.COM 12/09',
        'CARTE X1234 12/09 NETFLIX.COM',
        'PAIEMENT PAR CARTE X1234 NETFLIX.COM 12/09',
        'ACHAT TPE NETFLIX.COM AMSTERDAM',
        'POS DEBIT NETFLIX.COM',
        'DEBIT CARD PURCHASE NETFLIX.COM',
        'PURCHASE AUTHORIZED ON 09/13 NETFLIX.COM 866-579-7172 CA S386256567890123 CARD 1234',
        'RECURRING PAYMENT AUTHORIZED ON 09/13 NETFLIX.COM',
      ],
      'netflix'
    );
  });

  test('every Netflix spelling and sender domain is one key', () => {
    allAre(
      [
        'NETFLIX.COM 866-579-7172 CA',
        'Netflix',
        'netflix.com',
        'account.netflix.com',
        'info@mailer.netflix.com',
        'PAYPAL *NETFLIX',
        'NETFLIX INTERNATIONAL B.V.',
        'NETFLIX INC PPD ID: 1234567',
        'NETFLIXCOM',
        'NETFLIX',
      ],
      'netflix'
    );
  });

  test('every Spotify spelling, including PayPal SEPA debits, is one key', () => {
    allAre(
      [
        'Spotify USA 877-778-1161 NY',
        'SPOTIFY AB',
        'Spotify P0F1C2D3E4',
        'PRLV SEPA PAYPAL EUROPE S.A.R.L. ET CIE S.C.A 1037712345678 PP.8765.PP . SPOTIFY AB, Ihr Einkauf bei SPOTIFY AB',
        'no-reply@spotify.com',
        'spotifymail.com',
      ],
      'spotify'
    );
  });

  test('Apple, Google Play and PayPal set billedVia and give way to what they bill for', () => {
    const apple = merchantInfo('APPLE.COM/BILL 866-712-7753 CA');
    expect([apple.key, apple.billedVia]).toEqual(['apple', 'apple']);
    const icloud = merchantInfo('APPLE.COM/BILL ICLOUD');
    expect([icloud.key, icloud.billedVia]).toEqual(['icloud', 'apple']);
    expect(merchantKey('email.apple.com')).toBe('apple');
    const yt = merchantInfo('GOOGLE *YouTubePremium g.co/helppay#');
    expect([yt.key, yt.billedVia]).toEqual(['youtube_premium', 'google_play']);
    expect(merchantKey('GOOGLE *Google Storage')).toBe('google_one');
    expect(merchantKey('GOOGLE *YouTube TV')).toBe('youtube_tv');
    const disney = merchantInfo('PAYPAL *DISNEYPLUS 35314369001 ON 05 SEP BCC');
    expect([disney.key, disney.billedVia]).toEqual(['disney_plus', 'paypal']);
    expect(merchantInfo('NETFLIX.COM').billedVia).toBeNull();
  });

  test('processor prefixes go: SQ *, TST*, PP*, DD *, AMZN Mktp', () => {
    expect(merchantKey('SQ *SUNRISE YOGA STUDIO')).toBe('sunrise_yoga_studio');
    expect(merchantKey('TST* SUNRISE YOGA STUDIO 0042')).toBe('sunrise_yoga_studio');
    expect(merchantKey('PP*SUNRISE YOGA STUDIO')).toBe('sunrise_yoga_studio');
    expect(merchantKey('DD *DOORDASH DASHPASS')).toBe('dashpass');
    // A marketplace order names nobody once its order number is gone.
    expect(merchantKey('AMZN Mktp US*2K4L83')).toBe('');
    expect(merchantKey('Amazon Prime*2K4L83')).toBe('amazon_prime');
  });

  test('dates, times, store numbers, phones and places are stripped', () => {
    expect(cleanMerchant('STARBUCKS STORE 08123 SEATTLE WA')).toBe('Starbucks');
    expect(cleanMerchant('PRET A MANGER 0123   ON 02 SEP          BCC')).toBe('Pret A Manger');
    expect(cleanMerchant('SUNRISE LAWN CARE LLC 512-555-0147 TX')).toBe('Sunrise Lawn Care');
    expect(cleanMerchant('CITY BIKES 12:43 2026-09-14 #0042')).toBe('City Bikes');
    expect(cleanMerchant('ACME WIDGETS LONDON GB')).toBe('Acme Widgets');
    expect(cleanMerchant('ACME WIDGETS SAN FRANCISCO CA')).toBe('Acme Widgets');
    expect(merchantKey('ACME WIDGETS 14SEP')).toBe('acme_widgets');
  });

  test('French, Moroccan, Arabic and Chinese names resolve', () => {
    expect(keyOf(['CANAL+', 'GROUPE CANAL+ ABONNEMENT', 'canalplus.com'])).toEqual([
      ['CANAL+', 'canal_plus'],
      ['GROUPE CANAL+ ABONNEMENT', 'canal_plus'],
      ['canalplus.com', 'canal_plus'],
    ]);
    expect(merchantKey('PRLV SEPA BASIC FIT FRANCE SAS')).toBe('basic_fit');
    expect(merchantKey('PRELEVEMENT MAROC TELECOM FACT 0661234567')).toBe('maroc_telecom');
    expect(merchantKey('IAM FACTURE')).toBe('maroc_telecom');
    expect(merchantKey('PRELEVEMENT ORANGE MAROC FACT 2026/09')).toBe('orange');
    expect(merchantKey('PAIEMENT PAR CARTE 12/09 INWI CASABLANCA')).toBe('inwi');
    expect(merchantKey('شاهد VIP')).toBe('shahid');
    expect(merchantKey('PAIEMENT CB SHAHID.NET DUBAI')).toBe('shahid');
    expect(merchantKey('北京爱奇艺科技有限公司')).toBe('iqiyi');
    expect(cleanMerchant('北京爱奇艺科技有限公司')).toBe('爱奇艺');
    expect(merchantKey('腾讯视频VIP连续包月')).toBe('tencent_video');
    expect(merchantKey('优酷')).toBe('youku');
    expect(merchantKey('哔哩哔哩')).toBe('bilibili');
    expect(merchantKey('网易云音乐 自动续费')).toBe('netease_music');
    expect(merchantKey('ＱＱ音乐')).toBe('qq_music');
    expect(merchantKey('京东PLUS会员')).toBe('jd_plus');
    expect(merchantKey('京东商城')).toBe('jd');
    expect(merchantKey('淘宝88VIP')).toBe('88vip');
  });

  test('the longest name wins and parent brands only count alone', () => {
    expect(merchantKey('MICROSOFT*XBOX')).toBe('xbox_game_pass');
    expect(merchantKey('MICROSOFT*OFFICE 365')).toBe('microsoft_365');
    expect(merchantKey('AMAZON PRIME UK')).toBe('amazon_prime');
    expect(merchantKey('AMAZON.CO.UK')).toBe('amazon');
    expect(merchantKey("L'ORANGE BLEUE")).toBe('l_orange_bleue');
    expect(merchantKey('ORANGETHEORY FITNESS')).toBe('orangetheory');
    expect(merchantKey('UBER *ONE')).toBe('uber_one');
    expect(merchantKey('UBER *TRIP HELP.UBER.COM')).toBe('uber');
    expect(merchantKey('AT&T*BILL PAYMENT')).toBe('att');
    expect(merchantKey('DISNEY+')).toBe('disney_plus');
    expect(merchantKey('MAX.COM')).toBe('hbo_max');
    expect(merchantKey('CLAUDE.AI SUBSCRIPTION')).toBe('claude');
  });

  test('every spelling and domain in the alias table resolves to its own merchant', () => {
    const wrong = ALIASES.flatMap((e) => [
      ...e.names.map((n) => n.replace(/^~/, '')).filter((n) => merchantKey(n) !== e.key).map((n) => `${n} → ${merchantKey(n)} (not ${e.key})`),
      ...e.domains.filter((d) => merchantKey(d) !== e.key).map((d) => `${d} → ${merchantKey(d)} (not ${e.key})`),
    ]);
    expect(wrong).toEqual([]);
    expect(new Set(ALIASES.map((e) => e.key)).size).toBe(ALIASES.length);
  });

  test('a key is its own key, for every alias and for unknown merchants', () => {
    for (const entry of ALIASES) expect([entry.key, merchantKey(entry.key)]).toEqual([entry.key, entry.key]);
    for (const raw of ['SUNRISE LAWN CARE LLC 512-555-0147 TX', 'CAFE DE FLORE PARIS', '某某健身房', 'JOE S TACOS 0042', 'ACME WIDGETS PARIS RENTALS LTD']) {
      const key = merchantKey(raw);
      expect([raw, merchantKey(key)]).toEqual([raw, key]);
    }
    // Older stored spellings find the same key.
    expect(keyOf(['NETFLIX COM', 'NETFLIX', 'sub netflix', 'FREE MOBILE'])).toEqual([
      ['NETFLIX COM', 'netflix'],
      ['NETFLIX', 'netflix'],
      ['sub netflix', 'netflix'],
      ['FREE MOBILE', 'free_mobile'],
    ]);
  });

  test('transfers, cash, refunds, fees, debt and tax are marked as never a subscription', () => {
    const why = (raw: string) => merchantInfo(raw).excluded;
    expect(why('Zelle payment to MIKE LANDLORD JPM99B7X2Q1L')).toBe('transfer');
    expect(why('VIR SEPA EMIS VERS M DUPONT LOYER')).toBe('transfer');
    expect(why('Online Transfer to SAV ...4417')).toBe('transfer');
    expect(why('J SMITH RENT       STO')).toBe('transfer');
    expect(why('张*三')).toBe('transfer');
    expect(why('RETRAIT DAB 05/09 PARIS 9')).toBe('cash');
    expect(why('REFUND NETFLIX.COM')).toBe('refund');
    expect(why('FRAIS TENUE DE COMPTE')).toBe('fee');
    expect(why('COTISATION CARTE VISA PREMIER')).toBe('fee');
    expect(why('CHASE CREDIT CRD AUTOPAY PPD ID: 4760039224')).toBe('debt');
    expect(why('PRLV SEPA DGFIP IMPOT PRELEVEMENT A LA SOURCE')).toBe('tax');
    // Names that merely look like those words are not.
    expect(why('NOTION.SO')).toBeNull();
    expect(why('PRET A MANGER 0123')).toBeNull();
    expect(why('VIRGIN MEDIA')).toBeNull();
  });

  test('habits are marked, known or not', () => {
    expect(merchantInfo('STARBUCKS STORE 08123').habitual).toBe(true);
    expect(merchantInfo('瑞幸咖啡').habitual).toBe(true);
    expect(merchantInfo('TST* JOES PIZZA 0042').habitual).toBe(true);
    expect(merchantInfo('PAIEMENT PAR CARTE CAFE BOUGAINVILLE CASA').habitual).toBe(true);
    expect(merchantInfo('NETFLIX.COM').habitual).toBe(false);
    expect(merchantInfo('SUNRISE LAWN CARE').habitual).toBe(false);
  });

  test('text that names nobody has no key', () => {
    expect(keyOf(['', '   ', 'PRLV SEPA REF:12345', '12/09/2026', 'CARD 4921 XXXX XXXX 1234', 'MONTHLY SUBSCRIPTION'])).toEqual([
      ['', ''],
      ['   ', ''],
      ['PRLV SEPA REF:12345', ''],
      ['12/09/2026', ''],
      ['CARD 4921 XXXX XXXX 1234', ''],
      ['MONTHLY SUBSCRIPTION', ''],
    ]);
  });

  test('display names: proper names for known keys, the cleaned text otherwise', () => {
    expect(displayNameFor('disney_plus')).toBe('Disney+');
    expect(displayNameFor('netflix', 'NETFLIX.COM 866-579-7172 CA')).toBe('Netflix');
    expect(displayNameFor('iqiyi')).toBe('爱奇艺');
    expect(displayNameFor('sunrise_lawn_care', 'SUNRISE LAWN CARE LLC 512-555-0147 TX')).toBe('Sunrise Lawn Care');
    expect(displayNameFor('sunrise_lawn_care')).toBe('Sunrise Lawn Care');
    // Text already in mixed case keeps the merchant's own spelling.
    expect(cleanMerchant('McDonald\'s 0042')).toBe("McDonald's");
  });
});
