from django.contrib import admin

from .models import SalePhase, TicketType


class SalePhaseInline(admin.TabularInline):
    model = SalePhase
    extra = 0
    fields = ("position", "name", "price_minor", "ends_at", "quantity")
    readonly_fields = fields
    can_delete = False

    def has_add_permission(self, request, obj=None) -> bool:
        # Operator visibility only — the schedule is edited through the API,
        # where the service enforces the cross-phase rules.
        return False


@admin.register(TicketType)
class TicketTypeAdmin(admin.ModelAdmin):
    list_display = [
        "name",
        "event",
        "price_minor",
        "quantity",
        "sold",
        "reserved",
        "created_at",
    ]
    list_filter = ["sale_start", "sale_end"]
    search_fields = ["name"]
    readonly_fields = ["id", "sold", "reserved", "version", "created_at", "updated_at"]
    list_select_related = ["event"]
    ordering = ["-created_at"]
    inlines = [SalePhaseInline]
