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

#: Raster formats a browser can render, plus the two modern ones we prefer.
#: SVG is deliberately ABSENT: it is an XML document that can carry script, and
#: serving one from our own origin is a stored-XSS vector. An organizer who
#: needs a vector logo can export a PNG.
ALLOWED_IMAGE_TYPES = {
    "image/jpeg": (b"\xff\xd8\xff",),
    "image/png": (b"\x89PNG\r\n\x1a\n",),
    "image/webp": (b"RIFF",),
    "image/avif": (b"\x00\x00\x00",),  # ftyp box; the brand is checked below
    "image/gif": (b"GIF87a", b"GIF89a"),
}

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

    @property
    def recommended(self) -> str:
        return f"{self.recommended_width} x {self.recommended_height}"


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
        raise InvalidInputError(
            f"That image is {width} x {height}, which is {describe_shape(ratio)}. "
            f"The {spec.label} has to be landscape — between {spec.min_ratio:g}:1 and "
            f"{spec.max_ratio:g}:1 — because every image on the event page is shown in the "
            f"same widescreen frame. Export it at {spec.recommended} (16:9) to fit exactly."
        )

    if width < spec.min_width or height < spec.min_height:
        raise InvalidInputError(
            f"That image is {width} x {height}. The {spec.label} needs to be at least "
            f"{spec.min_width} x {spec.min_height}, and {spec.recommended} is ideal. "
            "Anything smaller looks blurred at the size this page displays it."
        )
    return width, height


def validate_image(upload: UploadedFile, *, spec: ImageSpec | None = None) -> str:
    """Check size, declared type and leading bytes. Returns the content type.

    Raises `InvalidInputError` with a message an organizer can act on — "that
    file is 14 MB, the limit is 10 MB" is actionable; "invalid upload" is not.

    `spec` adds the dimension gate. It is OPTIONAL rather than always-on
    because the slots genuinely differ: an event hero is landscape and an
    organisation logo is square, and one global rule would either refuse every
    logo or admit every off-shape hero. A caller that renders into a fixed
    frame passes its spec; a caller that does not, does not.
    """
    if upload.size is None or upload.size == 0:
        raise InvalidInputError("That file is empty.")
    if upload.size > MAX_IMAGE_BYTES:
        megabytes = upload.size / (1024 * 1024)
        limit = MAX_IMAGE_BYTES // (1024 * 1024)
        raise InvalidInputError(
            f"That image is {megabytes:.1f} MB — the limit is {limit} MB. "
            "Try exporting it at a lower quality."
        )

    content_type = (upload.content_type or "").lower().split(";")[0].strip()
    if content_type not in ALLOWED_IMAGE_TYPES:
        raise InvalidInputError(
            "That file type is not supported. Upload a JPEG, PNG, WebP, AVIF or GIF."
        )

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
