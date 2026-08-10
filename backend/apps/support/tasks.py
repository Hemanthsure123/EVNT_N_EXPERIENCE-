"""Background work.

Empty on purpose: raising a query and replying to one are both single small
writes on the request path. Notifying the other side goes through
`apps.notifications`, which already owns the outbox, the retry and the
dead-letter behaviour — a second queue here would be a second place for the
same messages to get stuck.
"""
