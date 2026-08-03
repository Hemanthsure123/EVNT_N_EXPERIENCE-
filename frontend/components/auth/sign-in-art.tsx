import * as React from 'react';
import { cn } from '@/lib/utils/cn';

/**
 * The one piece of decoration on the sign-in page: a ticket, drawn.
 *
 * ── WHY A PICTURE AT ALL, AND WHY ONLY ONE ───────────────────────────────
 *
 * A sign-in page is a single-task screen, so decoration earns its place only
 * if it does something the form cannot: say what this account is FOR. A
 * near-white card with a form on it is indistinguishable from a bank's, a
 * payroll system's or a router's admin page. A ticket says "this is where your
 * tickets live" in the half-second before anyone reads a word.
 *
 * It is exactly one element, at the TOP of the card, and it stops there. The
 * brief for this product is a calm, image-forward language where photography
 * carries the colour — and there is no photograph available on a sign-in page,
 * so this is the substitute, not an invitation to decorate the rest.
 *
 * ── IT LIVES ON THE PAGE, NOT IN THE PANEL ───────────────────────────────
 *
 * `auth-panel.tsx` is shared with the booking funnel's step 2, which already
 * has an event summary beside it and a step rail above it. A second picture
 * there would compete with the thing being bought. So the art belongs to the
 * standalone screen, and the shared panel stays exactly as portable as it was.
 *
 * ── DRAWN, NOT DOWNLOADED ────────────────────────────────────────────────
 *
 * Same rules as `components/illustrations/clay.tsx`: every colour resolves
 * through `rgb(var(--token))`, so it reskins with the brand and is correct in
 * both themes rather than being a picture of one palette. Depth is expressed
 * as OPACITY of a single surface token rather than as two different fills,
 * because light and dark stack their surfaces in opposite directions — a
 * "lighter card in front" reads as depth in light and as a mistake in dark.
 *
 * ── THE CROP IS PART OF THE DESIGN ───────────────────────────────────────
 *
 * The band is short on a phone (80px) and taller from `sm` (112px), and the
 * SVG is `slice`, so the artwork COVERS rather than letterboxes. The viewBox
 * is 400x112 and everything that matters is inside y 26-90, which is the
 * region that survives the worst crop this component can be given (a 448px
 * wide card at 80px tall shows y 20-92). Decoration must never be the reason
 * the email field lands below the fold, and 80px is the budget that keeps the
 * form's first input above it on a 360x640 phone.
 *
 * ── THE MOTION ───────────────────────────────────────────────────────────
 *
 * One slow violet sheen, every 7 seconds, TRANSFORM AND OPACITY ONLY so it
 * stays off the main thread, and gone entirely under `prefers-reduced-motion`
 * (both by the global rule in styles/globals.css and by an explicit rule here,
 * because "it happens to inherit the right behaviour" is not a guarantee).
 *
 * The keyframes are a scoped `<style>` rather than a class in globals.css for
 * one reason: this component owns them and nothing else uses them. The house
 * pattern for shared effects (`.skeleton`, `.reveal`) is globals.css; a
 * one-page flourish that lives there is a global name nobody can safely delete
 * later.
 */

const SHEEN_CSS = `
.signin-sheen{position:absolute;inset:0;overflow:hidden;pointer-events:none}
.signin-sheen::after{content:'';position:absolute;top:0;bottom:0;left:0;width:40%;
background-image:linear-gradient(100deg,transparent,rgb(var(--primary) / 0.16),transparent);
transform:translateX(-120%);
animation:signin-sheen 7s var(--ease-in-out) infinite}
@keyframes signin-sheen{
0%{transform:translateX(-120%);opacity:0}
12%{opacity:1}
58%{opacity:1}
70%{transform:translateX(260%);opacity:0}
100%{transform:translateX(260%);opacity:0}
}
@media (prefers-reduced-motion:reduce){.signin-sheen::after{animation:none;opacity:0}}
`;

/**
 * The ticket silhouette, notches included, as ONE path.
 *
 * Drawn as a path rather than a rect plus two circles filled with the band
 * colour, because a "notch" painted in the background colour stops being a
 * notch the moment anything (here, the bloom) is behind it. Both bites are
 * `sweep-flag 0` so they curve INTO the ticket: travelling clockwise, the top
 * edge runs left-to-right and the bottom edge right-to-left, so the same flag
 * bulges down on one and up on the other.
 */
const TICKET =
  'M118 26H229.5A6.5 6.5 0 0 0 242.5 26H282A14 14 0 0 1 296 40V72A14 14 0 0 1 282 86H242.5' +
  'A6.5 6.5 0 0 0 229.5 86H118A14 14 0 0 1 104 72V40A14 14 0 0 1 118 26Z';

/** The 3 QR finder squares. Not a scannable code — a code needs a payload, and
 *  this page has nothing to encode. The finder pattern alone is the part people
 *  actually recognise, and it invents nothing. */
const FINDERS = [
  { x: 248, y: 38 },
  { x: 275, y: 38 },
  { x: 248, y: 65 },
];

export function SignInArt({ className }: { className?: string }) {
  // SVG `<defs>` ids are DOCUMENT-global; two instances sharing one id means
  // the second silently adopts the first's gradient. Same trap clay.tsx and
  // brand-mark.tsx both document.
  const uid = React.useId();
  const bloomA = `${uid}-bloom-a`;
  const bloomB = `${uid}-bloom-b`;
  const soften = `${uid}-soften`;

  return (
    <div
      aria-hidden
      className={cn(
        'relative h-20 overflow-hidden border-b border-border bg-sunken sm:h-28',
        className,
      )}
    >
      <style dangerouslySetInnerHTML={{ __html: SHEEN_CSS }} />

      <svg
        viewBox="0 0 400 112"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 size-full"
        focusable="false"
      >
        <defs>
          {/* Two soft blooms, violet and its deeper step, so the band has
              colour and depth without a photograph. Both fade to fully
              transparent rather than to a colour, so they composite the same
              way over either theme's sunken band. */}
          <radialGradient id={bloomA} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgb(var(--primary))" stopOpacity="0.2" />
            <stop offset="100%" stopColor="rgb(var(--primary))" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={bloomB} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgb(var(--accent))" stopOpacity="0.16" />
            <stop offset="100%" stopColor="rgb(var(--accent))" stopOpacity="0" />
          </radialGradient>
          <filter id={soften} x="-30%" y="-200%" width="160%" height="500%">
            <feGaussianBlur stdDeviation="3.5" />
          </filter>
        </defs>

        <ellipse cx="72" cy="8" rx="170" ry="104" fill={`url(#${bloomA})`} />
        <ellipse cx="352" cy="104" rx="150" ry="96" fill={`url(#${bloomB})`} />

        {/* Contact shadow. Near-invisible in dark on purpose — that theme
            carries elevation with value, not with shadow. */}
        <ellipse
          cx="200"
          cy="88"
          rx="82"
          ry="4"
          fill="rgb(var(--overlay))"
          opacity="0.14"
          filter={`url(#${soften})`}
        />

        <path
          d={TICKET}
          fill="rgb(var(--surface))"
          stroke="rgb(var(--border-strong))"
          strokeWidth="1.5"
        />

        {/* The perforation, stopping short of both notches. */}
        <path
          d="M236 34V78"
          stroke="rgb(var(--border-strong))"
          strokeWidth="1.5"
          strokeDasharray="3 5"
          strokeLinecap="round"
        />

        {/* The stub side: finder squares plus three cells of "data". */}
        <g fill="rgb(var(--foreground))" opacity="0.45">
          {FINDERS.map((finder) => (
            <React.Fragment key={`${finder.x}-${finder.y}`}>
              <rect
                x={finder.x}
                y={finder.y}
                width="13"
                height="13"
                rx="3.5"
                fill="none"
                stroke="rgb(var(--foreground))"
                strokeWidth="2.6"
              />
              <rect x={finder.x + 4} y={finder.y + 4} width="5" height="5" rx="1.5" />
            </React.Fragment>
          ))}
          <rect x="277" y="66" width="5" height="5" rx="1.5" />
          <rect x="286" y="66" width="4" height="4" rx="1.5" />
          <rect x="277" y="75" width="4" height="4" rx="1.5" />
        </g>

        {/* The body side: one violet medallion and two bars of printed detail.
            The bars are the SAME ink at two opacities rather than two greys,
            so they hold their relationship in both themes. */}
        <rect x="122" y="40" width="34" height="32" rx="11" fill="rgb(var(--primary))" opacity="0.16" />
        <path
          d="M139 44C139 51.5 146.5 56 151 56C146.5 56 139 60.5 139 68C139 60.5 131.5 56 127 56C131.5 56 139 51.5 139 44Z"
          fill="rgb(var(--primary))"
        />
        <g fill="rgb(var(--foreground))">
          <rect x="166" y="46" width="54" height="7" rx="3.5" opacity="0.3" />
          <rect x="166" y="61" width="36" height="7" rx="3.5" opacity="0.16" />
        </g>
      </svg>

      <span className="signin-sheen" />
    </div>
  );
}
