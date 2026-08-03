from django.urls import path

from . import api

urlpatterns = [
    path("register", api.RegisterView.as_view(), name="auth-register"),
    path("login", api.LoginView.as_view(), name="auth-login"),
    path("verify-email", api.VerifyEmailView.as_view(), name="auth-verify-email"),
    path(
        "verify-email/resend",
        api.ResendVerificationView.as_view(),
        name="auth-verify-email-resend",
    ),
    path("refresh", api.RefreshView.as_view(), name="auth-refresh"),
    path("logout", api.LogoutView.as_view(), name="auth-logout"),
    path("me", api.MeView.as_view(), name="auth-me"),
    # POST sets the profile picture (multipart, field `file`); DELETE clears it.
    # One path with two methods rather than `.../avatar` and `.../avatar/clear`:
    # it is one resource, and DELETE already means what the second path would.
    path("me/avatar", api.MeAvatarView.as_view(), name="auth-me-avatar"),
    # Sign in with Google.
    #
    # NAMESPACED UNDER `.../google/signin/` because `apps.integrations` already
    # owns `/api/v1/auth/oauth/google/callback` for CONNECTING A CALENDAR — a
    # URI already registered with Google. `accounts` is mounted before
    # `integrations` in config/urls.py, so a bare `oauth/google/callback` here
    # SHADOWED the calendar callback and silently broke calendar connection.
    # Caught by apps/integrations' own callback test.
    #
    # This path must be registered VERBATIM in the Google console as a second
    # authorized redirect URI, and must match GOOGLE_OAUTH_SIGNIN_REDIRECT_URI.
    path(
        "oauth/google/signin/config",
        api.GoogleSignInConfigView.as_view(),
        name="auth-google-config",
    ),
    path(
        "oauth/google/signin/start",
        api.GoogleSignInStartView.as_view(),
        name="auth-google-start",
    ),
    path(
        "oauth/google/signin/callback",
        api.GoogleSignInCallbackView.as_view(),
        name="auth-google-callback",
    ),
    path(
        "oauth/google/signin/redeem",
        api.GoogleSignInRedeemView.as_view(),
        name="auth-google-redeem",
    ),
]
