from django.apps import AppConfig


class ReviewsConfig(AppConfig):
    name = "apps.reviews"
    label = "reviews"

    def ready(self) -> None:
        """Nothing to subscribe or register.

        `reviews` emits no domain events and consumes none. A review is a
        person choosing to write something, not a consequence of another
        module's write — there is no `ReviewSubmitted` handler because nothing
        needs to happen elsewhere when one lands. Adding an event here for
        symmetry would be an outbox row nobody reads.
        """
