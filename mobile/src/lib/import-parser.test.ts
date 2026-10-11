import { describe, test, expect } from 'bun:test';
import {
  parseCSV,
  parseStatement,
  parseAmount,
  parseDate,
  detectCsvFormat,
  detectDecimalConvention,
  detectDateConvention,
  detectSignConvention,
  inspectCsv,
  missingColumns,
  emptyMapping,
} from './import-parser';
import { buildMerchantMemory } from './merchant-memory';

// ── Amount conventions ───────────────────────────────────────────────────────

test('European amounts keep their full value', () => {
  // Previously produced 1.234 — a €1,234.56 charge imported as €1.23.
  expect(parseAmount('1.234,56', 'european')).toBe(1234.56);
  expect(parseAmount('1 234,56', 'european')).toBe(1234.56);
  expect(parseAmount('12,50', 'european')).toBe(12.5);
  expect(parseAmount('1.234.567,89', 'european')).toBe(1234567.89);
});

test('US amounts keep their full value', () => {
  expect(parseAmount('1,234.56', 'us')).toBe(1234.56);
  expect(parseAmount('12.50', 'us')).toBe(12.5);
  expect(parseAmount('1,234,567.89', 'us')).toBe(1234567.89);
});

test('negatives are recognised in every notation', () => {
  expect(parseAmount('-45.00', 'us')).toBe(-45);
  expect(parseAmount('(45.00)', 'us')).toBe(-45);
  expect(parseAmount('45,00-', 'european')).toBe(-45);
});

test('currency symbols and non-breaking spaces are stripped', () => {
  expect(parseAmount('€ 1.234,56', 'european')).toBe(1234.56);
  expect(parseAmount('1 234,56 MAD', 'european')).toBe(1234.56);
  expect(parseAmount('$1,234.56', 'us')).toBe(1234.56);
  expect(parseAmount('￥100.00', 'us')).toBe(100);
});

test('the decimal convention is detected from the file', () => {
  expect(detectDecimalConvention(['1.234,56', '99,00']).convention).toBe('european');
  expect(detectDecimalConvention(['1,234.56', '99.00']).convention).toBe('us');
  // Repeated separator can only be grouping thousands.
  expect(detectDecimalConvention(['1.234.567']).convention).toBe('european');
});

// ── Date conventions ─────────────────────────────────────────────────────────

test('day-first dates are read day-first', () => {
  // 1 September on a French statement, not 9 January.
  expect(parseDate('01/09/2026', 'dmy')).toBe('2026-09-01');
  expect(parseDate('15/03/2026', 'dmy')).toBe('2026-03-15');
});

test('month-first dates are read month-first', () => {
  expect(parseDate('01/09/2026', 'mdy')).toBe('2026-01-09');
});

test('a component above 12 overrides the stated convention', () => {
  // 15 cannot be a month, whatever the file claims.
  expect(parseDate('15/03/2026', 'mdy')).toBe('2026-03-15');
});

test('impossible dates are rejected rather than emitted', () => {
  // Previously "15/03/2026" under the US branch produced "2026-15-03",
  // an impossible month written straight to the database.
  expect(parseDate('31/02/2026', 'dmy')).toBeNull();
  expect(parseDate('99/99/2026', 'dmy')).toBeNull();
});

test('ISO dates parse regardless of convention', () => {
  expect(parseDate('2026-03-15', 'mdy')).toBe('2026-03-15');
  expect(parseDate('2026-03-15 14:32:01', 'dmy')).toBe('2026-03-15');
});

test('the date convention is detected from the file', () => {
  expect(detectDateConvention(['15/03/2026', '01/09/2026']).convention).toBe('dmy');
  expect(detectDateConvention(['03/15/2026', '09/01/2026']).convention).toBe('mdy');
  // Every day 12 or lower — genuinely undecidable, so the fallback applies.
  const ambiguous = detectDateConvention(['01/09/2026', '02/10/2026'], 'dmy');
  expect(ambiguous.convention).toBe('dmy');
  expect(ambiguous.ambiguous).toBe(true);
});

// ── Sign conventions ─────────────────────────────────────────────────────────

test('an all-positive single amount column is treated as expenses', () => {
  // The old code labelled every one of these Income.
  expect(detectSignConvention([10, 20, 30]).convention).toBe('all-expense');
  expect(detectSignConvention([10, -20, 30]).convention).toBe('signed');
});

// ── Whole-file fixtures ──────────────────────────────────────────────────────

const US_BANK = `Date,Description,Amount
03/15/2026,WHOLE FOODS MARKET,-84.32
03/16/2026,PAYROLL DEPOSIT,2450.00
03/17/2026,SHELL GAS STATION,-52.10`;

test('a US bank export parses dates month-first and signs correctly', () => {
  const rows = parseCSV(US_BANK);

  expect(rows.length).toBe(3);
  expect(rows[0]!.date).toBe('2026-03-15');
  expect(rows[0]!.amount).toBe(84.32);
  expect(rows[0]!.type).toBe('Expense');
  expect(rows[1]!.type).toBe('Income');
  expect(rows[1]!.amount).toBe(2450);
});

const FRENCH_BANK = `Date,Libellé,Débit,Crédit
15/03/2026,CARREFOUR MARKET,"1.234,56",
16/03/2026,VIREMENT SALAIRE,,"2.500,00"
01/09/2026,SNCF BILLET,"89,90",`;

test('a French bank export parses day-first with European decimals', () => {
  const rows = parseCSV(FRENCH_BANK);

  expect(rows.length).toBe(3);
  expect(rows[0]!.date).toBe('2026-03-15');
  expect(rows[0]!.amount).toBe(1234.56);
  expect(rows[0]!.type).toBe('Expense');

  expect(rows[1]!.amount).toBe(2500);
  expect(rows[1]!.type).toBe('Income');

  // 1 September, not 9 January.
  expect(rows[2]!.date).toBe('2026-09-01');
  expect(rows[2]!.amount).toBe(89.9);
});

const MOROCCAN_BANK = `Date operation,Libellé,Montant
05/01/2026,MARJANE CASABLANCA,"-1.250,00"
12/01/2026,RETRAIT GAB,"-500,00"
28/01/2026,VIREMENT RECU,"8.000,00"`;

test('a Moroccan export parses day-first with European decimals', () => {
  // No override: the 28th in the third row proves the ordering on its own.
  expect(detectCsvFormat(MOROCCAN_BANK)).toMatchObject({ decimal: 'european', date: 'dmy' });
  const rows = parseCSV(MOROCCAN_BANK);

  expect(rows.length).toBe(3);
  expect(rows[0]!.date).toBe('2026-01-05');
  expect(rows[0]!.amount).toBe(1250);
  expect(rows[0]!.type).toBe('Expense');

  expect(rows[2]!.date).toBe('2026-01-28');
  expect(rows[2]!.amount).toBe(8000);
  expect(rows[2]!.type).toBe('Income');
});

const UNSIGNED_DEBITS = `Date,Description,Amount
03/15/2026,TESCO STORES,84.32
03/16/2026,COSTA COFFEE,4.20`;

test('an unsigned single-column statement imports as expenses, not income', () => {
  const rows = parseCSV(UNSIGNED_DEBITS);

  expect(rows.every((r) => r.type === 'Expense')).toBe(true);
  expect(detectCsvFormat(UNSIGNED_DEBITS).signAmbiguous).toBe(true);
});

test('a sign override flips direction for the whole file', () => {
  const rows = parseCSV(UNSIGNED_DEBITS, { sign: 'all-income' });
  expect(rows.every((r) => r.type === 'Income')).toBe(true);
});

const DEBIT_ONLY = `Date,Description,Debit
03/15/2026,RENT PAYMENT,1200.00`;

test('a debit column with no credit column is all outflow', () => {
  // amountIdx collides with debitIdx here, which used to route positive
  // debits through the single-column path and label them Income.
  const rows = parseCSV(DEBIT_ONLY);
  expect(rows[0]!.type).toBe('Expense');
  expect(rows[0]!.amount).toBe(1200);
});

const ALIPAY = `支付宝交易记录明细查询
账号:test@example.com
起始日期:[2026-03-01 00:00:00]    终止日期:[2026-03-31 00:00:00]
交易号,商家订单号,交易创建时间,付款时间,最近修改时间,交易来源地,类型,交易对方,商品名称,金额（元）,收/支,交易状态,服务费（元）,成功退款（元）,备注,资金状态
2026030122001,T200P,2026-03-01 09:12:33,2026-03-01 09:12:35,2026-03-01 09:12:35,支付宝网站,即时到账,盒马鲜生,蔬菜水果,86.50,支出,交易成功,0.00,0.00,,已支出
2026030222002,T200Q,2026-03-02 18:44:10,2026-03-02 18:44:12,2026-03-02 18:44:12,支付宝网站,即时到账,滴滴出行,快车,23.00,支出,交易成功,0.00,0.00,,已支出
2026030322003,T200R,2026-03-03 10:00:00,2026-03-03 10:00:02,2026-03-03 10:00:02,支付宝网站,即时到账,公司,工资,5000.00,收入,交易成功,0.00,0.00,,已收入`;

test('an Alipay export parses amounts, dates and direction', () => {
  const rows = parseStatement(ALIPAY, 'alipay');

  expect(rows.length).toBe(3);
  expect(rows[0]!.date).toBe('2026-03-01');
  expect(rows[0]!.amount).toBe(86.5);
  expect(rows[0]!.type).toBe('Expense');
  expect(rows[2]!.type).toBe('Income');
  expect(rows[2]!.amount).toBe(5000);
});

const WECHAT = `微信支付账单明细
微信昵称:[test]
起始时间:[2026-03-01 00:00:00] 终止时间:[2026-03-31 23:59:59]
----------------------微信支付账单明细列表--------------------
交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号,商户单号,备注
2026-03-05 08:15:00,商户消费,瑞幸咖啡,生椰拿铁,支出,¥19.90,零钱,支付成功,42000,DD001,
2026-03-06 12:30:00,转账,朋友,转账,收入,¥200.00,零钱,已收钱,42001,DD002,
2026-03-07 19:05:00,商户消费,美团,外卖订单,支出,¥45.60,零钱,支付成功,42002,DD003,`;

test('a WeChat export parses amounts, dates and direction', () => {
  const rows = parseStatement(WECHAT, 'wechat');

  expect(rows.length).toBe(3);
  expect(rows[0]!.date).toBe('2026-03-05');
  expect(rows[0]!.amount).toBe(19.9);
  expect(rows[0]!.type).toBe('Expense');
  expect(rows[1]!.type).toBe('Income');
  expect(rows[1]!.amount).toBe(200);
  expect(rows[2]!.amount).toBe(45.6);
});

test('detectCsvFormat reports what it found for each fixture', () => {
  expect(detectCsvFormat(FRENCH_BANK)).toMatchObject({ decimal: 'european', date: 'dmy' });
  expect(detectCsvFormat(US_BANK)).toMatchObject({ decimal: 'us', date: 'mdy' });
});

// ── Manual column mapping — no file is a dead end ────────────────────────────

const UNRECOGNISABLE = `Buchungstag,Verwendungszweck,Betrag EUR
15.03.2026,REWE MARKT,"-84,32"
16.03.2026,GEHALT,"2.450,00"`;

test('an unrecognisable header is reported, not thrown', () => {
  // Previously this threw, which made the file a dead end with no way forward.
  const found = inspectCsv(UNRECOGNISABLE);

  expect(found.missing).toContain('date');
  expect(found.headers).toEqual(['Buchungstag', 'Verwendungszweck', 'Betrag EUR']);
});

test('inspection returns sample rows so the user can see the columns', () => {
  const found = inspectCsv(UNRECOGNISABLE);

  expect(found.sampleRows.length).toBe(2);
  expect(found.sampleRows[0]).toEqual(['15.03.2026', 'REWE MARKT', '-84,32']);
});

test('parsing an unmappable file returns nothing rather than throwing', () => {
  expect(() => parseCSV(UNRECOGNISABLE)).not.toThrow();
  expect(parseCSV(UNRECOGNISABLE)).toEqual([]);
});

test('a user-supplied mapping rescues the file', () => {
  const rows = parseCSV(
    UNRECOGNISABLE,
    { decimal: 'european', date: 'dmy' },
    { dateIdx: 0, descIdx: 1, amountIdx: 2 }
  );

  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({
    date: '2026-03-15',
    description: 'REWE MARKT',
    amount: 84.32,
    type: 'Expense',
  });
  expect(rows[1]).toMatchObject({ date: '2026-03-16', amount: 2450, type: 'Income' });
});

test('a mapping only needs to fill what detection missed', () => {
  // Description was found; only the date column needs pointing at.
  const partial = `Buchungstag,Description,Amount
15.03.2026,REWE MARKT,-84.32`;

  expect(inspectCsv(partial).missing).toEqual(['date']);
  expect(parseCSV(partial, { date: 'dmy' }, { dateIdx: 0 })).toHaveLength(1);
});

test('a recognisable file needs no mapping at all', () => {
  const found = inspectCsv(US_BANK);
  expect(found.missing).toEqual([]);
  expect(found.mapping.dateIdx).toBe(0);
  expect(found.mapping.amountIdx).toBe(2);
});

test('missingColumns reports both when nothing is found', () => {
  expect(missingColumns(emptyMapping())).toEqual(['date', 'amount']);
});

test('a credit-only column counts as an amount', () => {
  const creditOnly = `Date,Description,Credit
03/15/2026,REFUND,25.00`;

  expect(inspectCsv(creditOnly).missing).toEqual([]);
  const [row] = parseCSV(creditOnly);
  expect(row).toMatchObject({ amount: 25, type: 'Income' });
});

test('an empty file is reported as missing everything, not crashed on', () => {
  const found = inspectCsv('');
  expect(found.missing).toEqual(['date', 'amount']);
  expect(found.headers).toEqual([]);
});

// ── The user's own history beats the keyword fallback ────────────────────────

test('an import uses what the user categorised before', () => {
  // Marjane is a Moroccan grocer, and without the user's currency the keyword
  // fallback has no reason to know it. Once the user has filed one Marjane row
  // under Food, the next import should know.
  const memory = buildMerchantMemory([
    { note: 'MARJANE CASABLANCA', category: 'Food', dateISO: '2026-08-01' },
  ]);
  const csv = [
    'Date,Description,Amount',
    '2026-08-20,MARJANE RABAT 4412,-240.50',
  ].join('\n');

  const withoutMemory = parseCSV(csv);
  const withMemory = parseCSV(csv, {}, undefined, { memory });

  expect(withoutMemory[0]!.suggestedCategory).toBe('Other');
  expect(withMemory[0]!.suggestedCategory).toBe('Food');
});

test('a category declared in the file still wins over the memory', () => {
  // An explicit column is the user telling us directly; the memory is only an
  // inference from past behaviour.
  const memory = buildMerchantMemory([
    { note: 'MARJANE', category: 'Food', dateISO: '2026-08-01' },
  ]);
  const csv = [
    'Date,Description,Amount,Category',
    '2026-08-20,MARJANE RABAT,-240.50,Shopping',
  ].join('\n');
  expect(parseCSV(csv, {}, undefined, { memory })[0]!.suggestedCategory).toBe('Shopping');
});

test('the memory beats the keyword fallback even where the fallback knows the merchant', () => {
  // Someone who files Carrefour under Shopping (they buy their electronics
  // there) keeps getting Shopping, not the table's Food.
  const memory = buildMerchantMemory([
    { note: 'CARREFOUR', category: 'Shopping', dateISO: '2026-08-01' },
  ]);
  const csv = ['Date,Description,Amount', '2026-08-20,CARREFOUR LYON,-89.00'].join('\n');
  expect(parseCSV(csv, {}, undefined, { currency: 'EUR' })[0]!.suggestedCategory).toBe('Food');
  expect(parseCSV(csv, {}, undefined, { memory, currency: 'EUR' })[0]!.suggestedCategory).toBe(
    'Shopping',
  );
});

test('without a memory the parser behaves exactly as before', () => {
  const csv = ['Date,Description,Amount', '2026-08-20,STARBUCKS,-4.50'].join('\n');
  expect(parseCSV(csv)[0]!.suggestedCategory).toBe('Food');
});

// ── The keyword fallback, through the importer ───────────────────────────────

describe('categorises by region', () => {
  const FRENCH_CARD_STATEMENT = `Date,Libellé,Débit,Crédit
02/09/2026,PAIEMENT CB CARREFOUR MARKET LYON,"84,30",
03/09/2026,PAIEMENT CB SNCF CONNECT,"45,00",
04/09/2026,PAIEMENT CB BOULANGERIE PAUL,"6,40",
05/09/2026,PRLV SEPA BASIC FIT,"29,99",
06/09/2026,PAIEMENT CB LEROY MERLIN,"112,00",
07/09/2026,PRLV SEPA FREE MOBILE,"19,99",
08/09/2026,PAIEMENT CB GASTON LAGAFFE SARL,"12,00",
30/09/2026,VIREMENT SALAIRE,,"2.500,00"`;

  test('a CSV import in euros recognises French chains and French words', () => {
    // The importer's own path: detect the format, then parse with the user's
    // currency, exactly as the import screen does.
    const format = detectCsvFormat(FRENCH_CARD_STATEMENT, 'dmy');
    const rows = parseCSV(FRENCH_CARD_STATEMENT, format, undefined, { currency: 'EUR' });
    expect(rows.map((r) => [r.description, r.suggestedCategory])).toEqual([
      ['PAIEMENT CB CARREFOUR MARKET LYON', 'Food'],
      ['PAIEMENT CB SNCF CONNECT', 'Transport'],
      ['PAIEMENT CB BOULANGERIE PAUL', 'Food'],
      ['PRLV SEPA BASIC FIT', 'Gym'],
      ['PAIEMENT CB LEROY MERLIN', 'Shopping'],
      ['PRLV SEPA FREE MOBILE', 'Subscriptions'],
      // "gas" is not inside Gaston, and nothing else here names a category.
      ['PAIEMENT CB GASTON LAGAFFE SARL', 'Other'],
      ['VIREMENT SALAIRE', 'Other'],
    ]);
    // The statement is the same through parseStatement, which the screen
    // uses when the user picks "bank".
    expect(
      parseStatement(FRENCH_CARD_STATEMENT, 'bank', format, { currency: 'EUR' }).map(
        (r) => r.suggestedCategory,
      ),
    ).toEqual(rows.map((r) => r.suggestedCategory));
  });

  test('the same CSV in dollars knows only the words and the global brands', () => {
    // The euro chains are a regional list: in dollars SNCF, Basic-Fit, Leroy
    // Merlin and Free are unknown, while Carrefour (global) and the French
    // word "boulangerie" still work.
    const rows = parseCSV(FRENCH_CARD_STATEMENT, { date: 'dmy', decimal: 'european' }, undefined, {
      currency: 'USD',
    });
    expect(rows.map((r) => r.suggestedCategory)).toEqual([
      'Food', 'Other', 'Food', 'Other', 'Other', 'Other', 'Other', 'Other',
    ]);
  });

  test('a Moroccan statement in dirhams', () => {
    // "Date operation" is the date; the description is "Libellé". Taking the
    // first header that mentions "operation" filed every row under its date.
    expect(inspectCsv(MOROCCAN_BANK).mapping).toMatchObject({ dateIdx: 0, descIdx: 1 });
    expect(inspectCsv('Date,Opération,Montant\n05/01/2026,MARJANE,-1').mapping.descIdx).toBe(1);
    const rows = parseStatement(MOROCCAN_BANK, 'bank', {}, { currency: 'MAD' });
    expect(rows.map((r) => [r.description, r.suggestedCategory])).toEqual([
      ['MARJANE CASABLANCA', 'Food'],
      ['RETRAIT GAB', 'Other'],
      ['VIREMENT RECU', 'Other'],
    ]);
  });

  test('a row that names its own currency is categorised in that currency', () => {
    // A multi-currency export: the user's settings say euros, but the second
    // row was spent in Morocco and says so.
    const csv = [
      'Date,Description,Amount,Currency',
      '2026-08-20,TESCO EXPRESS,-12.40,GBP',
      '2026-08-21,MARJANE AGADIR,-310.00,MAD',
      '2026-08-22,SNCF,-45.00,EUR',
      '2026-08-23,SNCF,-45.00,€',
    ].join('\n');
    const rows = parseCSV(csv, {}, undefined, { currency: 'EUR' });
    expect(rows.map((r) => r.suggestedCategory)).toEqual([
      'Food', 'Food', 'Transport',
      // A symbol is not a code; the user's own currency applies.
      'Transport',
    ]);
  });

  test('an Alipay bill is categorised from its Chinese descriptions', () => {
    // The counterparty (交易对方) is what the parser reads: 盒马鲜生 is Freshippo,
    // a supermarket; 滴滴出行 is DiDi.
    for (const currency of ['CNY', 'MAD', 'EUR', null]) {
      const rows = parseStatement(ALIPAY, 'alipay', {}, { currency });
      expect(rows.map((r) => [r.description, r.suggestedCategory])).toEqual([
        ['盒马鲜生', 'Food'],
        ['滴滴出行', 'Transport'],
        ['公司', 'Other'],
      ]);
    }
  });

  test('a WeChat bill is categorised from its Chinese descriptions', () => {
    const rows = parseStatement(WECHAT, 'wechat', {}, { currency: 'CNY' });
    expect(rows.map((r) => [r.description, r.suggestedCategory])).toEqual([
      ['瑞幸咖啡', 'Food'],
      ['朋友', 'Other'],
      ['美团', 'Food'],
    ]);
  });

  test('a Chinese bill weighs a large purchase in yuan, whatever the user uses', () => {
    // ¥500 is about $70: a big 淘宝 order in yuan is not an impulse buy, and
    // reading "500" as dollars (or as dirhams) would get that wrong both ways.
    const bill = (amount: string) => `交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号,商户单号,备注
2026-03-05 08:15:00,商户消费,淘宝,衣服,支出,¥${amount},零钱,支付成功,42000,DD001,`;
    for (const currency of ['CNY', 'USD', 'MAD']) {
      expect(parseStatement(bill('500.00'), 'wechat', {}, { currency })[0]!.isImpulse).toBe(false);
      expect(parseStatement(bill('1500.00'), 'wechat', {}, { currency })[0]!.isImpulse).toBe(true);
    }
  });

  test('the impulse guess reads sales and delivery in every language, as whole words', () => {
    const csv = [
      'Date,Description,Amount',
      '2026-08-20,FLASH SALE SHOES,-20.00',
      '2026-08-21,WHOLESALE CLUB,-20.00',
      '2026-08-22,DELIVEROO,-20.00',
      '2026-08-23,SOLDES ZARA,-20.00',
      '2026-08-24,美团外卖,-20.00',
      '2026-08-25,توصيل البيتزا,-20.00',
      // How the card was used, not what was bought.
      '2026-08-26,POINT OF SALE PURCHASE WALGREENS,-20.00',
    ].join('\n');
    expect(parseCSV(csv, {}, undefined, { currency: 'EUR' }).map((r) => r.isImpulse)).toEqual([
      true, false, true, true, true, true, false,
    ]);
  });
});
