from django.contrib import admin

from .models import Organization, VerificationRecord


@admin.register(Organization)
class OrganizationAdmin(admin.ModelAdmin):
    list_display = ["name", "owner", "verified_level", "created_at", "deleted_at"]
    list_filter = ["verified_level"]
    search_fields = ["name", "owner__email"]
    readonly_fields = ["id", "created_at", "updated_at"]


@admin.register(VerificationRecord)
class VerificationRecordAdmin(admin.ModelAdmin):
    list_display = ["organization", "status", "created_at", "processed_at"]
    list_filter = ["status"]
    readonly_fields = ["id", "created_at"]
