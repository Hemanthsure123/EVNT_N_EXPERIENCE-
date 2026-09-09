"""Validation for anything a user uploads.

Shared deliberately: event media, organization logos, and later CMS and city
imagery all accept files from the same kind of caller, and a size limit that
lives in one module protects one module. Every upload path should route
through `validate_image`.

WHY THE CHECKS ARE WHAT THEY ARE
--------------------------------

**Content type is checked against an allow-list, not a deny-list.** A deny-list
is a promise to have thought of every dangerous type; an allow-list is a
promise to have thought of the safe ones, which is a much smaller claim.

**The declared content type is not trusted on its own.** A browser sends
whatever it likes, so the file's leading bytes are checked too. This is not a
substitute for a virus scanner — it is the cheap check that stops an HTML file
renamed to `.jpg` being served back from our own origin, which is a stored-XSS
primitive.

**Size is capped before the file is read into memory.** `UploadedFile.size` is
known from the request without consuming the stream, so an oversized upload is
rejected without ever allocating it.

**Dimensions are gated where the image has a job to do.** See `ImageSpec` and
`EVENT_IMAGE_SPEC` below: a page that renders every picture in one frame can
only keep that promise if the pictures arriving are that shape.
"""

from __future__ import annotations

from dataclasses import dataclass

from django.core.files.uploadedfile import UploadedFile

from core.errors import InvalidInputError

#: 10 MB. Large enough for a 4000px hero at reasonable quality, small enough
#: that a hundred concurrent uploads cannot exhaust a worker's memory.
MAX_IMAGE_BYTES = 10 * 1024 * 1024

#: 5 MB for a crew portrait, which is drawn at ~200px on a lineup card and
#: ~56px in the picker. Nothing at that size needs ten megabytes, and the
#: commonest upload here is a phone photo straight off a camera roll --
#: where the cap is the one thing between the roster and a folder of
#: 12-megapixel originals nobody will ever see at full size.
MAX_CREW_PHOTO_BYTES = 5 * 1024 * 1024

#: Raster formats a browser can render, plus the two modern ones we prefer.
#: SVG is deliberately ABSENT: it is an XML document that can carry script, and
#: serving one from our own origin is a stored-XSS vector. An organizer who
#: needs a vector logo can export a PNG.
#:
#: HEIC/HEIF and TIFF are absent for the OPPOSITE reason to SVG: not
#: safety, but that no browser renders either and nothing here
#: transcodes an upload. Accepting an iPhone's HEIC would store it
#: happily and then draw a BROKEN IMAGE on the event page, which is
#: worse than refusing it with a message naming what to do instead.
#: They belong here the day a transcode step exists, not before.
#: ── AVIF IS WITHDRAWN, AND IT IS A SECURITY MITIGATION ──────────────────
#:
#: GHSA-2xp9-vwfh-vxw4 (CVSS 9.5) is a remote code execution flaw in Next.js's
#: Image Optimization API reached by OPTIMIZING AN AVIF FILE — the decode
#: happens in libheif under sharp. Every Next.js before 15.5.24 is affected and
#: there is no 14.x fix, so this deployment cannot patch it by upgrading a
#: patch release.
#:
#: What makes it reachable HERE is this allow-list. `next.config.mjs` pins
#: `remotePatterns` to our own API and storage host, so `/_next/image` will
#: only ever optimize a file that is already in OUR bucket — and the only way
#: a file gets there is through this function. Accepting AVIF therefore turned
#: "unauthenticated internet-wide RCE" into "any organizer who can upload a
#: poster can run code on the frontend server", which is still critical.
#:
#: Withdrawing the type closes the path at the door. It is a real cost — AVIF
#: is a good format and this list had just been widened — and it is worth
#: paying until the Next 15 upgrade lands, at which point this entry comes
#: back. Nothing else on the list decodes through libheif.
ALLOWED_IMAGE_TYPES = {
    "image/jpeg": (b"\xff\xd8\xff",),
    "image/jpg": (b"\xff\xd8\xff",),
    "image/png": (b"\x89PNG\r\n\x1a\n",),
    "image/webp": (b"RIFF",),
    "image/gif": (b"GIF87a", b"GIF89a"),
    "image/bmp": (b"BM",),
    # Windows icon, and the legacy alias browsers still send for it.
    "image/vnd.microsoft.icon": (b"\x00\x00\x01\x00",),
    "image/x-icon": (b"\x00\x00\x01\x00",),
}

#: What a refusal lists. Derived from the rule rather than written beside
#: it: the two were separate strings and the message was already a format
#: out of date.
_ALLOWED_LABEL = "JPEG, PNG, WebP, GIF, BMP or ICO"

#: How many leading bytes to inspect. Every signature above fits comfortably.
_SNIFF_BYTES = 16


@dataclass(frozen=True)
class ImageSpec:
    """What a particular slot needs a picture to BE, not merely to contain.

    ── WHY A DIMENSION GATE EXISTS AT ALL ────────────────────────────────────

    The event page renders every image — hero, gallery, thumbnail strip,
    lightbox — in ONE fixed frame, because a page whose pictures are each a
    different shape reads as broken however carefully the rest is built. A
    fixed frame can only be honoured two ways: crop whatever arrives silently,
    or require the right shape at the door.

    Cropping alone is what platforms do badly, and there is published evidence
    of it: Skiddle states that 95% of its flagged images fail for exactly three
    reasons — too much text, wrong crop, too low resolution — which is a
    measurement of what an open door produces. Eventbrite pins one size
    (2160x1080) and tells designers to centre the artwork so it survives the
    crop. Luma pins one (square, min 800x800) and says off-spec events are less
    likely to be featured. Every serious platform pins a ratio.

    So this is the door. It refuses with a message naming the actual numbers,
    which is the difference between an organiser fixing their export in two
    minutes and an organiser filing a support ticket.

    ── THE BAND, AND WHY IT IS A BAND ────────────────────────────────────────

    One exact ratio would reject a 1920x1081 export, which is absurd. The band
    is chosen so any accepted image loses at most about a sixth of itself to
    the frame: 3:2 (1.50) is the common camera ratio and 2:1 (2.00) is
    Eventbrite's own banner. Portrait, square and 4:3 fall outside it and are
    refused, because those are the shapes a landscape frame cannot show
    without destroying them.
    """

    #: Named in the error message. "event artwork", not "file".
    label: str
    min_width: int
    min_height: int
    #: Inclusive bounds on width/height.
    min_ratio: float
    max_ratio: float
    #: What we tell somebody to export. One number, not a range.
    recommended_width: int
    recommended_height: int

    #: One clause naming WHERE this shape is drawn, completing the sentence
    #: "…because {frame}". It is per-spec because the reason differs: the event
    #: hero is a widescreen frame, a lineup card is a tall one. A shared
    #: sentence is what made every refusal say "landscape".
    frame: str = "every image on the event page is shown in the same frame"

    @property
    def recommended(self) -> str:
        return f"{self.recommended_width} x {self.recommended_height}"

    @property
    def orientation(self) -> str:
        """ "landscape", "portrait" or "roughly square", DERIVED from the band.

        The refusal message used to hard-code "landscape" for every spec. That
        was true of the only spec there was when it was written, and has been
        wrong since `CREW_PORTRAIT_SPEC` landed: a landscape headshot is
        currently told the crew photo "has to be landscape — between 0.6:1 and
        1.05:1", which is a contradiction inside one sentence. No test caught
        it because the message assertions only ever used the event spec.
        """
        if self.max_ratio <= 1.0:
            return "portrait"
        if self.min_ratio >= 1.0 and self.max_ratio > 1.0 and self.min_ratio > 1.0:
            return "landscape"
        # A band straddling 1.0 (a headshot: 0.6–1.05) accepts both a tall
        # picture and a square one, so naming either would refuse something the
        # spec allows.
        return "portrait or square"

    @property
    def recommended_shape(self) -> str:
        """The recommended export as a ratio, e.g. "16:9" — COMPUTED.

        It was the literal string "(16:9)" in the message, so a 3:4 spec would
        have told an organiser to export their portrait poster at 16:9.
        """
        from math import gcd

        divisor = gcd(self.recommended_width, self.recommended_height) or 1
        return f"{self.recommended_width // divisor}:{self.recommended_height // divisor}"


#: The one shape the event page renders.
#:
#: 16:9 at 1920x1080 — landscape, because the hero sits above the ticket panel
#: and a portrait hero pushes the price and the Book button off the first
#: screen, which is the one measurable thing an event page must not do.
#: 1280x720 is the floor: below that the picture is visibly soft on a retina
#: screen at the size this page actually draws it.
EVENT_IMAGE_SPEC = ImageSpec(
    label="event artwork",
    min_width=1280,
    min_height=720,
    min_ratio=1.5,
    max_ratio=2.0,
    recommended_width=1920,
    recommended_height=1080,
    frame="every image on the event page is shown in the same widescreen frame",
)


#: The event's PORTRAIT poster — the primary mobile visual.
#:
#: `EVENT_IMAGE_SPEC` would refuse every one of these, and that is exactly why
#: the frontend's zone table carried a paragraph explaining that no 3:4 zone
#: could exist until this constant did.
#:
#: THE BAND ACCEPTS 2:3 THROUGH 3:4, which is wider than the brief's single
#: ratio and deliberately so: the mobile deck draws 2:3 cards, a poster
#: designed for print is usually 2:3, and Instagram's portrait crop is 4:5.
#: Demanding exactly 3:4 would refuse the two shapes organisers actually have
#: in favour of one they would have to make. The frame crops to fill, so
#: anything inside the band works.
#:
#: The floor is 800x1000 rather than the landscape spec's 1280x720: a portrait
#: poster is drawn at card width on a phone, and a 1280 minimum would refuse
#: perfectly good artwork to protect a 200px card.
EVENT_PORTRAIT_SPEC = ImageSpec(
    label="portrait poster",
    min_width=800,
    min_height=1000,
    min_ratio=0.6,
    max_ratio=0.8,
    recommended_width=1200,
    recommended_height=1600,
    frame="it is the picture people see first on a phone, where the card is taller than it is wide",
)


#: A person's portrait for an event lineup.
#:
#: `EVENT_IMAGE_SPEC` would refuse every one of these: it demands landscape
#: between 3:2 and 2:1, and a headshot is portrait or square. The band here is
#: the mirror of that — 2:3 through square — because the lineup carousel draws
#: tall cards and a landscape crop of a face inside one is a picture of a
#: forehead.
#:
#: The floor is deliberately low. Most crew photos are phone pictures or
#: cropped Instagram exports, and a 1280px minimum would refuse the majority of
#: real submissions to protect a card that is 200px wide.
#: ── NO LONGER APPLIED, AND KEPT ONLY AS ADVICE ──────────────────────────
#:
#: The crew upload paths used to pass this to `validate_image`, so a portrait
#: had to be at least 400x400 AND fall between 0.6:1 and square. That refused
#: a cropped Instagram export, a landscape press shot and any screenshot --
#: for a picture drawn at ~200px in a card that crops to fill anyway.
#:
#: A shape gate earns its place where a page renders every image in ONE frame
#: and a wrong shape visibly breaks the layout (`EVENT_IMAGE_SPEC`). A lineup
#: card is not that. So the only rules on a crew photo are now the two that
#: protect something real: the type allow-list with its magic-byte check, and
#: `MAX_CREW_PHOTO_BYTES`.
#:
#: Kept rather than deleted because the numbers are still the right ADVICE,
#: and the frontend prints them as a hint.
CREW_PORTRAIT_SPEC = ImageSpec(
    label="crew photo",
    min_width=400,
    min_height=400,
    min_ratio=0.6,
    max_ratio=1.05,
    recommended_width=800,
    recommended_height=1000,
    frame="the lineup draws tall cards and a landscape crop of a face is a picture of a forehead",
)


#: The little picture beside a custom category's name in the organizer's picker.
#:
#: A fourth spec rather than reusing one of the three above, because each of
#: them would refuse the obvious submission. `EVENT_IMAGE_SPEC` demands
#: landscape at 1280px wide; `EVENT_PORTRAIT_SPEC` demands 2:3–3:4; and
#: `CREW_PORTRAIT_SPEC` refuses anything wider than square. A category tile is
#: normally a SQUARE glyph or a small landscape crop, so the band runs from
#: just under square to 2:1. The 0.9 floor rather than a flat 1.0 is not
#: fussiness: a 500x510 export is square to everyone except a strict
#: comparison, and refusing it would be the gate failing on the commonest
#: real file.
#:
#: The floor is the lowest of the four (200px) and that is deliberate. This
#: image is drawn at roughly 24–48px beside a label in a dropdown, and it is
#: chosen by an organizer in the middle of a wizard step — refusing their
#: 256px icon to protect a 32px slot would make the field something people
#: skip, and a category with no picture is precisely what the column was added
#: to avoid.
CATEGORY_TILE_SPEC = ImageSpec(
    label="category image",
    min_width=200,
    min_height=200,
    min_ratio=0.9,
    max_ratio=2.0,
    recommended_width=512,
    recommended_height=512,
    frame="it is drawn small beside the category's name, so a square reads best",
)


def _dimensions(upload: UploadedFile) -> tuple[int, int]:
    """The image's pixel size, without decoding the pixels.

    `Image.open` reads only the header, so this costs a little header parsing
    rather than a full decode — which matters because it runs before we have
    decided whether to keep the file at all.

    Pillow is asked to identify the file rather than trusted to. If it cannot,
    the upload is REFUSED: every type on the allow-list above is one Pillow
    reads natively on the pinned version (AVIF and WebP both verified), so a
    file that passed the signature check and then will not open is malformed.
    Failing open here would make the gate decorative — an unreadable file would
    become the one way past it.
    """
    from PIL import Image, UnidentifiedImageError

    upload.seek(0)
    try:
        with Image.open(upload) as image:
            width, height = image.size
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise InvalidInputError(
            "That image could not be read. Re-export it as a JPEG or PNG and try again."
        ) from exc
    finally:
        upload.seek(0)
    return width, height


def describe_shape(ratio: float) -> str:
    """How to name a wrong shape to somebody who has to fix it.

    "aspect ratio 0.67" is a number they did not choose and cannot act on.
    "taller than it is wide" is the thing they can see in their own export.
    """
    if ratio < 1:
        return "taller than it is wide"
    if ratio < 1.5:
        return "close to square"
    return "much wider than it is tall"


def validate_dimensions(upload: UploadedFile, spec: ImageSpec) -> tuple[int, int]:
    """Check the picture is the shape and size its slot needs. Returns (w, h).

    Every message names the numbers on BOTH sides — what arrived and what is
    needed — because "invalid image" sends somebody back to the same export
    dialog knowing nothing more than before.

    ── SHAPE IS CHECKED BEFORE SIZE, AND THE ORDER IS THE POINT ──────────────

    It was the other way round first, and a test caught what that produced: a
    1200x1800 portrait poster — the single most common wrong upload — failed
    the 1280 WIDTH floor before anything looked at its shape, so the organiser
    was told to make it bigger. Re-exporting the same poster at 1400x2100
    satisfies that advice and is refused again, because the real problem was
    never the size.

    Shape cannot be fixed by scaling and size can, so the unfixable problem is
    the one to name first. Reporting only the reason somebody can still act on
    is how a validation message sends them round a loop.
    """
    width, height = _dimensions(upload)
    if width <= 0 or height <= 0:
        raise InvalidInputError("That image has no dimensions.")

    ratio = width / height
    if ratio < spec.min_ratio or ratio > spec.max_ratio:
        # EVERY part of this sentence comes from the spec. It used to hard-code
        # "landscape", "widescreen frame" and "(16:9)", which made it a
        # contradiction for any non-landscape slot — and the whole point of
        # naming real numbers is that an organiser fixes their export in two
        # minutes instead of filing a support ticket.
        raise InvalidInputError(
            f"That image is {width} x {height}, which is {describe_shape(ratio)}. "
            f"The {spec.label} has to be {spec.orientation} — between {spec.min_ratio:g}:1 "
            f"and {spec.max_ratio:g}:1 — because {spec.frame}. Export it at "
            f"{spec.recommended} ({spec.recommended_shape}) to fit exactly."
        )

    if width < spec.min_width or height < spec.min_height:
        raise InvalidInputError(
            f"That image is {width} x {height}. The {spec.label} needs to be at least "
            f"{spec.min_width} x {spec.min_height}, and {spec.recommended} is ideal. "
            "Anything smaller looks blurred at the size this page displays it."
        )
    return width, height


def validate_image(
    upload: UploadedFile,
    *,
    spec: ImageSpec | None = None,
    max_bytes: int = MAX_IMAGE_BYTES,
) -> str:
    """Check size, declared type and leading bytes. Returns the content type.

    Raises `InvalidInputError` with a message an organizer can act on — "that
    file is 14 MB, the limit is 10 MB" is actionable; "invalid upload" is not.

    `spec` adds the dimension gate. It is OPTIONAL rather than always-on
    because the slots genuinely differ: an event hero is landscape and an
    organisation logo is square, and one global rule would either refuse every
    logo or admit every off-shape hero. A caller that renders into a fixed
    frame passes its spec; a caller that does not, does not.

    `max_bytes` is per-slot for the same reason. A hero and a 200px portrait
    have no business sharing a ceiling.
    """
    if upload.size is None or upload.size == 0:
        raise InvalidInputError("That file is empty.")
    if upload.size > max_bytes:
        megabytes = upload.size / (1024 * 1024)
        limit = max_bytes // (1024 * 1024)
        raise InvalidInputError(
            f"That image is {megabytes:.1f} MB — the limit is {limit} MB. "
            "Try exporting it at a lower quality."
        )

    content_type = (upload.content_type or "").lower().split(";")[0].strip()
    if content_type not in ALLOWED_IMAGE_TYPES:
        raise InvalidInputError(f"That file type is not supported. Upload a {_ALLOWED_LABEL}.")

    # Read the signature WITHOUT consuming the stream for the caller.
    head = upload.read(_SNIFF_BYTES)
    upload.seek(0)
    signatures = ALLOWED_IMAGE_TYPES[content_type]
    if not any(head.startswith(signature) for signature in signatures):
        # The declared type and the actual bytes disagree. Most often this is a
        # renamed file; occasionally it is deliberate.
        raise InvalidInputError(
            "That file does not look like the image type it claims to be. "
            "Re-export it and try again."
        )

    # LAST, on purpose: it is the only check that parses the file, so it runs
    # only once the cheap ones have agreed the file is worth parsing.
    if spec is not None:
        validate_dimensions(upload, spec)

    return content_type


def storage_path(*, prefix: str, owner_id: str, filename: str) -> str:
    """A collision-free, traversal-free object path.

    The original filename is NOT used as the path. It is attacker-controlled
    and can contain `../`, a null byte, or 4 KB of Unicode — none of which
    belong in a storage key. A UUID is the name; the extension is the only
    thing carried over, and only from an allow-list.
    """
    import uuid as _uuid

    extension = ""
    if "." in filename:
        candidate = filename.rsplit(".", 1)[-1].lower()
        if candidate.isalnum() and len(candidate) <= 5:
            extension = f".{candidate}"
    return f"{prefix}/{owner_id}/{_uuid.uuid4().hex}{extension}"
