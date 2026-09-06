from django.apps import AppConfig


class CouponsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.coupons"
    label = "coupons"

    # No `ready()`. This module subscribes to no domain events and registers no
    # background task: a coupon is decided synchronously inside the transaction
    # that charges for it, and there is nothing about it worth doing later.
