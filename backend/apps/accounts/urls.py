from django.urls import path

from . import api

urlpatterns = [
    path("register", api.RegisterView.as_view(), name="auth-register"),
    path("login", api.LoginView.as_view(), name="auth-login"),
    path("refresh", api.RefreshView.as_view(), name="auth-refresh"),
    path("logout", api.LogoutView.as_view(), name="auth-logout"),
    path("me", api.MeView.as_view(), name="auth-me"),
]
