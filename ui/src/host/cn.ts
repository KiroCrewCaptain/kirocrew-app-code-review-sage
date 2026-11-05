/** Join class names, dropping empty ones (the dashboard's `cn` also merges Tailwind
 *  conflicts; every caller here passes non-conflicting overrides). */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}
