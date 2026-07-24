from django.contrib import admin

from .models import Event


@admin.register(Event)
class EventAdmin(admin.ModelAdmin):
    list_display = ["title", "organization", "city", "status", "starts_at", "created_at"]
    list_filter = ["status", "city"]
    search_fields = ["title", "venue", "city"]
    readonly_fields = ["id", "version", "search_vector", "created_at", "updated_at"]
    list_select_related = ["organization"]
    ordering = ["-created_at"]
