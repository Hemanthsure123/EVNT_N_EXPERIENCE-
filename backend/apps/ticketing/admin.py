from django.contrib import admin

from .models import TicketType


@admin.register(TicketType)
class TicketTypeAdmin(admin.ModelAdmin):
    list_display = [
        "name",
        "event",
        "price_minor",
        "early_bird_price_minor",
        "quantity",
        "sold",
        "reserved",
        "created_at",
    ]
    list_filter = ["sale_start", "sale_end", "early_bird_ends_at"]
    search_fields = ["name"]
    readonly_fields = ["id", "sold", "reserved", "version", "created_at", "updated_at"]
    list_select_related = ["event"]
    ordering = ["-created_at"]
