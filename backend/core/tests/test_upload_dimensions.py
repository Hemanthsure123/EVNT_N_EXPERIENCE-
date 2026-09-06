"""The dimension gate: what gets in, what does not, and why.

These are the tests for a door. Each one names a real image somebody would
actually try to upload — a phone photo, a poster export, a logo — rather than a
synthetic edge case, because the gate's job is to be right about those.
"""

from __future__ import annotations

import io

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image

from core.errors import InvalidInputError
from core.uploads import (
    CREW_PORTRAIT_SPEC,
    EVENT_IMAGE_SPEC,
    EVENT_PORTRAIT_SPEC,
    ImageSpec,
    describe_shape,
    validate_dimensions,
    validate_image,
)


def png(width: int, height: int) -> SimpleUploadedFile:
    """A real PNG of the given size — not a stub.

    The gate reads the file's header, so a fake payload would test nothing.
    """
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), (120, 90, 200)).save(buffer, format="PNG")
    return SimpleUploadedFile("art.png", buffer.getvalue(), content_type="image/png")


class TestTheShapeTheEventPageCanDraw:
    def test_a_1920x1080_export_is_accepted(self):
        assert validate_dimensions(png(1920, 1080), EVENT_IMAGE_SPEC) == (1920, 1080)

    def test_the_band_admits_a_3_2_camera_photo_and_a_2_1_banner(self):
        # The two ends of the band, both real: 3:2 is what a camera produces
        # and 2:1 is Eventbrite's own banner size. Neither loses more than
        # about a sixth of itself to the frame.
        validate_dimensions(png(3000, 2000), EVENT_IMAGE_SPEC)
        validate_dimensions(png(2160, 1080), EVENT_IMAGE_SPEC)

    def test_a_portrait_poster_is_refused_and_told_what_to_export(self):
        # The exact case that broke the page: a 2:3 poster in a landscape
        # frame. This catalogue's own artwork was 800x1192.
        with pytest.raises(InvalidInputError) as error:
            validate_dimensions(png(1600, 2400), EVENT_IMAGE_SPEC)
        message = str(error.value)
        assert "taller than it is wide" in message
        # The fix, in the refusal — not a support ticket.
        assert "1920 x 1080" in message

    def test_a_square_logo_is_refused_for_an_event_slot(self):
        with pytest.raises(InvalidInputError) as error:
            validate_dimensions(png(1500, 1500), EVENT_IMAGE_SPEC)
        assert "close to square" in str(error.value)

    def test_a_4_3_image_is_refused(self):
        # 1.33 is outside the band: shown in a 16:9 frame it loses a quarter of
        # its width, which is where a title or a date usually is.
        with pytest.raises(InvalidInputError):
            validate_dimensions(png(1600, 1200), EVENT_IMAGE_SPEC)

    def test_a_small_portrait_poster_is_refused_on_SHAPE_not_size(self):
        """The ordering regression, and it is not academic.

        1200x1800 is the most common wrong upload there is: a portrait poster
        straight out of Canva. It fails the 1280 width floor AND the ratio
        band. Reporting the size first tells somebody to enlarge it — advice
        that cannot work, because re-exporting the same poster at 1400x2100
        satisfies it and is refused again.

        Shape is unfixable by scaling, so shape is what the message must name.
        """
        with pytest.raises(InvalidInputError) as error:
            validate_dimensions(png(1200, 1800), EVENT_IMAGE_SPEC)
        message = str(error.value)
        assert "taller than it is wide" in message
        assert "at least" not in message

    def test_a_correctly_shaped_but_tiny_image_is_refused_on_size_not_shape(self):
        with pytest.raises(InvalidInputError) as error:
            validate_dimensions(png(640, 360), EVENT_IMAGE_SPEC)
        message = str(error.value)
        assert "640 x 360" in message
        assert "at least 1280 x 720" in message
        # Refused for being small, so it must not also lecture about shape.
        assert "landscape" not in message


class TestTheGateIsWiredIntoValidateImage:
    def test_without_a_spec_any_shape_passes(self):
        # The default has to stay open: an organisation logo is square and goes
        # through the same function. A global rule would refuse every logo.
        assert validate_image(png(400, 400)) == "image/png"

    def test_with_the_event_spec_a_portrait_upload_is_refused(self):
        with pytest.raises(InvalidInputError):
            validate_image(png(1000, 1500), spec=EVENT_IMAGE_SPEC)

    def test_the_stream_is_left_rewound_for_the_caller(self):
        # The service reads the file straight after validating it. A gate that
        # consumed the stream would store a zero-byte object and nothing would
        # error — the picture would simply be missing.
        upload = png(1920, 1080)
        validate_image(upload, spec=EVENT_IMAGE_SPEC)
        assert len(upload.read()) > 0

    def test_a_file_that_lies_about_its_type_never_reaches_the_dimension_check(self):
        # Order matters: the cheap signature check must reject this, because
        # handing a renamed HTML file to an image parser is the expensive way
        # to find out the same thing.
        upload = SimpleUploadedFile(
            "evil.png", b"<script>alert(1)</script>", content_type="image/png"
        )
        with pytest.raises(InvalidInputError) as error:
            validate_image(upload, spec=EVENT_IMAGE_SPEC)
        assert "does not look like the image type" in str(error.value)

    def test_a_declared_image_that_cannot_be_parsed_is_refused_not_admitted(self):
        # Correct PNG signature, garbage after it. Failing OPEN here would make
        # the gate decorative: a malformed file would be the one way past it.
        upload = SimpleUploadedFile(
            "broken.png", b"\x89PNG\r\n\x1a\n" + b"\x00" * 64, content_type="image/png"
        )
        with pytest.raises(InvalidInputError) as error:
            validate_image(upload, spec=EVENT_IMAGE_SPEC)
        assert "could not be read" in str(error.value)


class TestTheSpecIsReusable:
    def test_a_different_slot_can_demand_a_different_shape(self):
        # The point of `ImageSpec` being a parameter: a square-logo slot is one
        # value, not a second copy of the gate.
        square = ImageSpec(
            label="logo",
            min_width=400,
            min_height=400,
            min_ratio=0.9,
            max_ratio=1.1,
            recommended_width=800,
            recommended_height=800,
        )
        validate_dimensions(png(800, 800), square)
        with pytest.raises(InvalidInputError):
            validate_dimensions(png(1920, 1080), square)


@pytest.mark.parametrize(
    ("ratio", "expected"),
    [(0.67, "taller than it is wide"), (1.0, "close to square"), (3.0, "much wider")],
)
def test_a_wrong_shape_is_named_in_words_somebody_can_check(ratio, expected):
    # "aspect ratio 0.67" is a number nobody chose and cannot act on.
    assert expected in describe_shape(ratio)


class TestTheRefusalDescribesTheSlotItIsRefusingFor:
    """The message is built from the SPEC, not from the one slot that existed
    when it was written.

    Every clause used to be hard-coded landscape: "has to be landscape",
    "shown in the same widescreen frame", "(16:9)". That was true of
    `EVENT_IMAGE_SPEC` and became a contradiction the moment a second spec
    landed — `CREW_PORTRAIT_SPEC` told anyone uploading a landscape headshot
    that the crew photo "has to be landscape - between 0.6:1 and 1.05:1", which
    is impossible on its face. No test covered it because the assertions here
    only ever used the event spec.
    """

    def test_a_landscape_upload_to_a_PORTRAIT_slot_is_not_told_to_make_it_landscape(self):
        with pytest.raises(InvalidInputError) as refusal:
            validate_dimensions(png(1920, 1080), EVENT_PORTRAIT_SPEC)

        message = str(refusal.value)
        assert "has to be portrait" in message
        # The exact sentence that used to be produced, asserted as ABSENT.
        assert "has to be landscape" not in message

    def test_the_recommended_ratio_is_computed_not_the_literal_16_9(self):
        with pytest.raises(InvalidInputError) as refusal:
            validate_dimensions(png(1920, 1080), EVENT_PORTRAIT_SPEC)

        message = str(refusal.value)
        # 1200x1600 reduces to 3:4. It used to say "(16:9)" for every spec.
        assert "1200 x 1600 (3:4)" in message
        assert "16:9" not in message

    def test_the_crew_spec_no_longer_contradicts_itself(self):
        """The live bug this fixes. A headshot band straddles 1.0, so neither
        "portrait" nor "square" alone is true — it says both."""
        with pytest.raises(InvalidInputError) as refusal:
            validate_dimensions(png(1920, 1080), CREW_PORTRAIT_SPEC)

        message = str(refusal.value)
        assert "portrait or square" in message
        assert "has to be landscape" not in message

    def test_the_event_spec_still_says_landscape(self):
        """The fix must not have changed the message that was already right."""
        with pytest.raises(InvalidInputError) as refusal:
            validate_dimensions(png(1200, 1600), EVENT_IMAGE_SPEC)

        assert "has to be landscape" in str(refusal.value)

    def test_each_spec_names_its_own_frame(self):
        """The "because …" clause is the part that tells somebody WHY, and one
        shared sentence about "the event page" is wrong for a lineup card."""
        with pytest.raises(InvalidInputError) as refusal:
            validate_dimensions(png(1920, 1080), CREW_PORTRAIT_SPEC)

        assert "picture of a forehead" in str(refusal.value)


class TestThePortraitPosterSlot:
    """`EVENT_PORTRAIT_SPEC` — the primary mobile visual.

    It exists because `MOBILE` was the one media kind named for phones and the
    one kind that could not be shaped for them: every image went through the
    landscape spec.
    """

    def test_it_accepts_the_two_shapes_organisers_actually_have(self):
        # 2:3 is a print poster and the shape of the mobile deck's own cards;
        # 3:4 is the brief's ratio. Demanding exactly one would refuse the
        # other, so the band covers both.
        validate_dimensions(png(1200, 1800), EVENT_PORTRAIT_SPEC)  # 2:3
        validate_dimensions(png(1200, 1600), EVENT_PORTRAIT_SPEC)  # 3:4

    def test_it_refuses_a_landscape_export(self):
        with pytest.raises(InvalidInputError):
            validate_dimensions(png(1920, 1080), EVENT_PORTRAIT_SPEC)

    def test_it_refuses_a_square_one(self):
        """A square crop in a tall frame is either letterboxed or cropped to a
        detail nobody chose."""
        with pytest.raises(InvalidInputError):
            validate_dimensions(png(1200, 1200), EVENT_PORTRAIT_SPEC)

    def test_its_floor_is_lower_than_the_landscape_one(self):
        """A portrait poster is drawn at card width on a phone. A 1280px
        minimum would refuse good artwork to protect a 200px card."""
        validate_dimensions(png(800, 1000), EVENT_PORTRAIT_SPEC)
        with pytest.raises(InvalidInputError):
            validate_dimensions(png(400, 500), EVENT_PORTRAIT_SPEC)
