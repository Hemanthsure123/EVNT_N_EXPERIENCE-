/**
 * Validate a `?next=` destination before navigating to it.
 *
 * "Send the user back where they came from" is the exact affordance open
 * redirects abuse: `?next=https://evil.example/login` produces a link that
 * starts on this domain, passes a glance at the URL bar, and lands on a
 * convincing fake of the page the user was already trying to sign in to.
 *
 * The rule is narrow on purpose — one leading slash, and no second one.
 * `//evil.example` and `/\evil.example` are both protocol-relative URLs that a
 * naive `startsWith('/')` check waves through.
 */
export function safeNext(value: string | null | undefined, fallback = '/'): string {
  if (!value) return fallback;
  if (!value.startsWith('/')) return fallback;
  if (value.startsWith('//') || value.startsWith('/\\')) return fallback;
  return value;
}
