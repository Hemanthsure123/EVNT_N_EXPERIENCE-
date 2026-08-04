/**
 * Initials from a name or an email — the fallback wherever a person or an
 * organisation has no picture.
 *
 * EXTRACTED FROM `scope.ts` rather than copied. `components/ui/avatar` needs
 * it, and `scope.ts` is a client module that pulls in react-query, the API
 * client and the auth provider — a `ui/` primitive that dragged all of that
 * behind it would put the app's data layer inside its design system. This
 * module is pure and has no imports, so a primitive can depend on it safely.
 *
 * `scope.ts` re-exports it, so every existing `initialsOf` import still
 * resolves and there is still exactly ONE implementation.
 */

/** One or two letters, upper-cased. `'?'` when there is nothing to derive. */
export function initialsOf(value: string): string {
  return (
    value
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase() || '?'
  );
}
