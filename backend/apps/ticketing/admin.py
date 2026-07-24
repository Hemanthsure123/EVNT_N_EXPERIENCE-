from django.contrib import admin

from .models import TicketType


@admin.register(TicketType)
class TicketTypeAdmin(admin.ModelAdmin):
    list_display = ["name", "event", "price_minor", "quantity", "sold", "reserved", "created_at"]
    list_filter = ["sale_start", "sale_end"]
    search_fields = ["name"]
    readonly_fields = ["id", "sold", "reserved", "version", "created_at", "updated_at"]
    list_select_related = ["event"]
    ordering = ["-created_at"]
