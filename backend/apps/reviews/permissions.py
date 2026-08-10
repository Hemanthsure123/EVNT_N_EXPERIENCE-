"""No DRF permission classes.

Ownership here is decided inside the service, which loads the review once and
checks `user_id` on the row it already has — the same reasoning
`organizations` documents: a `has_object_permission` on a separately
`get_object()`-fetched instance means fetching the same row twice per request.

Staff-only endpoints use DRF's own `IsAdminUser`, so there is nothing to
subclass.
"""
