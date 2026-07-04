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

// In a group chat Telegram disambiguates commands as "/cmd@botusername" — strip
// that suffix so command matching behaves the same as in a DM. This strips any
// @handle, not just this bot's own — safe as long as the allowlisted group has
// no other bot with privacy mode disabled; a command addressed to a different
// bot would otherwise be misrouted here after chat-ID allowlisting.
export function stripBotMention(text: string): string {
  if (!text.startsWith("/")) return text;
  const [command, ...rest] = text.split(" ");
  const bare = command!.split("@")[0]!;
  return [bare, ...rest].join(" ");
}
