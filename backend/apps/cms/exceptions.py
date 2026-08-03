"""CMS-specific domain errors.

`StaleHomepageVersionError` lives in services.py beside the write it guards —
it is meaningless apart from that one conditional UPDATE. This file exists for
module-shape uniformity and for errors that outgrow that.
"""

from __future__ import annotations

from core.errors import ConflictError

__all__ = ["ConflictError"]
