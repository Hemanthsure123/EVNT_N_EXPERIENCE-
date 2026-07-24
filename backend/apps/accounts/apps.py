from django.apps import AppConfig


class AccountsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.accounts"
    label = "accounts"

    # No AppConfig.ready(): accounts emits USER_REGISTERED but subscribes to
    # nothing — the welcome email is owned by the notifications module now.
