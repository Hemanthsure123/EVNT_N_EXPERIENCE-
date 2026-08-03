/**
 * Provider glyphs, drawn in `currentColor`.
 *
 * Google's brand guidelines allow a monochrome mark on a light or dark button,
 * and monochrome is also the only version that survives this design system: the
 * `no-raw-values` lint rule bans hex, and the four-colour "G" is four hexes that
 * belong to nobody's token scale. It inherits the button's text colour, so it
 * reads correctly in both themes with no second asset.
 *
 * Inline rather than a file — one path costs less than a network request, and
 * an <img> that 404s on a sign-in button looks broken.
 *
 * `AppleMark` used to live here. Sign in with Apple was removed from the panel:
 * it had no backend, no planned one, and its entire behaviour was to occupy the
 * busiest part of the page and then say it wasn't connected. The glyph went with
 * it rather than staying as an unused export — a mark nothing renders is a
 * standing invitation to render it again.
 */

export function GoogleMark({ className = 'size-5' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="currentColor"
      aria-hidden
      focusable="false"
    >
      <path d="M12.24 10.285V14.4h6.806c-.275 1.765-2.056 5.174-6.806 5.174-4.095 0-7.439-3.389-7.439-7.574s3.344-7.574 7.439-7.574c2.33 0 3.891.989 4.785 1.849l3.254-3.138C18.189 1.186 15.479 0 12.24 0c-6.635 0-12 5.365-12 12s5.365 12 12 12c6.926 0 11.52-4.869 11.52-11.726 0-.788-.085-1.39-.189-1.989H12.24z" />
    </svg>
  );
}
