"""Thin views: parse/validate at the boundary (schemas.py), call a service or
selector, serialize the result. No business rules live here."""

from __future__ import annotations

from typing import cast

from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from config.di import build_auth_service

from .models import User
from .schemas import (
    AuthResponseSerializer,
    LoginRequestSerializer,
    LogoutRequestSerializer,
    RefreshRequestSerializer,
    RegisterRequestSerializer,
    TokenPairSerializer,
    UserSerializer,
)
from .selectors import get_profile


class RegisterView(APIView):
    permission_classes = [AllowAny]

    @extend_schema(request=RegisterRequestSerializer, responses={201: AuthResponseSerializer})
    def post(self, request: Request) -> Response:
        payload = RegisterRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)

        service = build_auth_service()
        user = service.register(**payload.validated_data)
        tokens = service.issue_tokens(user)

        return Response(
            {
                "user": UserSerializer(user).data,
                "tokens": TokenPairSerializer(tokens.as_dict()).data,
            },
            status=status.HTTP_201_CREATED,
        )


class LoginView(APIView):
    permission_classes = [AllowAny]

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
