from django.contrib import admin

from .models import NotificationLog


@admin.register(NotificationLog)
class NotificationLogAdmin(admin.ModelAdmin):
    list_display = ("id", "type", "channel", "recipient", "status", "attempts", "sent_at")
    list_filter = ("status", "channel", "type")
    search_fields = ("dedupe_key", "recipient", "provider_ref")
    date_hierarchy = "created_at"
    # An audit + idempotency ledger — never edited by hand from the admin.
    readonly_fields = tuple(f.name for f in NotificationLog._meta.fields)

    def has_add_permission(self, request) -> bool:
        return False

    def has_change_permission(self, request, obj=None) -> bool:
        return False
