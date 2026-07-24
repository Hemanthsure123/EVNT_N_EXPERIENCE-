"""QR token: signs, verifies, and rejects any tampering. No DB needed."""

from __future__ import annotations

import uuid

from apps.booking.qr import sign_ticket, verify_ticket_token

SECRET = "unit-test-qr-secret"


def test_sign_then_verify_roundtrips_the_ids():
    tid, eid = str(uuid.uuid4()), str(uuid.uuid4())

    token = sign_ticket(ticket_id=tid, event_id=eid, secret=SECRET)
    payload = verify_ticket_token(token, secret=SECRET)

    assert payload is not None
    assert payload.ticket_id == tid
    assert payload.event_id == eid


def test_token_carries_no_pii():
    tid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    token = sign_ticket(ticket_id=tid, event_id=eid, secret=SECRET)
    # Only the two ids are encoded; nothing else (no user, email, name).
    import base64
    import json

    _, payload_b64, _ = token.split(".")
    payload_b64 += "=" * (-len(payload_b64) % 4)
    data = json.loads(base64.urlsafe_b64decode(payload_b64))
    assert set(data.keys()) == {"tid", "eid"}


def test_tampered_payload_is_rejected():
    token = sign_ticket(ticket_id=uuid.uuid4(), event_id=uuid.uuid4(), secret=SECRET)
    version, _payload, signature = token.split(".")
    forged_payload = "eyJ0aWQiOiJoYWNrIiwiZWlkIjoiaGFjayJ9"  # {"tid":"hack","eid":"hack"}

    tampered = f"{version}.{forged_payload}.{signature}"

    assert verify_ticket_token(tampered, secret=SECRET) is None


def test_tampered_signature_is_rejected():
    token = sign_ticket(ticket_id=uuid.uuid4(), event_id=uuid.uuid4(), secret=SECRET)
    version, payload, _sig = token.split(".")

    tampered = f"{version}.{payload}.YWJjZGVm"

    assert verify_ticket_token(tampered, secret=SECRET) is None


def test_wrong_secret_is_rejected():
    token = sign_ticket(ticket_id=uuid.uuid4(), event_id=uuid.uuid4(), secret=SECRET)

    assert verify_ticket_token(token, secret="a-different-secret") is None


def test_malformed_tokens_return_none_without_raising():
    for bad in ["", "not-a-token", "v1.only-two", "v9.abc.def", "a.b.c.d"]:
        assert verify_ticket_token(bad, secret=SECRET) is None
