"""The module's only HTTP surface: managing this device's push subscription.

`notifications` is otherwise internal — event- and job-driven, with no REST
routes, which is still true of every notification it sends. These three
endpoints exist because a push subscription can only be created by the
browser that owns it, so there has to be somewhere to hand it over.

Nothing here can trigger a send. That matters: an endpoint that let a caller
push to a user would be an endpoint for putting arbitrary text on somebody
else's lock screen.
"""

from __future__ import annotations

from typing import cast

from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from config.di import push_port
from core.errors import InvalidInputError
from core.throttling import AnonWriteThrottle, WriteThrottle

from .repositories import PushSubscriptionRepository
from .schemas import (
    PushConfigSerializer,
    PushRotateRequestSerializer,
    PushSubscriptionRequestSerializer,
    PushSubscriptionSerializer,
)


def _private(response: Response) -> Response:
    """A person's device list is theirs. Never a shared cache."""
    response["Cache-Control"] = "private, no-store"
    return response


class PushConfigView(APIView):
    """Whether push is available here, and the key needed to subscribe.

    The frontend asks BEFORE offering anything. That ordering is the whole
    reason this endpoint exists: without it the UI has to assume push works,
    ask the browser for a permission it may not be able to honour, and then
    say "notifications are on" when nothing could ever be sent — which is
    exactly the state this audit found and removed.

    Unauthenticated: it carries no user data, and the VAPID public key is
    public by design — every subscribing browser receives it.
    """

    permission_classes: list = []
    authentication_classes: list = []

    @extend_schema(responses={200: PushConfigSerializer})
    def get(self, request: Request) -> Response:
        port = push_port()
        return _private(
            Response(
                PushConfigSerializer(
                    {"enabled": port.is_configured(), "public_key": port.public_key()}
                ).data
            )
        )


class PushSubscriptionView(APIView):
    """Register or remove THIS browser's subscription.

    Both operations are scoped to the authenticated user. A push endpoint is
    an unguessable URL but it is not a secret the way a token is — it travels
    through the browser and can end up in logs — so the user id authorises the
    write, never the endpoint alone.
    """

    permission_classes = [IsAuthenticated]
    throttle_classes = [WriteThrottle]

    @extend_schema(responses={200: PushSubscriptionSerializer(many=True)})
    def get(self, request: Request) -> Response:
        """This account's subscribed devices, so somebody can see and revoke
        them. Metadata only — never `p256dh`/`auth`, which are the material
        that encrypts payloads to that device."""
        rows = PushSubscriptionRepository().list_for_user(cast(User, request.user).id)
        return _private(Response({"data": PushSubscriptionSerializer(rows, many=True).data}))

    @extend_schema(
        request=PushSubscriptionRequestSerializer, responses={201: PushSubscriptionSerializer}
    )
    def post(self, request: Request) -> Response:
        # Refused rather than stored. Accepting a subscription we can never
        # send to is precisely how a user ends up believing they will be told
        # about something.
        if not push_port().is_configured():
            raise InvalidInputError("Push notifications are not enabled on this deployment.")

        payload = PushSubscriptionRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data

        subscription = PushSubscriptionRepository().save_subscription(
            user_id=cast(User, request.user).id,
            endpoint=data["endpoint"],
            p256dh=data["p256dh"],
            auth=data["auth"],
            user_agent=request.META.get("HTTP_USER_AGENT", "")[:255],
        )
        return _private(
            Response(PushSubscriptionSerializer(subscription).data, status=status.HTTP_201_CREATED)
        )

    @extend_schema(request=PushSubscriptionRequestSerializer, responses={204: None})
    def delete(self, request: Request) -> Response:
        """Unsubscribe one device, identified by its endpoint.

        204 whether or not a row was deleted. The browser has already dropped
        its own subscription by the time it calls this, so a 404 would report
        failure for an operation that did exactly what the user wanted — and
        would tell a caller whether an endpoint they supplied exists.
        """
        endpoint = str(request.data.get("endpoint") or "")
        if not endpoint:
            raise InvalidInputError("endpoint is required.")
        PushSubscriptionRepository().delete_by_endpoint(
            user_id=cast(User, request.user).id, endpoint=endpoint
        )
        return _private(Response(status=status.HTTP_204_NO_CONTENT))


class PushRotateView(APIView):
    """Move an existing subscription to a new endpoint. Called by the worker.

    ── WHY THIS IS UNAUTHENTICATED, AND WHY THAT IS SAFE ────────────────────

    A push service can rotate a subscription with no page open. The browser
    fires `pushsubscriptionchange` at the service worker, which is the only
    code that learns about it — and a service worker cannot read an access
    token. So there is no credential available at the one moment this has to
    happen. The alternative is doing nothing, which means the person silently
    stops receiving notifications until they next visit the site.

    Knowledge of the OLD endpoint is the proof, and it is enough because of
    what this endpoint can and cannot do:

    - it can only UPDATE a row that already exists (`update`, never
      `create`), so it cannot subscribe anybody to anything;
    - it never touches `user_id`, so it cannot move a device between
      accounts;
    - an unknown old endpoint is a 204 no-op that reveals nothing.

    The worst an attacker with a stolen old endpoint achieves is
    redirecting that ONE person's notifications to a push endpoint they
    control — and to have the old endpoint at all they already had access to
    that browser, at which point they have the session too. Meanwhile the
    tight rate limit stops the endpoint being used to probe which endpoints
    exist.
    """

    permission_classes: list = []
    authentication_classes: list = []
    # IP-keyed, NOT WriteThrottle: that one keys on the user id and returns
    # None for an anonymous caller, which DRF reads as "do not throttle".
    throttle_classes = [AnonWriteThrottle]

    @extend_schema(request=PushRotateRequestSerializer, responses={204: None})
    def post(self, request: Request) -> Response:
        payload = PushRotateRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data

        PushSubscriptionRepository().rotate_endpoint(
            old_endpoint=data["old_endpoint"],
            endpoint=data["endpoint"],
            p256dh=data["p256dh"],
            auth=data["auth"],
        )
        # 204 whether or not a row matched: an unknown old endpoint must look
        # identical to a known one, or this becomes a way to ask "is this
        # endpoint subscribed?".
        return _private(Response(status=status.HTTP_204_NO_CONTENT))
