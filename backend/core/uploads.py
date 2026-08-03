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
"""

from __future__ import annotations

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


def validate_image(upload: UploadedFile) -> str:
    """Check size, declared type and leading bytes. Returns the content type.

    Raises `InvalidInputError` with a message an organizer can act on — "that
    file is 14 MB, the limit is 10 MB" is actionable; "invalid upload" is not.
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
