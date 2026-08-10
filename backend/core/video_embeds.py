"""Turning a pasted video link into something safe to put in an iframe.

── WHY A VIDEO IS A LINK AND NOT AN UPLOAD ───────────────────────────────

`MediaKind.VIDEO` existed from the start and was UNREACHABLE: the only route
to it was the media upload endpoint, and that runs `validate_image`, which
refuses anything that is not a JPEG/PNG/WebP/AVIF/GIF. So the kind always
422'd — a choice in the API that could never be exercised.

Two ways to fix that, and hosting the bytes ourselves is the wrong one. A
trailer is 50-200 MB, needs transcoding to several renditions, needs a player,
and needs a CDN with per-GB egress this platform has not configured. What
organisers actually have is a YouTube or Vimeo link, which is also what every
comparable platform embeds. So `video` is a URL, attached through the ordinary
JSON media endpoint, and the upload endpoint says so rather than failing with a
message about image formats.

── AND WHY THE HOST IS AN ALLOW-LIST ─────────────────────────────────────

An arbitrary URL rendered in an `<iframe>` on our own origin is the same class
of problem SVG uploads are: somebody else's document, executing beside ours,
with our origin's user in front of it. So only the two hosts with a documented,
sandboxed embed endpoint are accepted, the id is extracted and validated, and
the URL we store is one WE build — never the one that was pasted.

That last part is the point. Normalising to a canonical embed URL means a
crafted `youtube.com/embed/...?javascript=` cannot survive the round trip: the
query string is discarded and only an id matching a strict character class is
carried across.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import parse_qs, urlparse

from core.errors import InvalidInputError

#: YouTube ids are 11 characters of an unreserved alphabet. Vimeo's are digits.
#: Both patterns are anchored, so anything carrying a `?`, a `/` or a quote is
#: rejected rather than escaped — there is no escaping story here, only a
#: matching one.
_YOUTUBE_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
_VIMEO_ID = re.compile(r"^[0-9]{6,12}$")

_YOUTUBE_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "www.youtu.be"}
_VIMEO_HOSTS = {"vimeo.com", "www.vimeo.com", "player.vimeo.com"}


@dataclass(frozen=True)
class VideoEmbed:
    """A link we are willing to render."""

    provider: str
    video_id: str
    #: The URL to put in the iframe — BUILT here, never the pasted one.
    embed_url: str
    #: Where to send somebody who would rather watch it on the source site.
    watch_url: str


def parse_video_url(raw: str) -> VideoEmbed:
    """Normalise a pasted link, or refuse it with a sentence worth reading.

    Accepts every shape a person actually pastes — a watch link, a share link,
    a shortened `youtu.be`, an embed URL, a Vimeo player URL — because telling
    somebody their link is "invalid" when it is the one the Share button gave
    them is how a field gets abandoned.
    """
    url = (raw or "").strip()
    if not url:
        raise InvalidInputError("Paste a YouTube or Vimeo link.")
    if "://" not in url:
        # A bare `youtu.be/abc` is what a copy-paste from a phone often gives.
        url = f"https://{url}"

    try:
        parsed = urlparse(url)
    except ValueError as exc:  # pragma: no cover — urlparse is very forgiving
        raise InvalidInputError("That does not look like a link.") from exc

    if parsed.scheme not in ("http", "https"):
        # `javascript:` and `data:` are the reason this is checked at all.
        raise InvalidInputError("A video link has to start with https://.")

    host = (parsed.hostname or "").lower()
    if host in _YOUTUBE_HOSTS:
        return _youtube(parsed)
    if host in _VIMEO_HOSTS:
        return _vimeo(parsed)
    raise InvalidInputError(
        "Only YouTube and Vimeo links can be embedded. Upload the video there "
        "and paste the link, or add a poster image instead."
    )


def _youtube(parsed) -> VideoEmbed:
    host = (parsed.hostname or "").lower()
    path = parsed.path.strip("/")

    if host in ("youtu.be", "www.youtu.be"):
        video_id = path.split("/")[0]
    elif path.startswith(("embed/", "v/", "shorts/", "live/")):
        video_id = path.split("/", 1)[1].split("/")[0]
    else:
        video_id = (parse_qs(parsed.query).get("v") or [""])[0]

    if not _YOUTUBE_ID.match(video_id):
        raise InvalidInputError(
            "That YouTube link does not contain a video id. Use the Share button's link."
        )
    return VideoEmbed(
        provider="youtube",
        video_id=video_id,
        # `youtube-nocookie.com` on purpose: it is YouTube's own privacy-
        # enhanced host and it does not set tracking cookies until the viewer
        # presses play, which is what makes embedding it defensible on a page
        # nobody consented to be tracked on.
        embed_url=f"https://www.youtube-nocookie.com/embed/{video_id}",
        watch_url=f"https://www.youtube.com/watch?v={video_id}",
    )


def _vimeo(parsed) -> VideoEmbed:
    path = parsed.path.strip("/")
    # `vimeo.com/123456789`, `vimeo.com/channels/x/123456789` and
    # `player.vimeo.com/video/123456789` all end in the id.
    candidate = path.rsplit("/", 1)[-1] if path else ""
    if not _VIMEO_ID.match(candidate):
        raise InvalidInputError(
            "That Vimeo link does not contain a video id. Use the Share button's link."
        )
    return VideoEmbed(
        provider="vimeo",
        video_id=candidate,
        embed_url=f"https://player.vimeo.com/video/{candidate}",
        watch_url=f"https://vimeo.com/{candidate}",
    )
