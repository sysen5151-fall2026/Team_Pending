"""Shared helpers (hashing, config loading)."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from brm.idef0 import ROOT

CONFIG = ROOT / "config"


def _norm(obj):
    """Integral floats -> int so the JSON text matches JavaScript's JSON (1.0 -> 1)."""
    if isinstance(obj, float) and obj.is_integer():
        return int(obj)
    if isinstance(obj, dict):
        return {k: _norm(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_norm(v) for v in obj]
    return obj


def canonical(obj) -> str:
    """Canonical JSON (sorted keys, no spaces) shared with dist/brm-engine.js."""
    return json.dumps(_norm(obj), sort_keys=True, separators=(",", ":"), default=str)


def digest(obj, n: int = 8) -> str:
    return hashlib.sha256(canonical(obj).encode()).hexdigest()[:n]


def load_control(name: str):
    """Load an IDEF0 control file from config/ (JSON or text)."""
    path = CONFIG / name
    if path.suffix == ".json":
        return json.loads(path.read_text())
    return path.read_text()


def load_controls() -> dict:
    """All controls F.2 receives, keyed by the IDEF0 arrow name."""
    return {
        "approved_source_list": load_control("approved_source_list.json"),
        "data_quality_criteria": load_control("data_quality_criteria.json"),
        "habitat_model_parameters": load_control("habitat_model_parameters.json"),
        "site_summary_rules": load_control("site_summary_rules.json"),
        "map_display_rules": load_control("map_display_rules.json"),
        "interpretation_rules": load_control("interpretation_rules.json"),
        "report_template": load_control("report_template.md"),
    }
