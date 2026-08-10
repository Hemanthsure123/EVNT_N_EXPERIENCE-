"""Module-specific errors.

Empty on purpose: every failure this module can produce is one of the shared
`core.errors` kinds — a missing query is `NotFoundError`, an empty body is
`InvalidInputError`, resolving somebody else's thread is
`PermissionDeniedError`. A subclass that only renamed one of those would add a
code without adding a distinction.
"""
