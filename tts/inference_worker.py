"""Run model inference on a single long-lived thread.

Flask's built-in server handles every request on a brand-new OS thread
(``app.run()`` defaults to ``threaded=True``, which selects werkzeug's
``ThreadedWSGIServer``). Torch/CUDA inference allocates per-thread state that is
never reclaimed when the thread exits — cuBLAS and cuDNN handles, a glibc malloc
arena, CUDA per-thread context data — so a long-running TTS server retains
roughly a megabyte for every request it has ever served. Measured against the
Kokoro pipeline, synthesis on a fresh thread per call grew RSS by ~1.0 MB per
request with no plateau, while the identical work on one reusable thread was
flat.

Routing inference through this worker bounds that state to one thread's worth.
It also serializes inference, which these single-model servers need regardless.

Two entry points, matching how the TTS endpoints produce audio:

``run``
    Call a function on the worker thread and return its value. Suits models that
    synthesize a whole utterance in one shot.

``stream``
    Iterate a generator on the worker thread, handing items back to the caller
    through a bounded queue. Suits models that emit audio chunk by chunk.
"""

import queue
import threading
from typing import Any, Callable, Iterator

# How long a blocked worker waits before re-checking whether its consumer went
# away. Only bounds cancellation latency, so a coarse value is fine.
_CANCEL_POLL_SECONDS = 0.05

_DEFAULT_QUEUE_SIZE = 8


class _Done:
    """Sentinel marking normal end of a streamed job."""


class _Failed:
    """Sentinel wrapping an exception raised by a streamed job."""

    def __init__(self, error: BaseException) -> None:
        self.error = error


class InferenceWorker:
    """A single daemon thread that executes every submitted inference job."""

    def __init__(self, name: str = "tts-inference",
                 queue_size: int = _DEFAULT_QUEUE_SIZE) -> None:
        self._jobs: queue.Queue[Callable[[], None] | None] = queue.Queue()
        self._queue_size = max(1, queue_size)
        self._closed = False
        self._closing = threading.Lock()
        self._thread = threading.Thread(target=self._serve, name=name, daemon=True)
        self._thread.start()

    def _serve(self) -> None:
        while True:
            job = self._jobs.get()
            if job is None:  # shutdown signal
                return
            job()

    def _submit(self, job: Callable[[], None]) -> None:
        if self._closed:
            raise RuntimeError("InferenceWorker has been shut down")
        self._jobs.put(job)

    def run(self, function: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
        """Execute ``function`` on the worker thread and return its result.

        Exceptions raised by ``function`` propagate to the caller.
        """
        finished = threading.Event()
        outcome: dict[str, Any] = {}

        def job() -> None:
            try:
                outcome["value"] = function(*args, **kwargs)
            except BaseException as error:  # relayed to the caller below
                outcome["error"] = error
            finally:
                finished.set()

        self._submit(job)
        finished.wait()

        if "error" in outcome:
            raise outcome["error"]
        return outcome["value"]

    def stream(self, generator_factory: Callable[[], Iterator[Any]]) -> Iterator[Any]:
        """Iterate ``generator_factory()`` on the worker thread.

        The generator is created and advanced entirely on the worker thread;
        items cross back to the caller through a queue bounded by ``queue_size``,
        so a slow consumer throttles production instead of buffering the whole
        response. Nothing starts until the returned iterator is first advanced.

        Abandoning the returned iterator — as Flask does when a client
        disconnects mid-response — closes the underlying generator so it cannot
        sit suspended holding model resources.
        """
        items: queue.Queue[Any] = queue.Queue(maxsize=self._queue_size)
        cancelled = threading.Event()
        finished = threading.Event()

        def job() -> None:
            generator: Iterator[Any] | None = None
            try:
                generator = generator_factory()
                for item in generator:
                    if not self._offer(items, item, cancelled):
                        return
                    if cancelled.is_set():
                        return
                self._offer(items, _Done(), cancelled)
            except BaseException as error:  # relayed to the caller below
                self._offer(items, _Failed(error), cancelled)
            finally:
                # Runs the generator's own finally/cleanup on this thread, where
                # the model state it touches lives.
                if generator is not None and hasattr(generator, "close"):
                    generator.close()
                finished.set()

        return self._consume(job, items, cancelled, finished)

    def _consume(self, job: Callable[[], None], items: "queue.Queue[Any]",
                 cancelled: threading.Event,
                 finished: threading.Event) -> Iterator[Any]:
        """Yield the worker's output, cancelling the job if iteration stops."""
        self._submit(job)
        try:
            while True:
                item = items.get()
                if isinstance(item, _Done):
                    return
                if isinstance(item, _Failed):
                    raise item.error
                yield item
        finally:
            cancelled.set()
            # Unblock a worker parked on a full queue so it can observe the
            # cancellation, then let it finish its cleanup.
            while not finished.is_set():
                try:
                    items.get_nowait()
                except queue.Empty:
                    finished.wait(_CANCEL_POLL_SECONDS)

    @staticmethod
    def _offer(items: "queue.Queue[Any]", item: Any,
               cancelled: threading.Event) -> bool:
        """Put ``item`` on ``items``, giving up if the consumer cancelled.

        Returns ``False`` when the consumer is gone and production should stop.
        """
        while not cancelled.is_set():
            try:
                items.put(item, timeout=_CANCEL_POLL_SECONDS)
                return True
            except queue.Full:
                continue
        return False

    def shutdown(self) -> None:
        """Stop the worker thread. Safe to call more than once."""
        with self._closing:
            if self._closed:
                return
            self._closed = True
            self._jobs.put(None)
        self._thread.join(timeout=5)
