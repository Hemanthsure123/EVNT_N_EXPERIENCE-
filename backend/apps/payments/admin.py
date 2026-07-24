from django.contrib import admin

from .models import Payment, ProcessedWebhook, Refund


@admin.register(Payment)
class PaymentAdmin(admin.ModelAdmin):
    list_display = [
        "id",
        "booking",
        "rzp_order_id",
        "rzp_payment_id",
        "amount_minor",
        "status",
        "created_at",
    ]
    list_filter = ["status"]
    search_fields = ["id", "rzp_order_id", "rzp_payment_id"]
    readonly_fields = [f.name for f in Payment._meta.fields]
    list_select_related = ["booking"]
    ordering = ["-created_at"]


@admin.register(ProcessedWebhook)
class ProcessedWebhookAdmin(admin.ModelAdmin):
    list_display = ["dedupe_key", "created_at"]
    search_fields = ["dedupe_key"]
    readonly_fields = [f.name for f in ProcessedWebhook._meta.fields]

    def has_add_permission(self, request: object) -> bool:
        return False


@admin.register(Refund)
class RefundAdmin(admin.ModelAdmin):
    list_display = ["id", "payment", "rzp_refund_id", "amount_minor", "reason", "created_at"]
    search_fields = ["id", "rzp_refund_id"]
    readonly_fields = [f.name for f in Refund._meta.fields]
    list_select_related = ["payment"]
    ordering = ["-created_at"]
