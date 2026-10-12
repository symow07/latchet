import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseCSV,
  parseStatement,
  parseAmount,
  parseDate,
  detectCsvFormat,
  detectDelimiter,
  detectDecimalConvention,
  detectDateConvention,
  detectSignConvention,
  inspectCsv,
  missingColumns,
  emptyMapping,
  generateImportPreview,
  importHistory,
  preferHistory,
  type CsvFormat,
  type ExistingTransaction,
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

// ── Import history: the import screen gives every parse the user's own past ──
//
// The parser has taken a merchant memory since Phase 3, and Siri, quick-add
// and shared receipts all passed one; the import screen passed only the
// currency, so a CSV import ignored every choice the user had made. These go
// through importHistory — what the screen now builds from the transactions it
// already reads for duplicates — and then the real parser.

/** A transaction already in the app. */
const had = (note: string, category: string, dateISO = '2026-08-01', amount = 10): ExistingTransaction => ({
  note,
  category,
  dateISO,
  amount,
});

test("import history: a CSV row goes where the user filed that merchant, not where the keyword table would", () => {
  // Carrefour is Food to the table; this user buys their electronics there.
  const history = importHistory(
    [had('CARREFOUR CITY', 'Shopping'), had('Carrefour Lyon', 'Shopping', '2026-08-09')],
    'EUR',
  );
  const csv = ['Date,Description,Amount', '2026-09-03,CARREFOUR MARKET 4412,-89.00', '2026-09-04,STARBUCKS,-4.50'].join('\n');

  expect(parseCSV(csv, {}, undefined, { currency: 'EUR' }).map((r) => r.suggestedCategory)).toEqual(['Food', 'Food']);
  // Only the merchant they have filed moves; the rest still gets the table.
  expect(parseCSV(csv, {}, undefined, history.context).map((r) => r.suggestedCategory)).toEqual(['Shopping', 'Food']);
});

test('import history: a merchant no table knows, and a category the user made up, are learned', () => {
  const history = importHistory([had('Boulangerie Paul Gare', 'Bakery'), had('ATELIER MOULIN', 'Hobbies')], 'MAD');
  const csv = [
    'Date,Libellé,Montant',
    '03/09/2026,PAIEMENT CB BOULANGERIE PAUL,"-12,40"',
    '04/09/2026,ATELIER MOULIN RABAT,"-300,00"',
    '05/09/2026,QUINCAILLERIE NOUR,"-45,00"',
  ].join('\n');
  expect(parseStatement(csv, 'bank', {}, history.context).map((r) => r.suggestedCategory)).toEqual([
    'Bakery',
    'Hobbies',
    // A hardware shop they have never filed: the table's answer.
    'Shopping',
  ]);
});

test('import history: Alipay and WeChat bills learn from it too', () => {
  // 盒马鲜生 is a supermarket to the table; this user files it as Groceries.
  const history = importHistory([had('盒马鲜生', 'Groceries'), had('瑞幸咖啡', 'Coffee')], 'CNY');
  expect(parseStatement(ALIPAY, 'alipay', {}, history.context).map((r) => r.suggestedCategory)).toEqual([
    'Groceries',
    'Transport',
    'Other',
  ]);
  expect(parseStatement(WECHAT, 'wechat', {}, history.context)[0]!.suggestedCategory).toBe('Coffee');
});

test('import history: an undecided history, or one left on Other, leaves the keyword table its say', () => {
  const history = importHistory(
    [
      ...Array.from({ length: 6 }, (_, i) => had('Carrefour', 'Food', `2026-08-0${i + 1}`)),
      ...Array.from({ length: 5 }, (_, i) => had('Carrefour', 'Shopping', `2026-07-0${i + 1}`)),
      // "Other" is usually no decision at all, so it teaches nothing.
      had('STARBUCKS', 'Other'),
    ],
    'EUR',
  );
  const csv = ['Date,Description,Amount', '2026-09-03,CARREFOUR,-30.00', '2026-09-04,STARBUCKS,-4.50'].join('\n');
  expect(parseCSV(csv, {}, undefined, history.context).map((r) => r.suggestedCategory)).toEqual(['Food', 'Food']);
});

test('import history: a category the file states still wins over the history', () => {
  const history = importHistory([had('CARREFOUR', 'Shopping')], 'EUR');
  const csv = ['Date,Description,Amount,Category', '2026-09-03,CARREFOUR,-30.00,Gym'].join('\n');
  expect(parseCSV(csv, {}, undefined, history.context)[0]!.suggestedCategory).toBe('Gym');
});

test("import history: a PDF row the model guessed goes where the user filed it", () => {
  const history = importHistory([had('MARJANE CASABLANCA', 'Groceries')], 'MAD');
  expect(preferHistory('MARJANE RABAT 0042', 'Shopping', history.context)).toBe('Groceries');
  expect(preferHistory('AFRIQUIA STATION', 'Transport', history.context)).toBe('Transport');
});

test('import history: the rows already in the app are skipped as duplicates', () => {
  const history = importHistory([had('CARREFOUR MARKET 4412', 'Shopping', '2026-09-03', 89)], 'EUR');
  const csv = ['Date,Description,Amount', '2026-09-03,CARREFOUR MARKET 4412,-89.00', '2026-09-04,CARREFOUR,-12.00'].join('\n');
  const preview = generateImportPreview(parseCSV(csv, {}, undefined, history.context), history.existingKeys);
  expect(preview.duplicatesFound).toBe(1);
  expect(preview.transactions.map((r) => [r.description, r.suggestedCategory])).toEqual([['CARREFOUR', 'Shopping']]);
});

test('import history: every parse on the import screen is given it', () => {
  // The screen cannot render under bun test, so its source is read. Every
  // parse — the first, the remembered bank, the hand mapping, and each
  // re-parse after a corrected convention — must be handed the history's
  // context; a bare { currency } is exactly the Phase 4 gap.
  const screen = readFileSync(join(import.meta.dir, '..', 'app', 'import.tsx'), 'utf8');
  const parses: string[] = [];
  for (const m of screen.matchAll(/\b(?:parseCSV|parseStatement)\(/g)) {
    let depth = 1;
    let j = m.index! + m[0].length;
    for (; depth > 0 && j < screen.length; j++) {
      if (screen[j] === '(') depth++;
      else if (screen[j] === ')') depth--;
    }
    parses.push(screen.slice(m.index!, j));
  }
  expect(parses.length).toBeGreaterThanOrEqual(6);
  // The last argument of each is the history's context.
  expect(parses.filter((call) => !/\.context\s*,?\s*\)$/.test(call))).toEqual([]);
  // Built from the user's own transactions, and used for the PDF path too.
  expect(screen).toMatch(/importHistory\(await getTransactions\(\)/);
  expect(screen).toMatch(/preferHistory\(r\.note, r\.category, known\.context\)/);
});

// ── Any delimiter: semicolon, tab and pipe exports ───────────────────────────
//
// French and Moroccan banks separate fields with semicolons (the comma is
// their decimal point), some exports use tabs, and many put an account summary
// above the table. Every one of these used to import as nothing, or as
// garbage, because the parser split on commas only and took the first line as
// the header.

describe('csv delimiter', () => {
  /** What a reviewer checks first: when, what, how much, which way. */
  const brief = (rows: { date: string; description: string; amount: number; type: string }[]) =>
    rows.map((r) => [r.date, r.description, r.amount, r.type]);

  test('csv delimiter: a semicolon export with Débit and Crédit columns (CIC style)', () => {
    // Debits written negative in the Débit column, a value date beside the
    // operation date, the description after the amounts, and a running balance.
    const CIC = [
      "Date d'opération;Date de valeur;Débit;Crédit;Libellé;Solde",
      '01/10/2026;01/10/2026;;2850,00;VIR SEPA SALAIRE ACME SAS;4120,35',
      '02/10/2026;02/10/2026;-19,99;;PRLV SEPA FREE MOBILE;4100,36',
      '03/10/2026;04/10/2026;-13,49;;CB NETFLIX.COM 02/10;4086,87',
      '05/10/2026;06/10/2026;-1234,56;;CB AMAZON PAYMENTS 04/10;2852,31',
    ].join('\r\n');

    expect(detectDelimiter(CIC)).toBe(';');
    // Every day is 12 or lower, so the dates alone cannot say; a semicolon
    // export with decimal commas is day-first, whatever the fallback.
    expect(detectCsvFormat(CIC)).toMatchObject({
      delimiter: ';',
      decimal: 'european',
      date: 'dmy',
      dateAmbiguous: true,
      sign: 'signed',
    });
    expect(inspectCsv(CIC).mapping).toMatchObject({ dateIdx: 0, debitIdx: 2, creditIdx: 3, descIdx: 4 });

    const rows = parseStatement(CIC, 'bank', {}, { currency: 'EUR' });
    // The operation date, not the value date; the balance is never an amount.
    expect(brief(rows)).toEqual([
      ['2026-10-01', 'VIR SEPA SALAIRE ACME SAS', 2850, 'Income'],
      ['2026-10-02', 'PRLV SEPA FREE MOBILE', 19.99, 'Expense'],
      ['2026-10-03', 'CB NETFLIX.COM 02/10', 13.49, 'Expense'],
      ['2026-10-05', 'CB AMAZON PAYMENTS 04/10', 1234.56, 'Expense'],
    ]);
    expect(rows[2]!.suggestedCategory).toBe('Subscriptions');
  });

  test('csv delimiter: a semicolon export with one signed Montant column (Société Générale style)', () => {
    // The account line above the header, a short Libellé and a long Détail,
    // "+" on credits, and thousands grouped with a space or a no-break space.
    const SG = [
      '="00012345678";COMPTE COURANT;',
      "Date de l'opération;Libellé;Détail de l'écriture;Montant de l'opération;Devise",
      '12/10/2026;PRLV SEPA FREE MOBILE;PRLV SEPA FREE MOBILE ECH/121026 ID EMETTEUR/FR84ZZZ412345 MDT/FM100234;-19,99;EUR',
      '09/10/2026;CARTE X1234 08/10 NETFLIX.COM;CARTE X1234 08/10 NETFLIX.COM 866-579-7172;-13,49;EUR',
      '01/10/2026;VIR RECU 1234567;VIR RECU 1234567 DE: ACME SAS MOTIF: SALAIRE OCTOBRE;+2 850,00;EUR',
      '28/09/2026;CARTE X1234 27/09 AMAZON PAYMENTS;CARTE X1234 27/09 AMAZON PAYMENTS LUXEMBOURG;-1\u00a0234,56;EUR',
    ].join('\r\n');

    expect(detectCsvFormat(SG)).toMatchObject({
      delimiter: ';',
      decimal: 'european',
      date: 'dmy',
      dateAmbiguous: false,
      sign: 'signed',
    });
    const found = inspectCsv(SG);
    expect(found.headers[0]).toBe("Date de l'opération");
    expect(found.mapping).toMatchObject({ dateIdx: 0, descIdx: 1, amountIdx: 3, currencyIdx: 4 });

    const rows = parseStatement(SG, 'bank', {}, { currency: 'EUR' });
    expect(brief(rows)).toEqual([
      ['2026-10-12', 'PRLV SEPA FREE MOBILE', 19.99, 'Expense'],
      ['2026-10-09', 'CARTE X1234 08/10 NETFLIX.COM', 13.49, 'Expense'],
      ['2026-10-01', 'VIR RECU 1234567', 2850, 'Income'],
      ['2026-09-28', 'CARTE X1234 27/09 AMAZON PAYMENTS', 1234.56, 'Expense'],
    ]);
    expect(rows.every((r) => r.currency === 'EUR')).toBe(true);
  });

  test('csv delimiter: tab-separated exports, with decimal commas and with decimal points', () => {
    // A comma inside a description is text, not a column break.
    const FR_TAB = [
      'Date\tLibellé\tMontant\tDevise',
      '03/10/2026\tCB SPOTIFY P1A2B3, STOCKHOLM\t-10,99\tEUR',
      '18/09/2026\tVIR INST RECU REMBOURSEMENT, M. DUPONT\t45,00\tEUR',
      '02/09/2026\tCB LECLERC DRIVE, ANGERS\t-1 087,40\tEUR',
    ].join('\n');
    expect(detectCsvFormat(FR_TAB)).toMatchObject({ delimiter: '\t', decimal: 'european', date: 'dmy' });
    expect(brief(parseCSV(FR_TAB))).toEqual([
      ['2026-10-03', 'CB SPOTIFY P1A2B3, STOCKHOLM', 10.99, 'Expense'],
      ['2026-09-18', 'VIR INST RECU REMBOURSEMENT, M. DUPONT', 45, 'Income'],
      ['2026-09-02', 'CB LECLERC DRIVE, ANGERS', 1087.4, 'Expense'],
    ]);

    const US_TAB = [
      'Posted Date\tReference Number\tPayee\tAddress\tAmount',
      '09/28/2026\t24692166271\tSPOTIFY USA\tNEW YORK NY\t-11.99',
      '09/15/2026\t24692166205\tPAYROLL ACME INC\t\t2,450.00',
      '09/02/2026\t24692166113\tCOSTCO WHSE #0423\tAUSTIN TX\t-1,203.88',
    ].join('\n');
    expect(detectCsvFormat(US_TAB)).toMatchObject({ delimiter: '\t', decimal: 'us', date: 'mdy' });
    expect(brief(parseCSV(US_TAB))).toEqual([
      ['2026-09-28', 'SPOTIFY USA', 11.99, 'Expense'],
      ['2026-09-15', 'PAYROLL ACME INC', 2450, 'Income'],
      ['2026-09-02', 'COSTCO WHSE #0423', 1203.88, 'Expense'],
    ]);
  });

  test('csv delimiter: a quoted field keeps the delimiter, doubled quotes and line breaks', () => {
    const QUOTED = [
      'Date;Libellé;Débit;Crédit',
      '25/09/2026;"RETRAIT DAB 25/09; AGENCE PARIS OPERA";60,00;',
      '24/09/2026;"CB ""LE PETIT CAFE""; PARIS 9";4,50;',
      // Crédit Agricole wraps long libellés over several lines inside one field.
      '23/09/2026;"PRLV SEPA FREE MOBILE ',
      'FM100234 ',
      'ECH 23/09";19,99;',
      '22/09/2026;CB MONOPRIX;"1 234,56";',
      // An inch mark is an ordinary character, not the start of a quoted field.
      '21/09/2026;CB PIZZA 12" MARGHERITA;11,00;',
    ].join('\r\n');

    expect(detectDelimiter(QUOTED)).toBe(';');
    expect(brief(parseCSV(QUOTED))).toEqual([
      ['2026-09-25', 'RETRAIT DAB 25/09; AGENCE PARIS OPERA', 60, 'Expense'],
      ['2026-09-24', 'CB "LE PETIT CAFE"; PARIS 9', 4.5, 'Expense'],
      ['2026-09-23', 'PRLV SEPA FREE MOBILE FM100234 ECH 23/09', 19.99, 'Expense'],
      ['2026-09-22', 'CB MONOPRIX', 1234.56, 'Expense'],
      ['2026-09-21', 'CB PIZZA 12" MARGHERITA', 11, 'Expense'],
    ]);
    // The mapping preview shows the same cells the parse reads.
    expect(inspectCsv(QUOTED).sampleRows[2]).toEqual([
      '23/09/2026',
      'PRLV SEPA FREE MOBILE FM100234 ECH 23/09',
      '19,99',
      '',
    ]);

    // The comma file's own quoting is unchanged: a quoted comma is text.
    const COMMA = ['Date,Description,Amount', '2026-09-20,"AMAZON.COM, INC; SEATTLE",-42.10'].join('\n');
    expect(detectDelimiter(COMMA)).toBe(',');
    expect(brief(parseCSV(COMMA))).toEqual([['2026-09-20', 'AMAZON.COM, INC; SEATTLE', 42.1, 'Expense']]);
  });

  test('csv delimiter: the account summary above the table is skipped (Crédit Agricole style)', () => {
    const CA = [
      'Téléchargement du 12/10/2026;;;;',
      ';;;;',
      'Compte de Dépôt carte n° 00012345678;;;;',
      'Solde au 12/10/2026;2 345,67 €;;;',
      ';;;;',
      'Liste des opérations du compte entre le 01/09/2026 et le 12/10/2026;;;;',
      ';;;;',
      'Date;Libellé;Débit euros;Crédit euros;',
      '05/10/2026;"PRLV SEPA FREE MOBILE ',
      'FM100234 ";19,99;;',
      '01/10/2026;"VIR SEPA RECU ',
      'SALAIRE ACME SAS ";;2 850,00;',
      '28/09/2026;"PAIEMENT PAR CARTE ',
      'NETFLIX.COM 27/09 ";13,49;;',
    ].join('\r\n');

    const found = inspectCsv(CA, 'dmy');
    expect(found.headers).toEqual(['Date', 'Libellé', 'Débit euros', 'Crédit euros', '']);
    expect(found.missing).toEqual([]);
    expect(found.mapping).toMatchObject({ dateIdx: 0, descIdx: 1, debitIdx: 2, creditIdx: 3 });
    expect(found.sampleRows).toHaveLength(3);
    expect(found.sampleRows[0]!.slice(0, 3)).toEqual(['05/10/2026', 'PRLV SEPA FREE MOBILE FM100234', '19,99']);

    // Neither the summary's date nor its balance becomes a transaction.
    expect(brief(parseStatement(CA, 'bank', {}, { currency: 'EUR' }))).toEqual([
      ['2026-10-05', 'PRLV SEPA FREE MOBILE FM100234', 19.99, 'Expense'],
      ['2026-10-01', 'VIR SEPA RECU SALAIRE ACME SAS', 2850, 'Income'],
      ['2026-09-28', 'PAIEMENT PAR CARTE NETFLIX.COM 27/09', 13.49, 'Expense'],
    ]);

    // A header in a language the parser does not read is still found below
    // the summary, so the columns the user maps are the table's own.
    const DE = [
      'Kontonummer;DE89 3704 0044 0532 0130 00',
      'Zeitraum;01.09.2026 - 30.09.2026',
      '',
      'Buchungstag;Verwendungszweck;Betrag',
      '15.09.2026;REWE MARKT;-84,32',
      '30.09.2026;GEHALT;2.450,00',
    ].join('\n');
    const de = inspectCsv(DE);
    expect(de.headers).toEqual(['Buchungstag', 'Verwendungszweck', 'Betrag']);
    expect(de.sampleRows[0]).toEqual(['15.09.2026', 'REWE MARKT', '-84,32']);
    expect(de.missing).toEqual(['date', 'amount']);
    expect(brief(parseCSV(DE, {}, { dateIdx: 0, descIdx: 1, amountIdx: 2 }))).toEqual([
      ['2026-09-15', 'REWE MARKT', 84.32, 'Expense'],
      ['2026-09-30', 'GEHALT', 2450, 'Income'],
    ]);
  });

  test('csv delimiter: a Moroccan export in dirhams with French headers (Attijariwafa style)', () => {
    const MA = [
      'RELEVE DE COMPTE;;;;;',
      'Agence : CASABLANCA ANFA;;;;;',
      'Compte : 007 780 0001234567890123 45;;;;;',
      'Devise : MAD;;;;;',
      'Période du 01/09/2026 au 12/09/2026;;;;;',
      ';;;;;',
      'Date opération;Date valeur;Libellé;Débit;Crédit;Solde',
      '02/09/2026;02/09/2026;PAIEMENT CARTE MARJANE CALIFORNIE CASA;1 245,30;;18 754,70',
      '03/09/2026;03/09/2026;PRELEVEMENT MAROC TELECOM;199,00;;18 555,70',
      '05/09/2026;06/09/2026;ACHAT TPE AFRIQUIA SMDC;461,50;;18 094,20',
      '10/09/2026;10/09/2026;VIREMENT RECU SALAIRE OCP SA;;12 450,00;30 544,20',
      '12/09/2026;12/09/2026;PAIEMENT INTERNET NETFLIX.COM;65,00;;30 479,20',
    ].join('\r\n');

    // The import screen's own path: inspect, detect, then parse.
    const found = inspectCsv(MA, 'dmy');
    expect(found.missing).toEqual([]);
    expect(found.mapping).toMatchObject({ dateIdx: 0, descIdx: 2, amountIdx: 3, debitIdx: 3, creditIdx: 4 });
    const format = detectCsvFormat(MA, 'dmy');
    expect(format).toMatchObject({ delimiter: ';', decimal: 'european', date: 'dmy' });

    const rows = parseCSV(MA, format, undefined, { currency: 'MAD' });
    // Every day is 12 or lower: read month-first, 02/09 would be the 9th of
    // February. Nothing here is from February.
    expect(brief(rows)).toEqual([
      ['2026-09-02', 'PAIEMENT CARTE MARJANE CALIFORNIE CASA', 1245.3, 'Expense'],
      ['2026-09-03', 'PRELEVEMENT MAROC TELECOM', 199, 'Expense'],
      ['2026-09-05', 'ACHAT TPE AFRIQUIA SMDC', 461.5, 'Expense'],
      ['2026-09-10', 'VIREMENT RECU SALAIRE OCP SA', 12450, 'Income'],
      ['2026-09-12', 'PAIEMENT INTERNET NETFLIX.COM', 65, 'Expense'],
    ]);
    expect(rows.map((r) => r.suggestedCategory).slice(0, 2)).toEqual(['Food', 'Subscriptions']);
    // Even a caller that falls back to month-first gets the day first here.
    expect(parseStatement(MA, 'bank', {}, { currency: 'MAD' })[0]!.date).toBe('2026-09-02');
  });

  test('csv delimiter: Arabic headers, a Sens column, and the dirham sign', () => {
    // Spreadsheets saved in Arabic wrap cells in invisible right-to-left marks.
    const RLM = '\u200f';
    const AR = [
      `التاريخ;البيان;${RLM}المبلغ;${RLM}العملة`,
      `05/09/2026;${RLM}أداء فاتورة اتصالات المغرب;${RLM}-199,00;MAD${RLM}`,
      '20/09/2026;تحويل وارد راتب شهر شتنبر;12 450,00;MAD',
      '22/09/2026;سحب نقدي من الشباك;-1.000,00 د.م.;MAD',
    ].join('\n');
    expect(detectCsvFormat(AR)).toMatchObject({ delimiter: ';', decimal: 'european', date: 'dmy' });
    expect(inspectCsv(AR).mapping).toMatchObject({ dateIdx: 0, descIdx: 1, amountIdx: 2, currencyIdx: 3 });
    const rows = parseStatement(AR, 'bank', {}, { currency: 'MAD' });
    expect(brief(rows)).toEqual([
      ['2026-09-05', 'أداء فاتورة اتصالات المغرب', 199, 'Expense'],
      ['2026-09-20', 'تحويل وارد راتب شهر شتنبر', 12450, 'Income'],
      ['2026-09-22', 'سحب نقدي من الشباك', 1000, 'Expense'],
    ]);
    expect(rows[0]!.suggestedCategory).toBe('Subscriptions');
    expect(rows.map((r) => r.currency)).toEqual(['MAD', 'MAD', 'MAD']);

    // Debit and credit named in Arabic, value date beside the operation date.
    const AR_DC = [
      'تاريخ العملية;تاريخ القيمة;البيان;مدين;دائن',
      '03/09/2026;04/09/2026;مرجان كاليفورنيا;845,20;',
      '30/09/2026;30/09/2026;تحويل وارد;;5 000,00',
    ].join('\n');
    expect(brief(parseCSV(AR_DC))).toEqual([
      ['2026-09-03', 'مرجان كاليفورنيا', 845.2, 'Expense'],
      ['2026-09-30', 'تحويل وارد', 5000, 'Income'],
    ]);

    // An unsigned Montant with a Sens column saying D or C for each row.
    const SENS = [
      'Date;Libellé;Montant;Sens',
      '04/09/2026;PAIEMENT CB BIM DERB GHALLEF;87,50;D',
      '15/09/2026;VERSEMENT ESPECES AGENCE;2 000,00;C',
    ].join('\n');
    expect(detectCsvFormat(SENS).signAmbiguous).toBe(false);
    expect(brief(parseCSV(SENS))).toEqual([
      ['2026-09-04', 'PAIEMENT CB BIM DERB GHALLEF', 87.5, 'Expense'],
      ['2026-09-15', 'VERSEMENT ESPECES AGENCE', 2000, 'Income'],
    ]);
  });

  test('csv delimiter: pipe-separated, rows missing their trailing fields, and an Excel sep= line', () => {
    const PIPE = [
      'Date|Libellé|Débit|Crédit',
      '14/09/2026|PRLV CANAL+ FRANCE|24,99|',
      '15/09/2026|VIR RECU LOYER||850,00',
    ].join('\n');
    expect(detectDelimiter(PIPE)).toBe('|');
    expect(brief(parseCSV(PIPE))).toEqual([
      ['2026-09-14', 'PRLV CANAL+ FRANCE', 24.99, 'Expense'],
      ['2026-09-15', 'VIR RECU LOYER', 850, 'Income'],
    ]);

    // Banks that drop empty trailing fields: a debit row stops at Débit.
    const SHORT = ['Date;Libellé;Débit;Crédit', '14/09/2026;CB FNAC;129,99', '16/09/2026;VIR RECU;;300,00'].join('\n');
    expect(brief(parseCSV(SHORT))).toEqual([
      ['2026-09-14', 'CB FNAC', 129.99, 'Expense'],
      ['2026-09-16', 'VIR RECU', 300, 'Income'],
    ]);

    // Excel writes the delimiter on a first line of its own.
    const EXCEL = ['sep=;', 'Date;Libellé;Montant', '14/09/2026;CB DECATHLON;-59,90'].join('\r\n');
    expect(detectDelimiter(EXCEL)).toBe(';');
    expect(inspectCsv(EXCEL).headers).toEqual(['Date', 'Libellé', 'Montant']);
    expect(brief(parseCSV(EXCEL))).toEqual([['2026-09-14', 'CB DECATHLON', 59.9, 'Expense']]);
  });

  test('csv delimiter: an explicit delimiter overrides detection, and a stale one cannot break a file', () => {
    // Two semicolons and one tab per row: detection says semicolon.
    const MIXED = ['Date;Ref\tLibellé;Montant', '14/09/2026;A1\tCB FNAC;-12,00'].join('\n');
    expect(detectDelimiter(MIXED)).toBe(';');
    expect(inspectCsv(MIXED, 'dmy', '\t').headers).toEqual(['Date;Ref', 'Libellé;Montant']);
    expect(detectCsvFormat(MIXED, 'dmy', undefined, '\t').delimiter).toBe('\t');
    expect(parseCSV(MIXED, { delimiter: ';' })[0]).toMatchObject({ amount: 12, type: 'Expense' });

    // A bank profile remembered before delimiters were detected carries none:
    // the file's own is used.
    const SEMI = ['Date;Libellé;Montant', '14/09/2026;CB FNAC;-12,00'].join('\n');
    const saved: CsvFormat = {
      decimal: 'european',
      date: 'dmy',
      sign: 'signed',
      dateAmbiguous: false,
      signAmbiguous: false,
      decimalAmbiguous: false,
    };
    expect(parseCSV(SEMI, saved, { dateIdx: 0, descIdx: 1, amountIdx: 2 })).toHaveLength(1);
    // A remembered comma, for a bank that has since moved to semicolons, does
    // not split the header at all, so it cannot be the file's delimiter.
    expect(parseCSV(SEMI, { ...saved, delimiter: ',' })).toHaveLength(1);
    expect(inspectCsv(SEMI, 'dmy', ',').headers).toEqual(['Date', 'Libellé', 'Montant']);
  });

  test('csv delimiter: balance lines below the table, and Swiss thousands, are not misread', () => {
    // Read by the engine's own date parser, "Solde au 12/10/2026" was the
    // 10th of December, and the closing balance became an income.
    const FOOTED = [
      'Date;Libellé;Débit;Crédit',
      '05/10/2026;PRLV SEPA FREE MOBILE;19,99;',
      '01/10/2026;VIR SEPA RECU SALAIRE;;2 850,00',
      'Total des opérations;;19,99;2 850,00',
      'Solde au 12/10/2026;;;2 345,67',
    ].join('\r\n');
    expect(brief(parseCSV(FOOTED))).toEqual([
      ['2026-10-05', 'PRLV SEPA FREE MOBILE', 19.99, 'Expense'],
      ['2026-10-01', 'VIR SEPA RECU SALAIRE', 2850, 'Income'],
    ]);
    expect(parseDate('Solde au 12/10/2026', 'dmy')).toBeNull();
    // Written-out dates still read.
    expect(parseDate('15 Jan 2026', 'dmy')).toBe('2026-01-15');
    expect(parseDate('Jan 15, 2026', 'mdy')).toBe('2026-01-15');

    // A Swiss export: semicolons, decimal points, apostrophes between thousands.
    const CH = [
      'Datum;Buchungstext;Betrag;Valuta',
      "15.09.2026;Einkauf COOP-1234 Zürich;-1'234.50;15.09.2026",
      "25.09.2026;Gutschrift Lohn ACME AG;6'500.00;25.09.2026",
    ].join('\r\n');
    expect(detectCsvFormat(CH, 'dmy', { dateIdx: 0, amountIdx: 2 })).toMatchObject({
      delimiter: ';',
      decimal: 'us',
      date: 'dmy',
    });
    expect(brief(parseCSV(CH, {}, { dateIdx: 0, descIdx: 1, amountIdx: 2 }))).toEqual([
      ['2026-09-15', 'Einkauf COOP-1234 Zürich', 1234.5, 'Expense'],
      ['2026-09-25', 'Gutschrift Lohn ACME AG', 6500, 'Income'],
    ]);
  });

  test('csv delimiter: comma files are still read as comma files', () => {
    // Every comma fixture above, including the ones with quoted decimal commas.
    for (const csv of [US_BANK, FRENCH_BANK, MOROCCAN_BANK, UNSIGNED_DEBITS, DEBIT_ONLY, UNRECOGNISABLE]) {
      expect(detectDelimiter(csv)).toBe(',');
      expect(detectCsvFormat(csv).delimiter).toBe(',');
    }
    // A semicolon in the text of a comma file is text.
    const NOTES = [
      'Date,Description,Amount',
      '03/15/2026,SQ *BLUE BOTTLE; OAKLAND,-6.50',
      '03/16/2026,ZELLE FROM J DOE; RENT SHARE,800.00',
      '03/17/2026,UBER *TRIP,-18.20',
    ].join('\n');
    expect(detectDelimiter(NOTES)).toBe(',');
    expect(brief(parseCSV(NOTES))).toEqual([
      ['2026-03-15', 'SQ *BLUE BOTTLE; OAKLAND', 6.5, 'Expense'],
      ['2026-03-16', 'ZELLE FROM J DOE; RENT SHARE', 800, 'Income'],
      ['2026-03-17', 'UBER *TRIP', 18.2, 'Expense'],
    ]);
    // A file with no delimiter at all, and an empty one, are comma files that say nothing.
    expect(detectDelimiter('just one line')).toBe(',');
    expect(detectDelimiter('')).toBe(',');
    expect(parseCSV('')).toEqual([]);
  });
});
