"""IDEF0 registry and run trace.

``@idef0(...)`` attaches the IDEF0 box (function ID, name, mechanism and
ICOMs) to the Python function that performs it.  The same metadata is
exported to the web app (dist/data/idef0_registry.json) and checked against
model/idef0.json by tests/test_functional_requirements.py.
"""
from __future__ import annotations

import functools
import inspect
import json
import time
from pathlib import Path
from typing import Callable

ROOT = Path(__file__).resolve().parent.parent
REGISTRY: dict[str, dict] = {}
_TRACE: list[dict] = []


def idef0(function_id: str, name: str, mechanism: str, *, inputs=(), controls=(),
          outputs=(), requirements=()):
    """Register a function as the implementation of an IDEF0 box."""

    def wrap(fn: Callable):
        REGISTRY[function_id] = {
            "function_id": function_id,
            "name": name,
            "mechanism": mechanism,
            "inputs": list(inputs),
            "controls": list(controls),
            "outputs": list(outputs),
            "requirements": list(requirements),
            "module": fn.__module__,
            "path": Path(inspect.getsourcefile(fn)).resolve().relative_to(ROOT).as_posix(),
            "callable": fn.__qualname__,
        }

        @functools.wraps(fn)
        def run(*args, **kwargs):
            t0 = time.perf_counter()
            result = fn(*args, **kwargs)
            _TRACE.append({
                "function_id": function_id,
                "name": name,
                "mechanism": mechanism,
                "inputs": list(inputs),
                "controls": list(controls),
                "outputs": list(outputs),
                "ms": round((time.perf_counter() - t0) * 1000, 3),
            })
            return result

        run.idef0 = REGISTRY[function_id]
        return run

    return wrap


def reset_trace() -> None:
    _TRACE.clear()


def get_trace() -> list[dict]:
    return list(_TRACE)


def load_model() -> dict:
    return json.loads((ROOT / "model" / "idef0.json").read_text())


def load_all_modules() -> None:
    """Import every module so that REGISTRY is complete."""
    import brm.service  # noqa: F401  (imports all F.2.x and F.2.3.x modules)
