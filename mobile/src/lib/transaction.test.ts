import { test, expect, describe } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { LOCAL_SCHEMA_SQL } from './local-schema';

/**
 * The phone's one Transaction type agrees with the server's Prisma model.
 *
 * There is no shared package between the two halves (Railway builds the
 * backend from /backend alone), so agreement is proved here instead: this
 * reads backend/prisma/schema.prisma and lib/transaction.ts as text and
 * compares them field by field. A field added to either side without the
 * other fails the suite.
 */

const SCHEMA = join(import.meta.dir, '..', '..', '..', 'backend', 'prisma', 'schema.prisma');
const TYPE_FILE = join(import.meta.dir, 'transaction.ts');

/** Columns the server keeps for itself; none of them travels to the phone's type. */
const SERVER_ONLY = ['userId', 'user', 'account', 'updatedAt', 'clientUpdatedAt', 'serverUpdatedAt'];

interface PrismaField {
  name: string;
  type: string;
  optional: boolean;
  list: boolean;
  comment: string;
}

function parsePrismaModel(schema: string, model: string): PrismaField[] {
  const block = schema.match(new RegExp(`^model\\s+${model}\\s*\\{([\\s\\S]*?)^\\}`, 'm'))?.[1];
  if (!block) throw new Error(`model ${model} not found`);
  return block
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('//') && !line.startsWith('@@'))
    .map((line) => {
      const m = line.match(/^(\w+)\s+(\w+)(\?|\[\])?([^/]*)(?:\/\/(.*))?$/);
      if (!m) throw new Error(`unparsed Prisma line: ${line}`);
      return { name: m[1]!, type: m[2]!, optional: m[3] === '?', list: m[3] === '[]', comment: (m[5] ?? '').trim() };
    });
}

interface TsField {
  name: string;
  type: string;
  optional: boolean;
}

function parseTsInterface(source: string, name: string): TsField[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const block = code.match(new RegExp(`interface\\s+${name}\\s*\\{([\\s\\S]*?)\\}`))?.[1];
  if (!block) throw new Error(`interface ${name} not found`);
  return block
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((decl) => {
      const m = decl.match(/^(\w+)(\?)?\s*:\s*([\s\S]+)$/);
      if (!m) throw new Error(`unparsed field: ${decl}`);
      return { name: m[1]!, optional: m[2] === '?', type: m[3]!.replace(/\s+/g, ' ').trim() };
    });
}

/**
 * String columns that are a closed vocabulary on the wire (I-WIRE), and so a
 * union on the phone. The schema documents each in a trailing comment, which
 * the test also holds to the same values. `category` is deliberately not one:
 * its comment lists the defaults, but custom categories are any 1–50 chars.
 */
const CLOSED_VOCABULARIES: Record<string, string[]> = { type: ['Expense', 'Income'] };

/** The TypeScript a Prisma scalar arrives as in JSON. */
function expectedTsType(field: PrismaField): string {
  const base: Record<string, string> = { String: 'string', Float: 'number', Int: 'number', Boolean: 'boolean', DateTime: 'string' };
  let ts = base[field.type];
  if (!ts) throw new Error(`no TypeScript mapping for Prisma ${field.type} (${field.name})`);
  const vocabulary = CLOSED_VOCABULARIES[field.name];
  if (vocabulary) ts = vocabulary.map((v) => `'${v}'`).join(' | ');
  return field.optional ? `${ts} | null` : ts;
}

const schema = readFileSync(SCHEMA, 'utf8');
const server = parsePrismaModel(schema, 'Transaction');
const phone = parseTsInterface(readFileSync(TYPE_FILE, 'utf8'), 'Transaction');

describe('Transaction, phone against server', () => {
  test('carries exactly the server model’s fields, minus the server-only ones', () => {
    const domain = server.filter((f) => !SERVER_ONLY.includes(f.name)).map((f) => f.name).sort();
    expect(phone.map((f) => f.name).sort()).toEqual(domain);
    expect(domain).toHaveLength(10);
  });

  test('every server-only field the type leaves out really exists on the server', () => {
    // If the server renames one, the list above silently stops excluding it.
    const names = new Set(server.map((f) => f.name));
    expect(SERVER_ONLY.filter((n) => !names.has(n))).toEqual([]);
  });

  test('each field has the type the server sends', () => {
    const byName = new Map(server.map((f) => [f.name, f]));
    const mismatches = phone
      .filter((f) => expectedTsType(byName.get(f.name)!) !== f.type)
      .map((f) => `${f.name}: phone ${f.type}, server ${expectedTsType(byName.get(f.name)!)}`);
    expect(mismatches).toEqual([]);
  });

  test('the closed vocabularies are the ones the schema documents', () => {
    for (const [name, values] of Object.entries(CLOSED_VOCABULARIES)) {
      const field = server.find((f) => f.name === name);
      expect(field?.type).toBe('String');
      expect(field?.comment.split('|').map((v) => v.trim())).toEqual(values);
    }
  });

  test('nothing is optional: a missing value is null, as the server sends it', () => {
    expect(phone.filter((f) => f.optional).map((f) => f.name)).toEqual([]);
    const isImpulse = phone.find((f) => f.name === 'isImpulse');
    expect(isImpulse?.type).toBe('boolean');
  });

  test('the comparison would catch drift', () => {
    // Controls: the parsers and the mapping, on a drifted copy of each side.
    const drifted = parseTsInterface(
      `export interface Transaction { id: string; isImpulse: number; note?: string; }`,
      'Transaction',
    );
    expect(drifted.find((f) => f.name === 'isImpulse')?.type).toBe('number');
    expect(drifted.find((f) => f.name === 'note')?.optional).toBe(true);

    const extra = parsePrismaModel(
      `model Transaction {\n  id String @id\n  merchant String? // new\n  type String // Expense|Income\n  isImpulse Boolean @default(false)\n}`,
      'Transaction',
    );
    expect(extra.map((f) => f.name)).toEqual(['id', 'merchant', 'type', 'isImpulse']);
    expect(expectedTsType(extra[1]!)).toBe('string | null');
    expect(expectedTsType(extra[2]!)).toBe("'Expense' | 'Income'");
    expect(expectedTsType(extra[3]!)).not.toBe('number');
  });
});

describe('Transaction, type against the phone’s own table', () => {
  test('every field is a column of the local transactions table', () => {
    const table = LOCAL_SCHEMA_SQL.match(/CREATE TABLE IF NOT EXISTS transactions \(([\s\S]*?)\n\s*\);/)?.[1] ?? '';
    const columns = table
      .split('\n')
      .map((l) => l.trim().match(/^(\w+)\s+[A-Z]+/)?.[1])
      .filter((c): c is string => !!c);
    expect(phone.map((f) => f.name).filter((n) => !columns.includes(n))).toEqual([]);
    // Stored as 0/1 (SQLite has no boolean); db.ts is where it becomes one.
    expect(table).toMatch(/\bisImpulse INTEGER NOT NULL/);
  });

  test('it is the only Transaction type in the app', () => {
    const src = join(import.meta.dir, '..');
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = join(dir, e.name);
        if (e.isDirectory()) return walk(full);
        return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [full] : [];
      });
    const declaring = walk(src).filter((f) =>
      /\b(?:interface\s+Transaction\b|type\s+Transaction\s*=)/.test(
        readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''),
      ),
    );
    expect(declaring.map((f) => relative(src, f))).toEqual(['lib/transaction.ts']);
  });
});
