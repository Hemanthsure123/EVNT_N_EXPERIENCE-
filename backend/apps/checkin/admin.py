from django.contrib import admin

from .models import ScanLog


@admin.register(ScanLog)
class ScanLogAdmin(admin.ModelAdmin):
    list_display = ("id", "ticket_id", "event_id", "result", "gate", "scanned_at")
    list_filter = ("result",)
    search_fields = ("ticket_id", "event_id", "gate")
    date_hierarchy = "scanned_at"
    # Append-only audit trail — never editable from the admin.
    readonly_fields = ("id", "ticket", "event", "scanned_by", "scanned_at", "gate", "result")

    def has_add_permission(self, request) -> bool:
        return False

    def has_change_permission(self, request, obj=None) -> bool:
        return False
