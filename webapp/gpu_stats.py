"""
GPU Stats SSE Endpoint
======================

Flask Blueprint that streams real-time GPU metrics via Server-Sent Events.
Uses pynvml to query NVIDIA GPU utilization, memory, temperature, power, and clocks.
"""

import json
import logging
import time
from typing import Iterator

from flask import Blueprint, Response

logger = logging.getLogger(__name__)

gpu_bp = Blueprint("gpu", __name__, url_prefix="/gpu")


class GpuMonitor:
    """Wraps pynvml calls. Initialises once, caches the device handle."""

    def __init__(self) -> None:
        self._available = False
        self._handle = None
        self._pynvml = None
        self._power_limit = 350.0

        try:
            import pynvml
            pynvml.nvmlInit()
            self._handle = pynvml.nvmlDeviceGetHandleByIndex(0)
            self._pynvml = pynvml
            self._available = True
            # Query actual power limit for normalisation
            try:
                # nvmlDeviceGetPowerManagementLimit returns milliwatts
                self._power_limit = pynvml.nvmlDeviceGetPowerManagementLimit(self._handle) / 1000.0
            except Exception:
                pass
            logger.info("GPU monitoring initialised (pynvml)")
        except Exception as e:
            logger.warning("GPU monitoring unavailable: %s", e)

    @property
    def available(self) -> bool:
        return self._available

    @property
    def power_limit(self) -> float:
        return self._power_limit

    def snapshot(self) -> dict:
        """Return a dict of current GPU metrics."""
        if not self._available:
            return {"error": "no_gpu"}

        nv = self._pynvml
        h = self._handle
        assert nv is not None and h is not None

        try:
            util = nv.nvmlDeviceGetUtilizationRates(h)
            mem = nv.nvmlDeviceGetMemoryInfo(h)
            temp = nv.nvmlDeviceGetTemperature(h, nv.NVML_TEMPERATURE_GPU)
            power = nv.nvmlDeviceGetPowerUsage(h)  # milliwatts
            clock = nv.nvmlDeviceGetClockInfo(h, nv.NVML_CLOCK_SM)

            return {
                "gpu_util": util.gpu,          # 0-100
                "mem_used": mem.used,
                "mem_total": mem.total,
                "mem_percent": round(mem.used / mem.total * 100, 1) if mem.total else 0,
                "temperature": temp,           # celsius
                "power_draw": power / 1000.0,  # watts
                "power_limit": self._power_limit,
                "clock_mhz": clock,
            }
        except Exception as e:
            logger.error("GPU snapshot error: %s", e)
            return {"error": "gpu_read_failed"}


_monitor = GpuMonitor()

# Max stream duration: 4Hz * 3600s = 1 hour
_MAX_SSE_ITERATIONS = 14400


def _sse_stream() -> Iterator[str]:
    """Yield GPU stats as SSE events every 250ms, for up to 1 hour."""
    for _ in range(_MAX_SSE_ITERATIONS):
        data = _monitor.snapshot()
        yield f"data: {json.dumps(data)}\n\n"
        time.sleep(0.25)


@gpu_bp.route("/stats")
def gpu_stats() -> Response:
    """SSE endpoint streaming GPU metrics at ~4Hz."""
    return Response(
        _sse_stream(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
