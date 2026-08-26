import { test, expect } from 'bun:test';
import { isLegacyLocalReceipt, hasLoadableReceipt } from './receipt-path';

test('a stored receipt path is loadable', () => {
  expect(hasLoadableReceipt('/api/expenses/abc123/receipt')).toBe(true);
  expect(isLegacyLocalReceipt('/api/expenses/abc123/receipt')).toBe(false);
});

test('the old device-local paths are recognised and not loadable', () => {
  // These only ever rendered on the submitter's own phone — the bytes never
  // reached the server, so there is nothing to fetch and nothing to migrate.
  for (const legacy of [
    'file:///var/mobile/Containers/Data/tmp/img.jpg',
    'ph://ABC-123',
    'assets-library://asset/asset.JPG',
    'content://media/external/images/1',
  ]) {
    expect(isLegacyLocalReceipt(legacy)).toBe(true);
    expect(hasLoadableReceipt(legacy)).toBe(false);
  }
});

test('an absent receipt is absent, not legacy', () => {
  for (const empty of [null, undefined, '']) {
    expect(isLegacyLocalReceipt(empty)).toBe(false);
    expect(hasLoadableReceipt(empty)).toBe(false);
  }
});
