from django.contrib import admin

from .models import Booking, BookingItem, Ticket


class BookingItemInline(admin.TabularInline):
    model = BookingItem
    extra = 0
    readonly_fields = ["ticket_type", "quantity", "unit_price_minor", "phase_name"]
    can_delete = False


@admin.register(Booking)
class BookingAdmin(admin.ModelAdmin):
    list_display = [
        "id",
        "user",
        "event",
        "status",
        "hold_expires_at",
        "total_amount_minor",
        "created_at",
    ]
    list_filter = ["status"]
    search_fields = ["id", "payment_order_id", "payment_ref"]
    readonly_fields = [f.name for f in Booking._meta.fields]
    inlines = [BookingItemInline]
    list_select_related = ["user", "event"]
    ordering = ["-created_at"]


@admin.register(Ticket)
class TicketAdmin(admin.ModelAdmin):
    list_display = [
        "id",
        "booking",
        "ticket_type",
        "status",
        "attendee_name",
        "used_at",
        "created_at",
    ]
    list_filter = ["status"]
    # attendee_email is searchable because support's question is "who did we
    # send this ticket to", and the buyer's address won't answer it for a
    # ticket that was assigned to somebody else.
    search_fields = ["id", "qr_token", "attendee_email"]
    readonly_fields = [f.name for f in Ticket._meta.fields]
    list_select_related = ["booking", "ticket_type"]
    ordering = ["-created_at"]
