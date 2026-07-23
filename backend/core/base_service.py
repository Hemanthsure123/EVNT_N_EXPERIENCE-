"""Marker base class for services.

Services hold business rules and are constructed with their dependencies
(repositories, ports) injected via `__init__` by config/di.py — never by
importing a repository or vendor client directly. There is no shared
behaviour to put here yet; it exists so every module's service classes have
one common, greppable ancestor as the codebase grows."""

from __future__ import annotations


class BaseService:
    pass
