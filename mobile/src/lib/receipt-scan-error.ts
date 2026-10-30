/**
 * What a failed receipt scan says, in the reader's language.
 *
 * The screen used to show the error's own message, so a scan the server
 * could not read reached it as "Request failed (502)". A failure on the
 * server's side (the vision model down, a reply it could not parse) now says
 * the receipt could not be read and that it can be added by hand; a lost
 * connection, a timeout or an image the server refuses say what the rest of
 * the app says for them (lib/api-errors).
 *
 * Imports nothing native, so it is tested without a device.
 */
import { errorSentence, toApiFailure } from './api-errors';
import { t } from './i18n/core';

export function receiptScanError(e: unknown): string {
  const { kind } = toApiFailure(e, 'image');
  if (kind === 'server' || kind === 'unknown') return t('receiptScan.scanFailed');
  return errorSentence(kind, 'image');
}
