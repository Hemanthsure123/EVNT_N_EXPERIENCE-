"""Thin views: parse/validate at the boundary (schemas.py), call a service or
selector, serialize the result. No business rules live here."""

from __future__ import annotations

from typing import cast
from urllib.parse import urlencode

from django.conf import settings
from django.http import HttpResponseRedirect
from django.shortcuts import redirect
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from config.di import (
    build_auth_service,
    build_email_verification_service,
    build_google_sign_in_service,
    build_profile_service,
)
from core.errors import DomainError, InvalidInputError
from core.throttling import AuthThrottle, OtpThrottle, UploadThrottle, WriteThrottle

from .models import User
from .schemas import (
    AuthResponseSerializer,
    GoogleSignInConfigSerializer,
    GoogleSignInRedeemSerializer,
    LoginRequestSerializer,
    LogoutRequestSerializer,
    RefreshRequestSerializer,
    RegisterRequestSerializer,
    RegistrationResponseSerializer,
    ResendVerificationRequestSerializer,
    TokenPairSerializer,
    UpdateProfileSerializer,
    UserSerializer,
    VerifyEmailRequestSerializer,
)
from .selectors import get_profile


class RegisterView(APIView):
    permission_classes = [AllowAny]
    # IP-keyed and deliberately tight. Without it this endpoint is an
    # unmetered password oracle; a human signing in never comes close.
    throttle_classes = [AuthThrottle]

    @extend_schema(
        request=RegisterRequestSerializer, responses={201: RegistrationResponseSerializer}
    )
    def post(self, request: Request) -> Response:
        """Create the account and email a verification code. Issues NO tokens.

        Registration used to return a session immediately. With verification
        required that would make the whole step optional — a caller could keep
        the token and never open the email — so the session is withheld until
        the address is proven. `POST /auth/verify-email` returns it.
        """
        payload = RegisterRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)

        user = build_auth_service().register(**payload.validated_data)

        return Response(
            {
                "user": UserSerializer(user).data,
                "verification_required": True,
                "message": f"We sent a 6-digit code to {user.email}.",
            },
            status=status.HTTP_201_CREATED,
        )


class LoginView(APIView):
    permission_classes = [AllowAny]
    # IP-keyed and deliberately tight. Without it this endpoint is an
    # unmetered password oracle; a human signing in never comes close.
    throttle_classes = [AuthThrottle]

    @extend_schema(request=LoginRequestSerializer, responses={200: AuthResponseSerializer})
    def post(self, request: Request) -> Response:
        payload = LoginRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)

        service = build_auth_service()
        user = service.authenticate(**payload.validated_data)
        tokens = service.issue_tokens(user)

        return Response(
            {
                "user": UserSerializer(user).data,
                "tokens": TokenPairSerializer(tokens.as_dict()).data,
            },
            status=status.HTTP_200_OK,
        )


class RefreshView(APIView):
    permission_classes = [AllowAny]
    # IP-keyed and deliberately tight. Without it this endpoint is an
    # unmetered password oracle; a human signing in never comes close.
    throttle_classes = [AuthThrottle]

    @extend_schema(request=RefreshRequestSerializer, responses={200: TokenPairSerializer})
    def post(self, request: Request) -> Response:
        payload = RefreshRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)

        service = build_auth_service()
        tokens = service.refresh_tokens(payload.validated_data["refresh"])

        return Response(TokenPairSerializer(tokens.as_dict()).data, status=status.HTTP_200_OK)


class LogoutView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(request=LogoutRequestSerializer, responses={204: None})
    def post(self, request: Request) -> Response:
        payload = LogoutRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)

        service = build_auth_service()
        # IsAuthenticated guarantees request.user is a real User, not
        # AnonymousUser — DRF's stubs type it as the broader union.
        service.logout(
            user=cast(User, request.user), refresh_token=payload.validated_data["refresh"]
        )

        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(responses={200: UserSerializer})
    def get(self, request: Request) -> Response:
        profile = get_profile(cast(User, request.user))
        return Response(UserSerializer(profile).data)

    @extend_schema(request=UpdateProfileSerializer, responses={200: UserSerializer})
    def patch(self, request: Request) -> Response:
        """Change the display name and/or the phone number.

        A real PATCH: only the keys actually present in the body are forwarded,
        so omitting a field leaves it alone while sending `""` clears it.
        `serializer.validated_data` already contains only what was sent —
        `required=False` with no `default` means an absent key stays absent
        rather than arriving as an empty string, which is what makes the two
        cases distinguishable at all.

        Answers with the FULL profile rather than 204 or just the changed
        fields, matching `MeAvatarView` below and for the same reason: the
        caller is a settings screen holding a cached user object, and the same
        shape `/auth/me` returns lets it replace that object outright instead
        of patching one field into it.
        """
        payload = UpdateProfileSerializer(data=request.data, partial=True)
        payload.is_valid(raise_exception=True)

        user = cast(User, request.user)
        updated = build_profile_service().update_profile(user_id=user.id, **payload.validated_data)
        return Response(UserSerializer(updated).data)


class MeOnboardingView(APIView):
    """POST /auth/me/onboarding — the welcome flow has been answered.

    ── WHY IT IS A SEPARATE CALL FROM THE PROFILE PATCH ───────────────────

    The two say different things. A PATCH says "this is my name"; this says
    "stop asking me". Somebody who fills nothing in and presses Skip has
    ANSWERED — and folding the mark into `update_profile` would mean the only
    way to record that answer is to also send an empty edit, so a skip would
    look identical to a request that never arrived.

    It carries no body. Everything the flow collects goes through the ordinary
    profile PATCH, which already validates every field; a second write path for
    the same columns would be a second place for the date-of-birth rules to
    live.
    """

    permission_classes = [IsAuthenticated]

    @extend_schema(request=None, responses={200: UserSerializer})
    def post(self, request: Request) -> Response:
        updated = build_profile_service().complete_onboarding(user_id=cast(User, request.user).id)
        return Response(UserSerializer(updated).data)


class MeAvatarView(APIView):
    """The signed-in user's own profile picture: set it, or remove it.

    Multipart only on the way in — this endpoint exists to receive a file, and
    accepting JSON would produce a confusing 400 for whoever guessed wrong.

    BOTH methods answer with the full profile rather than 204/just the URL.
    The caller is a settings screen that holds a cached user object, and
    handing back the same shape `/auth/me` returns means it replaces that
    object outright instead of patching one field into it — the same reason
    saved-events returns the whole set rather than what changed.
    """

    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def get_throttles(self) -> list:
        """The upload budget covers the UPLOAD; clearing spends the write one.

        `throttle_classes = [UploadThrottle]` would apply to DELETE too, so
        somebody toggling a picture off and on could exhaust their own upload
        budget with requests that transfer no bytes and cost no storage —
        locking themselves out of the very thing the budget is protecting.
        """
        return [UploadThrottle()] if self.request.method == "POST" else [WriteThrottle()]

    @extend_schema(request=None, responses={200: UserSerializer})
    def post(self, request: Request) -> Response:
        upload = request.FILES.get("file")
        if upload is None:
            raise InvalidInputError("No file was uploaded — send one as `file`.")

        user = build_profile_service().set_avatar(
            user_id=cast(User, request.user).id, upload=upload
        )
        return Response(UserSerializer(user).data, status=status.HTTP_200_OK)

    @extend_schema(responses={200: UserSerializer})
    def delete(self, request: Request) -> Response:
        user = build_profile_service().clear_avatar(user_id=cast(User, request.user).id)
        return Response(UserSerializer(user).data, status=status.HTTP_200_OK)


class VerifyEmailView(APIView):
    """Prove an address with the emailed code, and sign in.

    UNAUTHENTICATED by design: somebody who registered, closed the tab and
    came back has no session, and requiring one would strand exactly the
    people this screen exists for. The code IS the credential here, and it is
    bounded by expiry, a per-code attempt budget and this throttle.

    Returns tokens on success, so verifying is also the moment of sign-in
    rather than a step followed by a second login.
    """

    permission_classes = [AllowAny]
    # The OTP scope, not the auth one: a legitimate user retypes a code a few
    # times, and sharing a budget with login would lock them out of both.
    throttle_classes = [OtpThrottle]

    @extend_schema(request=VerifyEmailRequestSerializer, responses={200: AuthResponseSerializer})
    def post(self, request: Request) -> Response:
        payload = VerifyEmailRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)

        user = build_email_verification_service().verify_for_email(**payload.validated_data)
        tokens = build_auth_service().issue_tokens(user)

        return Response(
            {
                "user": UserSerializer(user).data,
                "tokens": TokenPairSerializer(tokens.as_dict()).data,
            },
            status=status.HTTP_200_OK,
        )


class ResendVerificationView(APIView):
    """Issue a fresh code for an address.

    Answers 202 whether or not an account exists — but does surface the
    cooldown, because `POST /auth/register` already reveals whether an address
    is taken, so being cagey here would cost the user real feedback and buy
    no secrecy.
    """

    permission_classes = [AllowAny]
    throttle_classes = [OtpThrottle]

    @extend_schema(
        request=ResendVerificationRequestSerializer,
        responses={202: ResendVerificationRequestSerializer},
    )
    def post(self, request: Request) -> Response:
        payload = ResendVerificationRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)

        build_email_verification_service().request_code_for_email(**payload.validated_data)

        return Response({"email": payload.validated_data["email"]}, status=status.HTTP_202_ACCEPTED)


# ── SIGN IN WITH GOOGLE ───────────────────────────────────────────────────


class GoogleSignInConfigView(APIView):
    """Whether this deployment can offer Google sign-in.

    The frontend asks BEFORE rendering the button. Without this it would have
    to either always show a control that might 503, or hard-code a guess about
    the backend's configuration — the pattern Web Push already uses for the
    same reason.
    """

    permission_classes = [AllowAny]

    @extend_schema(responses={200: GoogleSignInConfigSerializer})
    def get(self, request: Request) -> Response:
        return Response({"available": build_google_sign_in_service().is_available()})


class GoogleSignInStartView(APIView):
    """Mint the consent URL and send the browser to Google.

    A REDIRECT rather than a JSON payload containing the URL: the browser has
    to end up at Google either way, and returning the URL would mean the SPA
    holds a one-shot credential (the state) it might log, retry or share.
    """

    permission_classes = [AllowAny]
    throttle_classes = [AuthThrottle]

    @extend_schema(responses={302: None})
    def get(self, request: Request) -> HttpResponseRedirect:
        service = build_google_sign_in_service()
        url = service.start(
            next_path=request.query_params.get("next", ""),
            login_hint=request.query_params.get("login_hint", ""),
        )
        return redirect(url)


class GoogleSignInCallbackView(APIView):
    """Where Google returns the browser.

    Unauthenticated by necessity — the browser arrives with no token of ours,
    which is exactly why `state` is random, server-side, single-use and
    consumed before any work happens.

    ── WHY THE TOKENS ARE NOT IN THIS REDIRECT ──────────────────────────

    The obvious implementation puts the access/refresh pair in the URL. Both
    places you can put them are wrong: the QUERY string reaches server logs
    and the `Referer` header of the next request, and the FRAGMENT lands in
    browser history. Either leaves a full session lying around in plain text.

    So the session is stored under a one-time handoff code and only that
    travels in the URL. It is single-use, expires in two minutes, and is
    worthless once redeemed — a leaked one buys nothing.
    """

    permission_classes = [AllowAny]

    @extend_schema(responses={302: None})
    def get(self, request: Request) -> HttpResponseRedirect:
        site = settings.PUBLIC_SITE_URL or ""
        service = build_google_sign_in_service()

        try:
            handoff, next_path = service.complete(
                state=request.query_params.get("state", ""),
                code=request.query_params.get("code", ""),
                error=request.query_params.get("error", ""),
            )
        except DomainError as exc:
            # The browser is mid-redirect, so an error ENVELOPE would render as
            # raw JSON in the address bar. The user is returned to sign-in with
            # a code the page can turn into a sentence.
            return redirect(f"{site}/sign-in?{urlencode({'error': exc.code})}")

        query = {"handoff": handoff}
        if next_path:
            query["next"] = next_path
        return redirect(f"{site}/auth/callback?{urlencode(query)}")


class GoogleSignInRedeemView(APIView):
    """Exchange the one-time handoff code for the session it stands for."""

    permission_classes = [AllowAny]
    throttle_classes = [AuthThrottle]

    @extend_schema(request=GoogleSignInRedeemSerializer, responses={200: AuthResponseSerializer})
    def post(self, request: Request) -> Response:
        payload = GoogleSignInRedeemSerializer(data=request.data)
        payload.is_valid(raise_exception=True)

        tokens = build_google_sign_in_service().redeem(**payload.validated_data)

        # The profile is read from the ACCESS TOKEN the handoff produced, not
        # from `request.user` — this endpoint is unauthenticated, and the
        # session belongs to whoever the callback minted it for.
        from rest_framework_simplejwt.tokens import AccessToken

        user_id = AccessToken(tokens.access)["user_id"]  # type: ignore[arg-type]
        user = User.objects.get(pk=user_id)

        return Response(
            {
                "user": UserSerializer(user).data,
                "tokens": TokenPairSerializer(tokens.as_dict()).data,
            },
            status=status.HTTP_200_OK,
        )
