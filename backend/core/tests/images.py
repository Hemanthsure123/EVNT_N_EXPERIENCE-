"""Real images for tests, in one place.

`core.uploads.validate_image` parses the file now, so a test cannot upload
`b"bytes"` and call it a JPEG any more. That is the point of the gate — but it
means several test files need a genuine encoded image, and four copies of a
Pillow snippet is four places to fix when the spec moves.

Not named `test_*`, so pytest does not collect it.
"""

from __future__ import annotations

import io

from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image

from core.uploads import EVENT_IMAGE_SPEC


def image_bytes(width: int, height: int, *, fmt: str = "PNG") -> bytes:
    """A real encoded image of exactly this size."""
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), (120, 90, 200)).save(buffer, format=fmt)
    return buffer.getvalue()


def event_image(name: str = "art.png", *, width: int = 1920, height: int = 1080):
    """An upload the event gate accepts: 16:9 and comfortably above the floor.

    Defaults to the recommended size, so a test that just needs "a valid image"
    does not have to know the spec — and a test that needs an INVALID one says
    so by passing dimensions, which reads as the point being made.
    """
    content_type = "image/png" if name.lower().endswith(".png") else "image/jpeg"
    fmt = "PNG" if content_type == "image/png" else "JPEG"
    return SimpleUploadedFile(name, image_bytes(width, height, fmt=fmt), content_type=content_type)


def undersized_event_image(name: str = "small.png"):
    """Correctly shaped, below the resolution floor."""
    return event_image(name, width=640, height=360)


def portrait_event_image(name: str = "poster.png"):
    """A 2:3 poster — the exact shape the event frame cannot draw."""
    return event_image(name, width=1200, height=1800)


assert EVENT_IMAGE_SPEC.recommended_width == 1920, "keep `event_image` on the recommended size"
