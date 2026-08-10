from django.contrib import admin

from .models import EventReview


@admin.register(EventReview)
class EventReviewAdmin(admin.ModelAdmin):
    """Read-only on purpose.

    `Event.rating_sum` / `rating_count` count PUBLISHED reviews, and they are
    maintained by `ReviewService`. Editing a rating or flipping a status from
    this screen would change the underlying row without touching the counters,
    so every average on that event would silently become wrong — with no error
    and nothing to attribute it to later.

    Moderation goes through `POST /admin/reviews/{id}/moderation`, which
    adjusts both in one transaction. This page is for LOOKING.
    """

    list_display = ("event", "user", "rating", "status", "verified_attendee", "created_at")
    list_filter = ("status", "rating", "verified_attendee")
    search_fields = ("event__title", "user__email", "body")
    readonly_fields = tuple(field.name for field in EventReview._meta.fields)

    def has_add_permission(self, request) -> bool:
        return False

    def has_change_permission(self, request, obj=None) -> bool:
        return False

    def has_delete_permission(self, request, obj=None) -> bool:
        return False
