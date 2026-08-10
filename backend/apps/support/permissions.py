"""DRF permission classes.

Deliberately empty. Every access rule here depends on the ROW — whose query it
is, which organization owns its event, which audience it was addressed to — so
it lives in `SupportService`, which already loads that row. A DRF
`has_object_permission` would mean fetching the same query twice per request;
see the same decision recorded in `apps/organizations/permissions.py`.
"""
