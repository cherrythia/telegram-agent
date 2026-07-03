export function validateWebhookSecret(
  headerValue: string | null | undefined,
  expected: string
): boolean {
  if (!headerValue || !expected) return false;
  return headerValue === expected;
}

export function isAllowedSender(
  chatId: string,
  allowedIds: string[]
): boolean {
  return allowedIds.includes(String(chatId));
}
