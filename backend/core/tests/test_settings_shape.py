"""The deploy gate reads the REAL settings module — so test against that.

`test_preflight.py` exercises the checks with a hand-built `_Settings` double.
That is the right shape for testing the RULES, and it has one blind spot: the
double sets whatever attribute the test needs, so a check that reads a name the
real settings module never defines still passes.

That blind spot shipped. `JWT_SIGNING_KEY` existed only as
`SIMPLE_JWT["SIGNING_KEY"]`, so `getattr(settings, "JWT_SIGNING_KEY", "")`
returned `""` regardless of configuration. Two consequences, both silent:

  1. Production could NEVER boot — the gate reported "JWT_SIGNING_KEY is not
     set" on a correctly configured deployment. Found on the first real
     production boot attempt, which is the most expensive possible moment.
  2. The length and shipped-placeholder checks for the key that signs every
     session token had never once run against a real value.

These tests close the gap for every name the gate reads.
"""

from __future__ import annotations

import pytest
from django.conf import settings

from core.preflight import _ADAPTER_CREDENTIALS, _FAKE_BACKENDS, _REQUIRED_SECRETS


@pytest.mark.parametrize("name", [name for name, _ in _REQUIRED_SECRETS])
def test_every_required_secret_exists_on_the_real_settings_module(name):
    """`getattr(settings, name)` is exactly how preflight reads these. A name
    that lives only inside a dict reads as absent and the gate reports a
    correctly configured deployment as broken."""
    assert hasattr(settings, name), (
        f"core/preflight.py validates {name} with getattr(settings, ...), but "
        f"config/settings/base.py never defines it at module level. The gate "
        f"would report it missing no matter what is configured."
    )


def test_the_jwt_signing_key_reaches_simplejwt():
    """The reason it lived in the dict in the first place. Promoting it to a
    module-level setting must not disconnect it from the thing that signs
    tokens."""
    assert settings.SIMPLE_JWT["SIGNING_KEY"] == settings.JWT_SIGNING_KEY
    assert settings.SIMPLE_JWT["SIGNING_KEY"], "tokens would be signed with an empty key"


@pytest.mark.parametrize("switch", sorted(_FAKE_BACKENDS))
def test_every_backend_switch_exists_on_the_real_settings_module(switch):
    """Same failure mode: a switch the gate reads but settings never defines
    would make preflight silently skip that adapter's fake check."""
    assert hasattr(
        settings, switch
    ), f"preflight reads {switch} but config/settings/base.py does not define it"


@pytest.mark.parametrize(
    "credential",
    sorted({name for credentials in _ADAPTER_CREDENTIALS.values() for name in credentials}),
)
def test_every_adapter_credential_exists_on_the_real_settings_module(credential):
    """A credential the gate cannot see is a credential it cannot require —
    the adapter is then selected without it and fails on the first request,
    which for payments is somebody's first checkout."""
    assert hasattr(settings, credential), (
        f"preflight requires {credential} for an adapter, but "
        f"config/settings/base.py does not define it at module level"
    )


def test_the_environment_label_is_a_module_level_setting():
    """Read by the gate to confirm ENVIRONMENT and the settings module agree,
    and used to tag every Sentry event."""
    assert hasattr(settings, "ENVIRONMENT")


def test_the_database_aliases_the_gate_inspects_exist():
    """`default` is the pooled runtime connection; `direct` is session mode,
    used by migrations and by the check that production is not pointed at a
    development container."""
    assert "default" in settings.DATABASES
    assert "direct" in settings.DATABASES
