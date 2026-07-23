"""Settings used by pytest. Always fakes every external vendor, no matter what
.env says, so the test suite is deterministic, hermetic and needs zero
credentials."""

from .base import *  # noqa: F403

DEBUG = False

PAYMENTS_BACKEND = "fake"
STORAGE_BACKEND = "local"
QUEUE_BACKEND = "local"
EVENT_BUS_BACKEND = "inprocess"
EMAIL_PROVIDER = "console"
SMS_PROVIDER = "console"
CACHE_BACKEND = "locmem"

PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
