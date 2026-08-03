import sys

from .base import *  # noqa: F403

DEBUG = True

# Convenient for local frontend dev against a Next.js dev server.
CORS_ALLOW_ALL_ORIGINS = True

# The development half of the deploy gate.
#
# `DEBUG=True` and `CORS_ALLOW_ALL_ORIGINS = True` above are correct for
# development and catastrophic over production data — a 500 renders every
# secret to the caller, and any site can call the API with a victim's token.
# Neither is an error on its own, so nothing would ever report the pair.
# See core/preflight.py.
from core.preflight import check_development_settings  # noqa: E402

check_development_settings(sys.modules[__name__])
