import threading
import time

import pytest

from tts.inference_worker import InferenceWorker


@pytest.fixture
def worker():
    instance = InferenceWorker(name="test-inference")
    yield instance
    instance.shutdown()


def test_run_returns_the_callable_result(worker):
    assert worker.run(lambda a, b: a + b, 2, b=3) == 5


def test_run_executes_off_the_calling_thread(worker):
    caller = threading.get_ident()

    assert worker.run(threading.get_ident) != caller


def test_run_reuses_one_thread_across_calls_from_many_caller_threads(worker):
    """The whole point of the worker: inference must not touch a fresh OS thread
    per request, because per-thread CUDA/malloc state is never reclaimed."""
    idents = []

    def call():
        idents.append(worker.run(threading.get_ident))

    for _ in range(25):
        caller = threading.Thread(target=call)
        caller.start()
        caller.join()

    assert len(set(idents)) == 1


def test_run_propagates_exceptions_to_the_caller(worker):
    def explode():
        raise ValueError("inference failed")

    with pytest.raises(ValueError, match="inference failed"):
        worker.run(explode)


def test_run_serializes_concurrent_callers(worker):
    overlapping = []
    active = 0
    guard = threading.Lock()

    def job():
        nonlocal active
        with guard:
            active += 1
            overlapping.append(active)
        time.sleep(0.01)
        with guard:
            active -= 1

    callers = [threading.Thread(target=worker.run, args=(job,)) for _ in range(8)]
    for caller in callers:
        caller.start()
    for caller in callers:
        caller.join()

    assert overlapping == [1] * 8


def test_stream_yields_every_item_in_order(worker):
    assert list(worker.stream(lambda: iter(range(6)))) == [0, 1, 2, 3, 4, 5]


def test_stream_executes_the_generator_off_the_calling_thread(worker):
    caller = threading.get_ident()

    def generate():
        yield threading.get_ident()

    assert next(iter(worker.stream(generate))) != caller


def test_stream_reuses_one_thread_across_calls_from_many_caller_threads(worker):
    idents = []

    def generate():
        yield threading.get_ident()

    def call():
        idents.extend(worker.stream(generate))

    for _ in range(25):
        caller = threading.Thread(target=call)
        caller.start()
        caller.join()

    assert len(set(idents)) == 1


def test_stream_propagates_a_midstream_exception_after_earlier_items(worker):
    def generate():
        yield 1
        raise RuntimeError("boom")

    received = []
    with pytest.raises(RuntimeError, match="boom"):
        for item in worker.stream(generate):
            received.append(item)

    assert received == [1]


def test_stream_closes_the_generator_when_the_caller_stops_early(worker):
    """A client that disconnects mid-response must not leave the generator
    suspended, holding model resources and the worker thread."""
    closed = threading.Event()

    def generate():
        try:
            for i in range(1000):
                yield i
        finally:
            closed.set()

    for item in worker.stream(generate):
        if item == 2:
            break

    assert closed.wait(timeout=5)


def test_worker_still_usable_after_a_caller_stops_early(worker):
    def generate():
        yield from range(1000)

    for item in worker.stream(generate):
        if item == 1:
            break

    assert worker.run(lambda: "healthy") == "healthy"


def test_worker_still_usable_after_a_stream_raises(worker):
    def generate():
        raise RuntimeError("boom")
        yield  # pragma: no cover - unreachable, makes this a generator

    with pytest.raises(RuntimeError):
        list(worker.stream(generate))

    assert worker.run(lambda: "healthy") == "healthy"


def test_stream_applies_backpressure_instead_of_racing_ahead(worker):
    """A slow consumer must not let the generator buffer the whole response in
    memory; the queue bound is what keeps a stalled client cheap."""
    produced = []
    worker_with_small_queue = InferenceWorker(name="test-backpressure", queue_size=2)

    def generate():
        for i in range(100):
            produced.append(i)
            yield i

    try:
        stream = worker_with_small_queue.stream(generate)
        assert next(stream) == 0
        time.sleep(0.2)  # let the generator run as far ahead as it is allowed to
        assert len(produced) <= 2 + 2  # queue bound + item in flight + headroom
        stream.close()
    finally:
        worker_with_small_queue.shutdown()


def test_stream_is_lazy_and_does_not_start_before_first_iteration(worker):
    started = threading.Event()

    def generate():
        started.set()
        yield 1

    stream = worker.stream(generate)
    assert not started.is_set()

    next(stream)
    assert started.is_set()
    stream.close()


def test_shutdown_is_idempotent():
    instance = InferenceWorker(name="test-shutdown")
    instance.shutdown()
    instance.shutdown()


def test_run_after_shutdown_raises():
    instance = InferenceWorker(name="test-closed")
    instance.shutdown()

    with pytest.raises(RuntimeError, match="shut down"):
        instance.run(lambda: 1)
