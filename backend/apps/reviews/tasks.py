"""No background tasks.

Considered and rejected: a scheduled job that emails "how was it?" after every
event. The research is clear that post-event feedback requests work best within
hours, so the email would be right — but this platform already has one
notification per booking lifecycle event, and adding an unsolicited one to
every attendee of every event is the notification fatigue the same research
warns about.

The in-app prompt costs nobody an inbox and reaches somebody at the moment they
have chosen to open the app. If response rates prove too low, an email is the
next thing to try, with `notifications`' existing dedupe ledger — not a second
delivery mechanism built here.
"""
