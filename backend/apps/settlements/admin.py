from django.contrib import admin

from .models import PayoutAttempt, Settlement


@admin.register(Settlement)
class SettlementAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "event_id",
        "gross",
        "platform_fee",
        "refunds",
        "net",
        "status",
        "payout_at",
    )
    list_filter = ("status",)
    search_fields = ("event_id", "provider_ref")
    date_hierarchy = "created_at"
    # A financial record — never edited by hand from the admin.
    readonly_fields = tuple(f.name for f in Settlement._meta.fields)

    def has_add_permission(self, request) -> bool:
        return False

    def has_change_permission(self, request, obj=None) -> bool:
        return False


@admin.register(PayoutAttempt)
class PayoutAttemptAdmin(admin.ModelAdmin):
    list_display = ("id", "settlement_id", "amount_minor", "status", "provider_ref", "created_at")
    list_filter = ("status",)
    search_fields = ("settlement_id", "provider_ref")
    date_hierarchy = "created_at"
    readonly_fields = tuple(f.name for f in PayoutAttempt._meta.fields)

    def has_add_permission(self, request) -> bool:
        return False

    def has_change_permission(self, request, obj=None) -> bool:
        return False
