/**
 * What a stored receipt path means.
 *
 * Dependency-free so it can be tested — receipt-image.ts needs the auth client
 * to attach the session, which pulls in React Native.
 */

/**
 * True for the device-local paths stored before receipts were uploaded.
 *
 * `Expense.imageUrl` used to hold whatever the picker handed the submitter's
 * phone. Those bytes never reached the server, so the receipt only ever
 * rendered for the person who submitted it and cannot be recovered now. They
 * are reported as unavailable rather than rendered as a broken image.
 */
export function isLegacyLocalReceipt(imageUrl: string | null | undefined): boolean {
  return !!imageUrl && !imageUrl.startsWith('/');
}

/** True when there is a receipt this device can actually load. */
export function hasLoadableReceipt(imageUrl: string | null | undefined): boolean {
  return !!imageUrl && !isLegacyLocalReceipt(imageUrl);
}
