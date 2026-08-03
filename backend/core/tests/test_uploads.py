"""Upload validation.

This is a security boundary, so the tests are mostly hostile inputs. The two
that matter most:

- **An SVG is refused.** It is an XML document that can carry script, and
  serving one back from our own origin is a stored-XSS vector.
- **A renamed file is refused.** The declared content type is attacker
  controlled; the leading bytes are checked against it.
"""

from __future__ import annotations

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from core.errors import InvalidInputError
from core.uploads import MAX_IMAGE_BYTES, storage_path, validate_image

JPEG = b"\xff\xd8\xff" + b"0" * 64
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64


def upload(content: bytes, name: str = "a.jpg", content_type: str = "image/jpeg"):
    return SimpleUploadedFile(name, content, content_type=content_type)


class TestAccepted:
    def test_a_real_jpeg_passes(self):
        assert validate_image(upload(JPEG)) == "image/jpeg"

    def test_a_real_png_passes(self):
        assert validate_image(upload(PNG, "a.png", "image/png")) == "image/png"

    def test_a_charset_parameter_is_tolerated(self):
        """Browsers append one; it is not a different type."""
        assert validate_image(upload(JPEG, "a.jpg", "image/jpeg; charset=binary")) == "image/jpeg"

    def test_the_stream_is_left_readable_for_the_caller(self):
        """Validation sniffs the header — if it consumed the stream, the
        service would upload an empty object."""
        candidate = upload(JPEG)
        validate_image(candidate)
        assert candidate.read() == JPEG


class TestRejected:
    def test_an_svg_is_refused(self):
        """An SVG can carry script. Serving one from our origin is stored XSS."""
        svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
        with pytest.raises(InvalidInputError) as caught:
            validate_image(upload(svg, "logo.svg", "image/svg+xml"))
        assert "not supported" in str(caught.value)

    def test_html_renamed_as_a_jpeg_is_refused(self):
        """The declared type is attacker-controlled; the bytes are not."""
        with pytest.raises(InvalidInputError) as caught:
            validate_image(upload(b"<html><script>alert(1)</script>", "x.jpg", "image/jpeg"))
        assert "does not look like" in str(caught.value)

    def test_an_oversized_file_is_refused_with_the_actual_size(self):
        oversized = upload(JPEG + b"0" * (MAX_IMAGE_BYTES + 1))
        with pytest.raises(InvalidInputError) as caught:
            validate_image(oversized)
        # The message has to be actionable — "invalid upload" is not.
        assert "the limit is 10 MB" in str(caught.value)

    def test_an_empty_file_is_refused(self):
        with pytest.raises(InvalidInputError):
            validate_image(upload(b""))

    def test_a_pdf_is_refused(self):
        with pytest.raises(InvalidInputError):
            validate_image(upload(b"%PDF-1.4", "a.pdf", "application/pdf"))


class TestStoragePath:
    def test_the_original_filename_is_never_the_path(self):
        """It is attacker-controlled. A UUID is the name."""
        path = storage_path(prefix="event-media", owner_id="evt-1", filename="holiday.jpg")
        assert path.startswith("event-media/evt-1/")
        assert "holiday" not in path
        assert path.endswith(".jpg")

    @pytest.mark.parametrize(
        "filename",
        ["../../etc/passwd", "../../../a.jpg", "a/../../b.png", "x.jpg/../../y"],
    )
    def test_traversal_cannot_escape_the_prefix(self, filename: str):
        path = storage_path(prefix="event-media", owner_id="evt-1", filename=filename)
        assert path.startswith("event-media/evt-1/")
        assert ".." not in path

    def test_a_hostile_extension_is_dropped_rather_than_carried(self):
        path = storage_path(prefix="p", owner_id="o", filename="a." + "x" * 40)
        # Too long to be a real extension, so it is dropped entirely — the key
        # is the bare UUID rather than carrying 40 attacker-chosen characters.
        assert "xxxx" not in path
        assert "." not in path.rsplit("/", 1)[-1]

    def test_two_uploads_of_the_same_name_do_not_collide(self):
        first = storage_path(prefix="p", owner_id="o", filename="a.jpg")
        second = storage_path(prefix="p", owner_id="o", filename="a.jpg")
        assert first != second
