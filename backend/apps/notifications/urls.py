"""The module's only routes: this device's push subscription.

Everything else in `notifications` is internal (event- and job-driven). A
push subscription is the one thing only the browser can create, so it needs
somewhere to hand it over — see api.py.
"""

from __future__ import annotations

from django.urls import path

from . import api

urlpatterns = [
    path("push/config", api.PushConfigView.as_view(), name="push-config"),
    path("me/push/subscriptions", api.PushSubscriptionView.as_view(), name="push-subscriptions"),
    # Called by the service worker, which has no token. See PushRotateView.
    path("push/rotate", api.PushRotateView.as_view(), name="push-rotate"),
]
