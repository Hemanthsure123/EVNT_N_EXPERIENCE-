"""Read-only queries.

Empty on purpose: support lists are per-viewer and security-sensitive, so they
are never cached and there is no denormalised read model to build. The
repository's `list_for_*` methods ARE the read side, and they are called
straight from the views through the service's access checks.
"""
