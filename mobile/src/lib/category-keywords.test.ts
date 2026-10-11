import { describe, test, expect } from 'bun:test';
import {
  fallbackCategory,
  fallbackKeywords,
  mentionsAny,
  normaliseForMatching,
  regionForCurrency,
} from './category-keywords';
import { DEFAULT_CATEGORIES } from './category-meta';

/** Every [description, expected] pair under one currency. */
function expectAll(currency: string | null, cases: readonly [string, string | null][]): void {
  const got = cases.map(([description]) => [description, fallbackCategory(description, currency)]);
  expect(got).toEqual(cases.map(([d, want]) => [d, want]));
}

describe('categorisation fallback', () => {
  test('US merchants still categorise in dollars', () => {
    expectAll('USD', [
      ['KROGER #1123 CINCINNATI', 'Food'],
      ['Chevron 0042', 'Transport'],
      ["TRADER JOE'S #552", 'Food'],
      ['CHICK-FIL-A #01234', 'Food'],
      ['WALMART SUPERCENTER', 'Food'],
      ['TARGET 00012345', 'Shopping'],
      ['PLANET FITNESS', 'Gym'],
      ['HULU 877-8244858', 'Subscriptions'],
      ['AT&T BILL PAYMENT', 'Subscriptions'],
      ['LYFT *RIDE SUN 5PM', 'Transport'],
    ]);
  });

  test('keywords match whole words, never fragments of other words', () => {
    expectAll('USD', [
      // "bp" inside BPM, "auto" inside autograph, "bus" inside business, "bar"
      // inside Barclays, "shell" inside shellfish: the old substring table
      // matched every one of these.
      ['BPM studio session', null],
      ['AUTOGRAPH COLLECTORS', null],
      ['BUSINESS SERVICES LLC', null],
      ['BARCLAYS PAYMENT', null],
      ['SHELLFISH WHOLESALE', null],
      ['TAXIDERMY SUPPLIES', null],
      ['GYMNASTICS ACADEMY', null],
      ['TRAINING COURSE FEE', null],
      ['METRONOME REPAIR', null],
    ]);
    expectAll('EUR', [['Gaston Lagaffe', null]]);
  });

  test('case and accents do not matter', () => {
    for (const d of ['supermarché du coin', 'SUPERMARCHE DU COIN', 'SuperMarché', 'supermarche']) {
      expect(fallbackCategory(d, 'EUR')).toBe('Food');
    }
    expect(fallbackCategory('ÉPICERIE FINE', null)).toBe('Food');
    expect(fallbackCategory('PEAGE A7 VIENNE', null)).toBe('Transport');
    expect(fallbackCategory('Péage A7', null)).toBe('Transport');
    expect(fallbackCategory('CAFÉ DE FLORE', null)).toBe('Food');
  });

  test('Arabic words match with the article and particles attached', () => {
    expectAll('MAD', [
      ['مطعم الأندلس', 'Food'],
      ['المطعم', 'Food'],
      ['عشاء بالمطعم', 'Food'],
      ['للمطعم', 'Food'],
      ['والمقهى', 'Food'],
      ['طاكسي إلى المحطة', 'Transport'],
      ['ملابس العيد', 'Shopping'],
      ['اشتراك شهري', 'Subscriptions'],
      ['نادي رياضي', 'Gym'],
    ]);
  });

  test('Arabic diacritics and spelling variants are ignored', () => {
    expect(fallbackCategory('مَطْعَم', null)).toBe('Food');
    // ة and ه, أ/إ and bare ا, are written interchangeably.
    expect(fallbackCategory('مخبزه الحي', null)).toBe('Food');
    expect(fallbackCategory('مخبزة الحي', null)).toBe('Food');
    expect(fallbackCategory('افطار', null)).toBe('Food');
    expect(fallbackCategory('إفطار', null)).toBe('Food');
  });

  test('an Arabic keyword is not found inside another word', () => {
    // مول (mall) inside مولاي, جيم (gym) inside جيمس.
    expect(fallbackCategory('مولاي رشيد', 'MAD')).toBeNull();
    expect(fallbackCategory('جيمس', 'MAD')).toBeNull();
  });

  test('Chinese keywords match inside a longer run of characters', () => {
    expectAll('CNY', [
      ['在超市买菜', 'Food'],
      ['美团外卖', 'Food'],
      ['地铁票', 'Transport'],
      ['健身房月卡', 'Gym'],
      ['爱奇艺VIP会员', 'Subscriptions'],
      ['淘宝 订单', 'Shopping'],
      ['Netflix会员', 'Subscriptions'],
    ]);
  });

  test('Chinese substrings inside names that mean something else do not count', () => {
    expectAll('CNY', [
      // 京东 (JD.com) inside the streets 南京东路 and 北京东路.
      ['南京东路店', null],
      ['北京东路 星巴克', 'Food'],
      ['北京东路加油站', 'Transport'],
      ['京东商城', 'Shopping'],
      // 全家 (FamilyMart) inside a family photo; KFC's family bucket is food.
      ['全家福照片', null],
      ['全家便利店', 'Food'],
      ['肯德基全家桶', 'Food'],
      // 面包 (bread) inside a minivan, 加油 (refuel) inside a data top-up.
      ['面包车', null],
      ['流量加油包', null],
      ['加油 300', 'Transport'],
    ]);
  });

  test('euro brands and local words categorise in euros', () => {
    expectAll('EUR', [
      ['Carrefour Market Lyon', 'Food'],
      ['SNCF Voyageurs', 'Transport'],
      ['LEROY MERLIN', 'Shopping'],
      ['Basic-Fit', 'Gym'],
      ['CANAL+', 'Subscriptions'],
      ['REWE MARKT', 'Food'],
      ['MERCADONA', 'Food'],
      ['Albert Heijn', 'Food'],
      ['Aral Tankstelle', 'Transport'],
      ['Bäckerei Müller', 'Food'],
      ['Ristorante da Mario', 'Food'],
      ['ABONNEMENT NAVIGO', 'Transport'],
    ]);
  });

  test('British brands categorise in pounds', () => {
    expectAll('GBP', [
      ['Tesco Express', 'Food'],
      ['TfL Travel Charge', 'Transport'],
      ["SAINSBURY'S S/MKTS", 'Food'],
      ['PUREGYM LTD', 'Gym'],
      ['BOOTS 1234', 'Shopping'],
      ['SKY DIGITAL', 'Subscriptions'],
      ['TESCO PFS 4410', 'Transport'],
    ]);
  });

  test('Moroccan brands categorise in dirhams', () => {
    expectAll('MAD', [
      ['Marjane Casablanca', 'Food'],
      ['Afriquia station Rabat', 'Transport'],
      ['BIM STORES SARL', 'Food'],
      ["LABEL'VIE", 'Food'],
      ['ONCF BILLET', 'Transport'],
      ['INWI RECHARGE', 'Subscriptions'],
      ['IAM RECHARGE', 'Subscriptions'],
      ['CITY CLUB MAARIF', 'Gym'],
      ['JUMIA', 'Shopping'],
      ['مرجان', 'Food'],
      ['اتصالات المغرب', 'Subscriptions'],
    ]);
  });

  test('Chinese brands categorise in yuan, in characters or in letters', () => {
    expectAll('CNY', [
      ['美团', 'Food'],
      ['滴滴出行', 'Transport'],
      ['淘宝 订单', 'Shopping'],
      ['中国石化加油', 'Transport'],
      ['爱奇艺', 'Subscriptions'],
      ['乐刻运动', 'Gym'],
      ['DIDI CHUXING', 'Transport'],
      ['JD.COM', 'Shopping'],
    ]);
    // The offshore yuan is the same market.
    expect(fallbackCategory('DIDI CHUXING', 'CNH')).toBe('Transport');
  });

  test('a regional brand means nothing outside its region', () => {
    // BIM is a Moroccan grocer and an ordinary word elsewhere; Target is an
    // American shop and an English word.
    expect(fallbackCategory('BIM STORES', 'EUR')).toBeNull();
    expect(fallbackCategory('TARGET', 'EUR')).toBeNull();
    expect(fallbackCategory('SNCF', 'USD')).toBeNull();
    expect(fallbackCategory('TfL', 'EUR')).toBeNull();
    expect(fallbackCategory('Marjane', 'USD')).toBeNull();
    expect(fallbackCategory('DIDI', 'USD')).toBeNull();
    expect(fallbackCategory('Marjane', null)).toBeNull();
  });

  test('Chinese text brings the Chinese brands with it, whatever the currency', () => {
    // A Moroccan student in Shanghai, a French one in Beijing.
    expect(fallbackCategory('美团 45', 'MAD')).toBe('Food');
    expect(fallbackCategory('京东', 'EUR')).toBe('Shopping');
    expect(fallbackCategory('滴滴', 'USD')).toBe('Transport');
    expect(fallbackCategory('美团', null)).toBe('Food');
  });

  test('plain words in all four languages work in every currency', () => {
    const words: [string, string][] = [
      ['restaurant', 'Food'], ['supermarché', 'Food'], ['مطعم', 'Food'], ['超市', 'Food'],
      ['taxi', 'Transport'], ['carburant', 'Transport'], ['قطار', 'Transport'], ['地铁', 'Transport'],
      ['gym', 'Gym'], ['salle de sport', 'Gym'], ['جيم', 'Gym'], ['健身', 'Gym'],
      ['clothes', 'Shopping'], ['vêtements', 'Shopping'], ['ملابس', 'Shopping'], ['购物', 'Shopping'],
      ['streaming', 'Subscriptions'], ['abonnement', 'Subscriptions'], ['اشتراك', 'Subscriptions'], ['订阅', 'Subscriptions'],
    ];
    for (const currency of [null, 'USD', 'EUR', 'GBP', 'MAD', 'CNY', 'JPY', 'AED']) {
      expectAll(currency, words);
    }
  });

  test('global brands work in every currency', () => {
    for (const currency of [null, 'USD', 'EUR', 'GBP', 'MAD', 'CNY', 'JPY', 'AED']) {
      expectAll(currency, [
        ['NETFLIX.COM', 'Subscriptions'],
        ['Spotify P1234', 'Subscriptions'],
        ['UBER *TRIP', 'Transport'],
        ['IKEA', 'Shopping'],
        ['SHELL 0042', 'Transport'],
        ['CARREFOUR', 'Food'],
        ['STARBUCKS', 'Food'],
      ]);
    }
  });

  test('an unknown merchant or an empty description gives null', () => {
    expectAll('USD', [
      ['Zzyzx Holdings', null],
      ['', null],
      ['   ', null],
      ['12345 678', null],
      ['PAYROLL DEPOSIT', null],
      ['TRANSFER TO SAVINGS', null],
    ]);
    expectAll('EUR', [['VIREMENT SALAIRE', null], ['RETRAIT GAB', null]]);
    expectAll('CNY', [['支付宝', null], ['转账', null]]);
    expectAll('MAD', [['تحويل', null]]);
  });

  test('a plain word beats a brand: what was bought, not where', () => {
    expect(fallbackCategory('IKEA restaurant', 'EUR')).toBe('Food');
    expect(fallbackCategory('COSTCO GAS #123', 'USD')).toBe('Transport');
    expect(fallbackCategory('Amazon grocery', 'USD')).toBe('Food');
    expect(fallbackCategory('Shell café', 'EUR')).toBe('Food');
    expect(fallbackCategory('Carrefour station service', 'EUR')).toBe('Transport');
  });

  test('a longer match beats the shorter one inside it', () => {
    expect(fallbackCategory('Uber Eats', 'USD')).toBe('Food');
    expect(fallbackCategory('UBER TRIP', 'USD')).toBe('Transport');
    expect(fallbackCategory('Amazon Prime', 'USD')).toBe('Subscriptions');
    expect(fallbackCategory('Amazon', 'USD')).toBe('Shopping');
    expect(fallbackCategory('美团打车', 'CNY')).toBe('Transport');
    // A brand that contains a plain word of another category.
    expect(fallbackCategory('TESCO METRO', 'GBP')).toBe('Food');
  });

  test('how-it-was-paid words lose to what was bought', () => {
    expect(fallbackCategory('abonnement salle de sport', 'EUR')).toBe('Gym');
    expect(fallbackCategory('Netflix subscription', 'USD')).toBe('Subscriptions');
    expect(fallbackCategory('membership', 'USD')).toBe('Subscriptions');
    expect(fallbackCategory('健身房 自动续费', 'CNY')).toBe('Gym');
    expect(fallbackCategory('自动续费', 'CNY')).toBe('Subscriptions');
    expect(fallbackCategory('اشتراك نادي رياضي', 'MAD')).toBe('Gym');
  });

  test('phrases that mean something else cancel the keyword inside them', () => {
    // Gas the utility is a monthly bill, not fuel.
    expect(fallbackCategory('SOUTHWEST GAS CORP', 'USD')).toBeNull();
    expect(fallbackCategory('PEOPLES GAS BILL', 'USD')).toBeNull();
    expect(fallbackCategory('gas 40', 'USD')).toBe('Transport');
    expect(fallbackCategory('METRO BANK PLC', 'GBP')).toBeNull();
    expect(fallbackCategory('metro ticket', 'GBP')).toBe('Transport');
    // A hospital is not the cable company; net pay is not the Netto grocer;
    // "good value" is not Wumart.
    expect(fallbackCategory('SPECTRUM HEALTH', 'USD')).toBeNull();
    expect(fallbackCategory('SPECTRUM CABLE', 'USD')).toBe('Subscriptions');
    expect(fallbackCategory('GEHALT NETTO', 'EUR')).toBeNull();
    expect(fallbackCategory('NETTO MARKEN-DISCOUNT', 'EUR')).toBe('Food');
    expect(fallbackCategory('物美价廉', 'CNY')).toBeNull();
    expect(fallbackCategory('物美超市', 'CNY')).toBe('Food');
  });

  test('a brand that shares its name with a keyword is told apart by the longer name', () => {
    // The cash-and-carry wholesaler, not the underground; a Canadian "gas
    // bar" is a filling station, not a bar.
    expect(fallbackCategory('METRO CASH & CARRY', 'EUR')).toBe('Food');
    expect(fallbackCategory('METRO', 'EUR')).toBe('Transport');
    expect(fallbackCategory('PETRO-CANADA GAS BAR', 'CAD')).toBe('Transport');
    expect(fallbackCategory('CANADIAN TIRE GAS BAR', 'CAD')).toBe('Transport');
    // A card-terminal prefix is not a martial-arts club.
    expect(fallbackCategory('DOJO*CAFE NERO', 'GBP')).toBe('Food');
  });

  test('regional subscription words also lose to what was bought', () => {
    expect(fallbackCategory('abbonamento palestra', 'EUR')).toBe('Gym');
    expect(fallbackCategory('BAHNCARD ABO', 'EUR')).toBe('Transport');
    expect(fallbackCategory('SPOTIFY ABO', 'EUR')).toBe('Subscriptions');
    expect(fallbackCategory('ABO', 'EUR')).toBe('Subscriptions');
    expect(fallbackCategory('suscripción', 'EUR')).toBe('Subscriptions');
  });

  test('German words are recognised with their umlauts written out', () => {
    for (const d of ['Bäckerei Schmidt', 'BAECKEREI SCHMIDT', 'Gaststätte Zur Post', 'GASTSTAETTE ZUR POST']) {
      expect(fallbackCategory(d, 'EUR')).toBe('Food');
    }
    expect(fallbackCategory('Möbel Kraft', 'EUR')).toBe('Shopping');
    expect(fallbackCategory('MOEBEL KRAFT', 'EUR')).toBe('Shopping');
  });

  test('descriptions are normalised the way statements write them', () => {
    expect(normaliseForMatching("McDonald's")).toBe('mcdonald s');
    expect(normaliseForMatching('H&M')).toBe('h and m');
    expect(normaliseForMatching('Disney+')).toBe('disney plus');
    expect(normaliseForMatching('ＮＥＴＦＬＩＸ')).toBe('netflix');
    expect(normaliseForMatching('CARREFOUR123')).toBe('carrefour 123');
    expect(normaliseForMatching('芒果TV会员')).toBe('芒果 tv 会员');
    expectAll('EUR', [
      ["McDonald's", 'Food'],
      ['H&M Lyon', 'Shopping'],
      ['DISNEY+', 'Subscriptions'],
      ['ＮＥＴＦＬＩＸ', 'Subscriptions'],
      ['CARREFOUR123', 'Food'],
      ['AMZN Mktp FR', 'Shopping'],
    ]);
  });

  test('the currency code is read loosely, and an unknown one selects no region', () => {
    expect(regionForCurrency('eur')).toBe('eu');
    expect(regionForCurrency(' GBP ')).toBe('uk');
    expect(regionForCurrency('CAD')).toBe('us');
    expect(regionForCurrency('CNH')).toBe('cn');
    expect(regionForCurrency('JPY')).toBeNull();
    expect(regionForCurrency(undefined)).toBeNull();
    expect(fallbackCategory('SNCF', 'eur')).toBe('Transport');
    expect(fallbackCategory('SNCF', 'JPY')).toBeNull();
  });

  test('the table names only built-in categories, and no keyword names two', () => {
    const builtIn = new Set(DEFAULT_CATEGORIES.map((c) => c.name));
    const byKeyword = new Map<string, Set<string>>();
    for (const { keyword, category } of fallbackKeywords('*')) {
      expect(keyword).toBe(normaliseForMatching(keyword));
      if (category !== null) expect(builtIn.has(category)).toBe(true);
      const seen = byKeyword.get(keyword) ?? new Set<string>();
      seen.add(String(category));
      byKeyword.set(keyword, seen);
    }
    const collisions = [...byKeyword].filter(([, cats]) => cats.size > 1).map(([k]) => k);
    expect(collisions).toEqual([]);
  });

  test('short Latin keywords exist only where they are unambiguous', () => {
    // Three letters or fewer is where false positives live. The always-on
    // table may hold only these; anything else short belongs to a region.
    const short = fallbackKeywords(null)
      .filter(({ keyword }) => /^[a-z0-9 ]+$/.test(keyword) && keyword.replace(/ /g, '').length <= 3)
      .map(({ keyword }) => keyword)
      .sort();
    expect(short).toEqual(['aws', 'bar', 'bbq', 'bp', 'bus', 'gym', 'hbo', 'kfc', 'klm']);
  });

  test('mentionsAny follows the same whole-word rules', () => {
    expect(mentionsAny('FLASH SALE', ['sale'])).toBe(true);
    expect(mentionsAny('WHOLESALE CLUB', ['sale'])).toBe(false);
    expect(mentionsAny('美团外卖订单', ['外卖'])).toBe(true);
    expect(mentionsAny('خدمة التوصيل', ['توصيل'])).toBe(true);
    expect(mentionsAny('', ['sale'])).toBe(false);
    // A longer phrase that only contains the word cancels it.
    const notSale = ['point of sale'];
    expect(mentionsAny('POINT OF SALE PURCHASE', ['sale'], notSale)).toBe(false);
    expect(mentionsAny('POINT OF SALE - FLASH SALE', ['sale'], notSale)).toBe(true);
  });
});
