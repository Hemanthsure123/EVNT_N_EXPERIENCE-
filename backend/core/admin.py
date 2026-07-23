from django.contrib import admin

from .models import AuditLog, OutboxEvent


@admin.register(OutboxEvent)
class OutboxEventAdmin(admin.ModelAdmin):
    list_display = ["event_type", "aggregate_id", "created_at", "published_at"]
    list_filter = ["event_type", "published_at"]
    readonly_fields = [f.name for f in OutboxEvent._meta.fields]

    def has_add_permission(self, request: object) -> bool:
        return False


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ["action", "actor_id", "target_type", "target_id", "created_at"]
    list_filter = ["action"]
    readonly_fields = [f.name for f in AuditLog._meta.fields]

    def has_add_permission(self, request: object) -> bool:
        return False
