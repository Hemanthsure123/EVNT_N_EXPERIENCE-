import pytest

from core import tasks


def test_register_and_run_task():
    received: list[dict] = []
    tasks.register_task("core.tests.sample_task")(received.append)

    tasks.run_task("core.tests.sample_task", {"x": 1})

    assert received == [{"x": 1}]


def test_registering_the_same_name_twice_with_a_different_function_raises():
    def handler_a(payload: dict) -> None:
        pass

    def handler_b(payload: dict) -> None:
        pass

    tasks.register_task("core.tests.duplicate_task")(handler_a)

    with pytest.raises(ValueError):
        tasks.register_task("core.tests.duplicate_task")(handler_b)


def test_registering_the_same_function_twice_is_idempotent():
    def handler(payload: dict) -> None:
        pass

    tasks.register_task("core.tests.idempotent_task")(handler)
    tasks.register_task("core.tests.idempotent_task")(handler)  # does not raise


def test_run_task_raises_for_an_unregistered_name():
    with pytest.raises(KeyError):
        tasks.run_task("core.tests.no_such_task", {})
