"""Module-specific errors.

Deliberately empty. Every refusal this module makes is one of the shared kinds
— `InvalidInputError` for an ineligible submission, `ConflictError` for a
duplicate, `NotFoundError` for a missing event or review — and a subclass that
only renames one of those adds a code the frontend has to learn for no new
meaning. The eligibility REASON carries the specificity instead, on the
response body where a client can switch on it.
"""
