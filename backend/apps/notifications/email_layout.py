"""The HTML shell every transactional email is rendered into.

── WHY THIS IS HAND-WRITTEN TABLES AND INLINE STYLES ─────────────────────

Email is not the web. Gmail strips `<head>` styles on some clients, Outlook
for Windows renders through Microsoft **Word's** HTML engine (no flexbox, no
grid, no `border-radius`, no `background-image`, unreliable `padding` on
anything that is not a table cell, and Times New Roman wherever a font stack
it does not recognise is declared), and Yahoo rewrites class names. The layout
that works everywhere in 2026 is still `<table role="presentation">` with
styles inlined on each element.

So there is no template engine here and no CSS framework. A Django template
would put the markup somewhere a designer could break it without a test
noticing; these are functions with escaped inputs, called from `templates.py`
next to the plain-text version of the same message.

── THE MASTHEAD IS THE APP'S BRAND MARK, SET AS TYPE ─────────────────────

`frontend/components/shell/brand-mark.tsx` draws a "CX" monogram as inline
SVG next to the wordmark, with the full stop in the accent violet. None of
that survives a mail client: Gmail strips inline `<svg>` entirely, Word has
no SVG renderer, and shipping the mark as a PNG puts the masthead behind
image-blocking — which is on by default in Outlook and in Gmail's promotions
tab. A masthead that is invisible half the time is not a masthead.

So the monogram is SET AS TYPE — the same two letters, in a rounded badge
built from a table cell — beside the same wordmark and the same accent full
stop. Real text: it always renders, it is selectable, it scales with the
user's font size, and a screen reader reads the product name rather than
"image". The badge is `aria-hidden` so the name is announced once, not twice.

── THE PALETTE MIRRORS `frontend/styles/tokens.css` ──────────────────────

Warm ink and violet, not the cool slate this file used to carry. The site is
`--ink-*` (a warm near-black on an off-white paper) and an email in slate
grey next to it reads as a different company's receipt. Every value below is
one of the site's own tokens, converted from `rgb()` triplets to hex because
Word does not understand `rgb()` in every property.

── BULLETPROOF BUTTONS, NOT STYLED ANCHORS ───────────────────────────────

Word gives an `<a>` no padding and no background box, so a "button" that is
just a styled anchor collapses to blue underlined text in the client most
likely to be reading a work address. `button()` emits a VML `<v:roundrect>`
inside an `<!--[if mso]>` block and the real anchor inside the matching
downlevel-revealed comment, so exactly one of the two ever renders.

── MULTIPART, NEVER HTML-ONLY ────────────────────────────────────────────

The plain-text body stays authoritative and is always sent alongside. It is
what screen readers, text-only clients and plain-text-preferring users get,
and an HTML-only message scores materially worse with spam filters. The two
must SAY THE SAME THING — `templates.py` builds both from one set of facts.

── EVERY INTERPOLATED VALUE IS ESCAPED ───────────────────────────────────

`full_name` and `event_title` are user-controlled and land inside markup.
Unescaped, a display name of `<img src=x onerror=...>` is HTML injection into
a message we send in our own name — which is a phishing primitive, not a
cosmetic bug. Every builder escapes; none takes raw HTML from a caller.

── DARK MODE IS DECLARED, NOT FOUGHT ─────────────────────────────────────

`color-scheme: light dark` tells Apple Mail and Outlook not to auto-invert,
the `prefers-color-scheme` block restyles the surfaces for clients that
honour it, and the `[data-ogsc]` duplicates cover Outlook.com, which rewrites
the message and prefixes every selector rather than supporting the media
query. Gmail ignores all three and applies its own inversion; the palette is
chosen so that still reads (mid-contrast warm greys, never near-black on
near-white, which inverts to unreadable).

── ACCESSIBILITY ─────────────────────────────────────────────────────────

There are NO images in any of these messages — every word is real text, so
nothing depends on `alt` and nothing breaks when images are blocked. Layout
tables carry `role="presentation"` so a screen reader does not announce them
as data tables. Every foreground/background pair below is at or above 4.5:1
(the ratios are noted beside the constants), and the one place a colour is
the only signal — the accent full stop — is decoration beside the name it
follows, never information on its own.
"""

from __future__ import annotations

from django.utils.html import escape

# ── Palette ──────────────────────────────────────────────────────────────
# Mirrors frontend/styles/tokens.css so an email and the site are recognisably
# the same product. Contrast ratios are against SURFACE (white) unless noted.
BRAND = "#7C3AED"  # --violet-600  (--primary)          5.70:1
BRAND_DARK = "#6D28D9"  # --violet-700  (--accent)            7.16:1
BRAND_LIFT = "#A78BFA"  # --violet-400  the accent on INK     6.32:1 on INK
BRAND_WASH = "#F5F3FF"  # --violet-50   hero panel fill
BRAND_EDGE = "#DDD6FE"  # --violet-200  hero panel border
INK = "#1C1B19"  # --ink-900     (--foreground)      17.2:1
BODY_TEXT = "#57534D"  # --ink-700     (--muted-foreground) 7.64:1
SUBTLE_TEXT = "#706B64"  # --ink-600     (--foreground-subtle) 5.28:1
BORDER = "#E7E4DE"  # --ink-200     (--border)
WASH = "#F3F1ED"  # --ink-100     (--muted)
PAGE = "#F9F7F4"  # --ink-50      the paper the card sits on
SURFACE = "#FFFFFF"  # --white       (--surface)

# Dark-mode surfaces, also straight from the site's tokens.
DARK_PAGE = "#141312"  # --dark-bg
DARK_SURFACE = "#1E1D1B"  # --dark-surface
DARK_MUTED = "#2E2C29"  # --dark-muted
DARK_BORDER = "#3D3A36"  # --dark-border

FONT = (
    "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',"
    "Arial,'Noto Sans',sans-serif"
)
MONO = "'SF Mono',SFMono-Regular,ui-monospace,Menlo,Consolas,'Liberation Mono',monospace"

PRODUCT_NAME = "Curatix"  # frontend/lib/brand.ts BRAND_NAME

# The horizontal rhythm. One constant rather than a number typed into fifteen
# padding declarations — a gutter that drifts by 4px between two blocks is the
# single most visible way a hand-built email stops looking designed.
GUTTER = 32


# ── Blocks ───────────────────────────────────────────────────────────────
# Each returns one `<tr>`'s worth of markup, already padded. They are composed
# by `render_email` in the order given. The intended order for a message is
# eyebrow -> heading -> paragraph -> ONE hero -> details -> ONE button ->
# footnote/callout; nothing enforces it, because a template that needs to
# depart from it should be able to.


def eyebrow(text: str) -> str:
    """The small capitalised label above the heading.

    ── IT IS NOT A SECOND COPY OF `masthead_label` ───────────────────────

    The masthead band already tags the message kind ("E-TICKET", "REFUND").
    Every template started out repeating that word here too, which printed it
    twice, 20px apart, on every message — the most visible way a set of emails
    stops looking designed. So an eyebrow is for a card that needs a SECOND,
    different signal: the operator alerts pair a masthead of "OPERATIONS" with
    an eyebrow of "ACTION REQUIRED", because which surface and what is being
    asked for are two facts. If it would say what the masthead says, leave it
    out.
    """
    return (
        f'<tr><td class="gutter brand" style="padding:0 {GUTTER}px 10px;font-family:{FONT};'
        f"font-size:11px;line-height:16px;font-weight:700;color:{BRAND_DARK};"
        f'letter-spacing:0.12em;text-transform:uppercase;">{escape(text)}</td></tr>'
    )


def heading(text: str) -> str:
    return (
        f'<tr><td class="gutter ink" style="padding:0 {GUTTER}px 12px;font-family:{FONT};'
        f"font-size:26px;line-height:34px;font-weight:700;color:{INK};"
        f'letter-spacing:-0.02em;">{escape(text)}</td></tr>'
    )


def paragraph(text: str, *, muted: bool = False) -> str:
    colour = SUBTLE_TEXT if muted else BODY_TEXT
    klass = "subtle" if muted else "body-text"
    size = "13px" if muted else "16px"
    line = "20px" if muted else "26px"
    return (
        f'<tr><td class="gutter {klass}" style="padding:0 {GUTTER}px 18px;font-family:{FONT};'
        f'font-size:{size};line-height:{line};color:{colour};">{escape(text)}</td></tr>'
    )


def hero(*, label: str, value: str, sub: str = "") -> str:
    """THE one fact the message exists to deliver.

    Exactly one per email, by convention: the refund amount, the start time,
    the payout. A message with two heroes has none — the eye picks whichever
    is bigger and the other becomes body copy with a large font size.

    Tinted violet rather than grey so it separates from the details card below
    it without a second border weight, and `border-left` gives Word something
    to render since it ignores `border-radius` entirely.
    """
    sub_html = (
        f'<tr><td class="subtle" style="padding:6px 0 0;font-family:{FONT};font-size:14px;'
        f'line-height:20px;color:{SUBTLE_TEXT};">{escape(sub)}</td></tr>'
        if sub
        else ""
    )
    return (
        f'<tr><td class="gutter" style="padding:2px {GUTTER}px 22px;">'
        f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" '
        f'class="hero" style="border-collapse:separate;mso-table-lspace:0pt;mso-table-rspace:0pt;'
        f"background-color:{BRAND_WASH};border:1px solid {BRAND_EDGE};"
        f'border-left:4px solid {BRAND};border-radius:14px;">'
        f'<tr><td style="padding:20px 22px;">'
        f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">'
        f'<tr><td class="brand" style="padding:0;font-family:{FONT};font-size:11px;'
        f"line-height:16px;font-weight:700;color:{BRAND_DARK};letter-spacing:0.1em;"
        f'text-transform:uppercase;">{escape(label)}</td></tr>'
        f'<tr><td class="ink" style="padding:6px 0 0;font-family:{FONT};font-size:22px;'
        f'line-height:30px;font-weight:700;color:{INK};letter-spacing:-0.01em;">'
        f"{escape(value)}</td></tr>"
        f"{sub_html}"
        f"</table></td></tr></table></td></tr>"
    )


def facts(rows: list[tuple[str, str]]) -> str:
    """The details card — label left, value right, one row each.

    A receipt, not sentences: these are looked up, not read, and somebody
    standing at a venue door is scanning for one line. Right-aligned values
    give every row the same edge to run the eye down, which is why every
    payment confirmation you have ever been sent is laid out this way.

    The last row drops its rule so the card does not end on a hairline
    floating above its own padding.
    """
    last = len(rows) - 1
    cells = []
    for index, (label, value) in enumerate(rows):
        rule = "" if index == last else f"border-bottom:1px solid {BORDER};"
        cells.append(
            f'<tr><td class="subtle rule" style="padding:12px 0;font-family:{FONT};'
            f"font-size:13px;line-height:20px;color:{SUBTLE_TEXT};width:38%;"
            f'vertical-align:top;{rule}">{escape(label)}</td>'
            f'<td align="right" class="ink rule" style="padding:12px 0;font-family:{FONT};'
            f"font-size:15px;line-height:20px;color:{INK};font-weight:600;"
            f'text-align:right;vertical-align:top;{rule}">{escape(value)}</td></tr>'
        )
    return (
        f'<tr><td class="gutter" style="padding:2px {GUTTER}px 22px;">'
        f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" '
        f'class="wash" style="border-collapse:separate;mso-table-lspace:0pt;'
        f"mso-table-rspace:0pt;background-color:{PAGE};border:1px solid {BORDER};"
        f'border-radius:14px;">'
        f'<tr><td style="padding:4px 20px;">'
        f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" '
        f'style="border-collapse:collapse;">{"".join(cells)}</table>'
        f"</td></tr></table></td></tr>"
    )


def items(entries: list[str], *, title: str = "") -> str:
    """A short list — the ticket lines, mostly.

    Bulleted with a small violet square drawn as a table cell rather than a
    `<ul>`: Word's list rendering ignores most styling and indents by an
    amount it picks itself, which is how one block ends up 18px out of line
    with every other block in the message.
    """
    title_html = (
        f'<tr><td class="subtle" style="padding:0 0 8px;font-family:{FONT};font-size:11px;'
        f"line-height:16px;font-weight:700;color:{SUBTLE_TEXT};letter-spacing:0.1em;"
        f'text-transform:uppercase;">{escape(title)}</td></tr>'
        if title
        else ""
    )
    rows = "".join(
        f"<tr><td>"
        f'<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>'
        f'<td width="6" style="width:6px;font-size:0;line-height:0;padding:0 12px 0 0;'
        f'vertical-align:middle;"><div style="width:6px;height:6px;background-color:{BRAND};'
        f'border-radius:3px;font-size:0;line-height:0;">&nbsp;</div></td>'
        f'<td class="ink" style="padding:7px 0;font-family:{FONT};font-size:15px;'
        f'line-height:22px;color:{INK};">{escape(entry)}</td>'
        f"</tr></table></td></tr>"
        for entry in entries
    )
    return (
        f'<tr><td class="gutter" style="padding:0 {GUTTER}px 18px;">'
        f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" '
        f'style="border-collapse:collapse;">{title_html}{rows}</table></td></tr>'
    )


def code_panel(code: str, *, caption: str) -> str:
    """The one-time code, as the unmissable object in the message.

    Letter-spaced and large because the job is to be read off a phone at a
    glance and typed into another window. `text-indent` compensates for the
    trailing letter-space, which otherwise pushes the whole code left of
    centre by half a character — visible at 36px, invisible at 14px, which is
    why it is easy to ship.
    """
    return (
        f'<tr><td class="gutter" style="padding:2px {GUTTER}px 22px;">'
        f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" '
        f'class="hero" style="border-collapse:separate;mso-table-lspace:0pt;'
        f"mso-table-rspace:0pt;background-color:{BRAND_WASH};border:1px solid {BRAND_EDGE};"
        f'border-radius:14px;">'
        f'<tr><td align="center" class="ink" style="padding:26px 16px 8px;font-family:{MONO};'
        f"font-size:36px;line-height:44px;font-weight:700;color:{INK};"
        f'letter-spacing:0.24em;text-indent:0.24em;">{escape(code)}</td></tr>'
        f'<tr><td align="center" class="subtle" style="padding:0 16px 22px;font-family:{FONT};'
        f'font-size:13px;line-height:18px;color:{SUBTLE_TEXT};">{escape(caption)}</td></tr>'
        f"</table></td></tr>"
    )


def _button_width(label: str) -> int:
    """The pixel width VML needs, which HTML works out for itself.

    `<v:roundrect>` has no shrink-to-fit: Word draws exactly the width given
    and clips the label if it is short. There is no font metric available
    here, so this estimates from Arial Bold 15px (~8.6px per character) and
    errs GENEROUS — a button 12px wider than its label is a button, a button
    12px narrower is a truncated word. Clamped so a one-word label still
    reads as a target and a long one does not run past the 600px column.
    """
    return max(180, min(420, int(len(label) * 8.6) + 60))


def button(label: str, url: str) -> str:
    """The one primary call to action, rendered so Outlook draws it too.

    ── WHY THIS IS NOT A STYLED `<a>` ────────────────────────────────────

    Word's engine gives an inline anchor no background box and no padding, so
    the styled-anchor version of this collapses into blue underlined text —
    in the client most likely to be reading a work address. The VML
    `<v:roundrect>` is a real filled rounded rectangle Word CAN draw;
    `<w:anchorlock/>` stops it being editable in the reading pane.

    The two halves are mutually exclusive by construction: Word reads the
    `<!--[if mso]>` block and skips the downlevel-revealed comment after it,
    every other client does the exact opposite. Nothing renders twice.
    """
    safe_url = escape(url)
    safe_label = escape(label)
    width = _button_width(label)
    return (
        f'<tr><td class="gutter" align="left" style="padding:4px {GUTTER}px 26px;">'
        f"<div>"
        f"<!--[if mso]>"
        f'<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" '
        f'xmlns:w="urn:schemas-microsoft-com:office:word" href="{safe_url}" '
        f'style="height:48px;v-text-anchor:middle;width:{width}px;" arcsize="22%" '
        f'stroke="f" fillcolor="{BRAND}">'
        f"<w:anchorlock/>"
        f'<center style="color:#FFFFFF;font-family:Arial,sans-serif;font-size:15px;'
        f'font-weight:bold;">{safe_label}</center>'
        f"</v:roundrect>"
        f"<![endif]-->"
        f"<!--[if !mso]><!-->"
        f'<a href="{safe_url}" target="_blank" '
        f'style="display:inline-block;background-color:{BRAND};padding:15px 30px;'
        f"font-family:{FONT};font-size:15px;line-height:18px;font-weight:600;"
        f'color:#FFFFFF;text-decoration:none;border-radius:10px;">{safe_label}</a>'
        f"<!--<![endif]-->"
        f"</div></td></tr>"
    )


def callout(text: str) -> str:
    """A bordered aside — the security line, the bank-timing line, the bring-ID
    line. Deliberately quiet: it is the sentence that answers the support
    ticket this message would otherwise generate, not part of the message."""
    return (
        f'<tr><td class="gutter" style="padding:2px {GUTTER}px 24px;">'
        f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" '
        f'class="muted" style="border-collapse:separate;mso-table-lspace:0pt;'
        f'mso-table-rspace:0pt;background-color:{WASH};border-radius:12px;">'
        f'<tr><td class="subtle" style="padding:14px 18px;font-family:{FONT};font-size:13px;'
        f'line-height:20px;color:{SUBTLE_TEXT};">{escape(text)}</td></tr>'
        f"</table></td></tr>"
    )


def spacer(height: int = 8) -> str:
    return f'<tr><td style="font-size:0;line-height:0;height:{height}px;">&nbsp;</td></tr>'


# ── The masthead ─────────────────────────────────────────────────────────


def _masthead(label: str) -> str:
    """The brand band: the app's mark and wordmark, reversed out of ink.

    `bgcolor` AND `background-color` — Word honours the attribute, everything
    modern honours the property, and a masthead that loses its fill in Outlook
    leaves white type on white paper.
    """
    label_html = (
        f'<td align="right" valign="middle" style="font-family:{FONT};font-size:11px;'
        f"line-height:16px;font-weight:600;color:#B8B2A8;letter-spacing:0.1em;"
        f'text-transform:uppercase;">{escape(label)}</td>'
        if label
        else ""
    )
    return f"""<tr>
  <td bgcolor="{INK}" style="background-color:{INK};padding:22px {GUTTER - 4}px;\
border-radius:16px 16px 0 0;" class="masthead">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" \
style="border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;">
      <tr>
        <td valign="middle">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" \
style="border-collapse:collapse;">
            <tr>
              <!-- The monogram, as type. See the module docstring for why this
                   is not the app's SVG and not a PNG. aria-hidden so the
                   wordmark beside it is announced once, not "C X Curatix". -->
              <td width="32" height="32" align="center" valign="middle" bgcolor="{SURFACE}" \
aria-hidden="true" style="width:32px;height:32px;background-color:{SURFACE};border-radius:9px;\
font-family:{FONT};font-size:13px;line-height:32px;font-weight:700;color:{INK};\
letter-spacing:0.02em;">CX</td>
              <td valign="middle" style="padding-left:11px;font-family:{FONT};font-size:20px;\
line-height:32px;font-weight:700;color:{SURFACE};letter-spacing:-0.01em;">\
{escape(PRODUCT_NAME)}<span style="color:{BRAND_LIFT};">.</span></td>
            </tr>
          </table>
        </td>
        {label_html}
      </tr>
    </table>
  </td>
</tr>"""


# ── The shell ────────────────────────────────────────────────────────────


def render_email(
    *,
    title: str,
    preheader: str,
    blocks: list[str],
    footer_note: str = "",
    masthead_label: str = "",
) -> str:
    """Wrap composed blocks in the full document.

    `preheader` is the grey line an inbox shows after the subject. Left
    unset, clients scrape the first words of the body — which for a code
    email means the greeting, wasting the one piece of screen real estate
    that could have carried the code itself.

    `masthead_label` is the small word opposite the wordmark in the brand
    band — the message's KIND. It is the one place that label belongs; see
    `eyebrow` for why a template should not repeat it inside the card.

    ── THE FOOTER CARRIES NO LINKS, ON PURPOSE ───────────────────────────

    Every premium transactional email ends in a row of them — help centre,
    notification preferences, unsubscribe. This platform has no help centre
    page and no notification-preference screen (CLAUDE.md records both as
    deliberately unbuilt), and a footer link to a route that does not exist
    is worse than a quiet footer: it is the product telling somebody there is
    somewhere to go and then 404ing them. When those pages exist, this is
    where they go.
    """
    body = "".join(blocks)
    note = escape(footer_note) if footer_note else ""
    note_html = (
        f'<tr><td class="subtle" style="padding:0 8px 10px;font-family:{FONT};'
        f'font-size:12px;line-height:18px;color:{SUBTLE_TEXT};">{note}</td></tr>'
        if note
        else ""
    )

    return f"""<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" \
"http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" \
xmlns:v="urn:schemas-microsoft-com:vml" \
xmlns:o="urn:schemas-microsoft-com:office:office" lang="en">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="light dark" />
<meta name="supported-color-schemes" content="light dark" />
<!-- Stops iOS and Gmail turning references, dates and venue strings into
     tappable blue links we did not write. -->
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no" />
<title>{escape(title)}</title>
<!--[if mso]>
<xml><o:OfficeDocumentSettings>
  <o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch>
</o:OfficeDocumentSettings></xml>
<style type="text/css">
  /* Word falls back to Times New Roman for any font stack it does not
     recognise, which is all of them. Naming a font it HAS is the only way
     the message is not serif in Outlook for Windows. */
  table, td, div, p, a, span {{ font-family: Arial, Helvetica, sans-serif !important; }}
</style>
<![endif]-->
<style type="text/css">
  /* Clients that honour <style>. Everything load-bearing is ALSO inlined
     above, so stripping this block costs polish and never legibility. */
  body {{ margin:0 !important; padding:0 !important; width:100% !important;
         -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }}
  table {{ border-spacing:0; mso-table-lspace:0pt; mso-table-rspace:0pt; }}
  img {{ border:0; outline:none; text-decoration:none; -ms-interpolation-mode:bicubic; }}
  a {{ color:{BRAND_DARK}; }}
  /* Stop iOS turning dates and references into blue links. */
  a[x-apple-data-detectors] {{ color:inherit !important; text-decoration:none !important;
                               font-size:inherit !important; font-weight:inherit !important; }}
  @media only screen and (max-width:620px) {{
    .container {{ width:100% !important; }}
    /* The {GUTTER}px gutter is right on a desktop column and wasteful on a phone. */
    .gutter {{ padding-left:22px !important; padding-right:22px !important; }}
    .masthead {{ padding-left:22px !important; padding-right:22px !important; }}
  }}
  @media (prefers-color-scheme: dark) {{
    .page {{ background-color:{DARK_PAGE} !important; }}
    .card {{ background-color:{DARK_SURFACE} !important; border-color:{DARK_BORDER} !important; }}
    .ink {{ color:#F9F7F4 !important; }}
    .body-text {{ color:#CDC9C1 !important; }}
    .subtle {{ color:#A8A39A !important; }}
    .brand {{ color:{BRAND_LIFT} !important; }}
    .wash, .muted {{ background-color:{DARK_MUTED} !important;
                     border-color:{DARK_BORDER} !important; }}
    .hero {{ background-color:#241F35 !important; border-color:#4C3F86 !important; }}
    .rule {{ border-color:{DARK_BORDER} !important; }}
  }}
  /* Outlook.com rewrites the message and prefixes its own dark-mode
     selectors rather than supporting the media query above. */
  [data-ogsc] .page {{ background-color:{DARK_PAGE} !important; }}
  [data-ogsc] .card {{ background-color:{DARK_SURFACE} !important;
                       border-color:{DARK_BORDER} !important; }}
  [data-ogsc] .ink {{ color:#F9F7F4 !important; }}
  [data-ogsc] .body-text {{ color:#CDC9C1 !important; }}
  [data-ogsc] .subtle {{ color:#A8A39A !important; }}
  [data-ogsc] .wash, [data-ogsc] .muted {{ background-color:{DARK_MUTED} !important; }}
</style>
</head>
<body class="page" style="margin:0;padding:0;width:100%;background-color:{PAGE};">
<!-- Preheader: the inbox preview line. The zero-width padding stops Gmail
     appending the first words of the body after it. -->
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;\
opacity:0;overflow:hidden;mso-hide:all;color:{PAGE};">{escape(preheader)}\
{"&#847;&zwnj;&nbsp;" * 40}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" \
class="page" style="background-color:{PAGE};border-collapse:collapse;">
  <tr>
    <td align="center" style="padding:28px 12px 40px;">

      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" \
class="container" style="width:600px;max-width:600px;border-collapse:collapse;">

        {_masthead(masthead_label)}

        <tr><td>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" \
class="card" style="background-color:{SURFACE};border:1px solid {BORDER};border-top:0;\
border-radius:0 0 16px 16px;border-collapse:separate;">
            {spacer(28)}
            {body}
            {spacer(6)}
          </table>
        </td></tr>

        <!-- Footer, outside the card: it is about the message, not in it. -->
        <tr><td style="padding:22px 8px 0;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" \
style="border-collapse:collapse;">
            {note_html}
            <tr><td class="subtle" style="padding:0 8px;font-family:{FONT};font-size:12px;\
line-height:18px;color:{SUBTLE_TEXT};">
              This is a transactional message about your {escape(PRODUCT_NAME)} account.
            </td></tr>
            <!-- Says out loud why there is no unsubscribe link: there is
                 nothing to unsubscribe FROM. Every message this module sends
                 is caused by something the recipient did. -->
            <tr><td class="subtle" style="padding:8px 8px 0;font-family:{FONT};font-size:12px;\
line-height:18px;color:{SUBTLE_TEXT};">
              {escape(PRODUCT_NAME)} &middot; sent because of activity on your account, \
not a subscription.
            </td></tr>
          </table>
        </td></tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>"""
