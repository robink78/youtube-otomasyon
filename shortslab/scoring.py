"""Deterministic niche scoring for ShortsLab.

All input signals use a 0-100 scale. ``production_cost`` is intentionally
inverted: a low production cost produces a high contribution to the score.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable, Mapping


DEFAULT_WEIGHTS: dict[str, float] = {
    "trend_velocity": 0.25,
    "low_competition": 0.20,
    "global_audience": 0.15,
    "shorts_fit": 0.15,
    "monetization": 0.10,
    "content_supply": 0.10,
    "production_efficiency": 0.05,
}

INPUT_SIGNALS = {
    "trend_velocity",
    "competition",
    "global_audience",
    "shorts_fit",
    "monetization",
    "content_supply",
    "production_cost",
}


@dataclass(frozen=True)
class ScoredNiche:
    name: str
    score: float
    confidence: float
    adjusted_score: float
    breakdown: dict[str, float]

    def as_dict(self, rank: int | None = None) -> dict[str, Any]:
        result: dict[str, Any] = {
            "name": self.name,
            "score": self.score,
            "confidence": self.confidence,
            "adjusted_score": self.adjusted_score,
            "breakdown": self.breakdown,
        }
        if rank is not None:
            result["rank"] = rank
        return result


def _bounded_number(value: Any, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{field} must be a number between 0 and 100")
    number = float(value)
    if not 0 <= number <= 100:
        raise ValueError(f"{field} must be between 0 and 100; got {number}")
    return number


def validate_weights(weights: Mapping[str, float]) -> None:
    if set(weights) != set(DEFAULT_WEIGHTS):
        missing = set(DEFAULT_WEIGHTS) - set(weights)
        extra = set(weights) - set(DEFAULT_WEIGHTS)
        raise ValueError(f"invalid weights; missing={sorted(missing)}, extra={sorted(extra)}")
    total = sum(weights.values())
    if abs(total - 1.0) > 1e-9:
        raise ValueError(f"weights must total 1.0; got {total}")
    if any(value < 0 for value in weights.values()):
        raise ValueError("weights cannot be negative")


def score_niche(
    niche: Mapping[str, Any], weights: Mapping[str, float] = DEFAULT_WEIGHTS
) -> ScoredNiche:
    """Validate and score one niche candidate.

    ``confidence`` defaults to 100. It is a transparent penalty for incomplete
    or weak evidence and does not change the raw opportunity score.
    """

    validate_weights(weights)
    name = str(niche.get("name", "")).strip()
    if not name:
        raise ValueError("name is required")

    missing = INPUT_SIGNALS - set(niche)
    if missing:
        raise ValueError(f"{name}: missing signals: {sorted(missing)}")

    signals = {key: _bounded_number(niche[key], key) for key in INPUT_SIGNALS}
    confidence = _bounded_number(niche.get("confidence", 100), "confidence")
    factors = {
        "trend_velocity": signals["trend_velocity"],
        "low_competition": 100 - signals["competition"],
        "global_audience": signals["global_audience"],
        "shorts_fit": signals["shorts_fit"],
        "monetization": signals["monetization"],
        "content_supply": signals["content_supply"],
        "production_efficiency": 100 - signals["production_cost"],
    }
    breakdown = {
        key: round(factors[key] * weights[key], 3) for key in DEFAULT_WEIGHTS
    }
    score = round(sum(breakdown.values()), 3)
    adjusted_score = round(score * confidence / 100, 3)
    return ScoredNiche(name, score, confidence, adjusted_score, breakdown)


def rank_niches(
    niches: Iterable[Mapping[str, Any]],
    weights: Mapping[str, float] = DEFAULT_WEIGHTS,
) -> list[dict[str, Any]]:
    """Return candidates sorted by confidence-adjusted score."""

    scored = [score_niche(niche, weights) for niche in niches]
    scored.sort(key=lambda item: (-item.adjusted_score, -item.score, item.name.lower()))
    return [item.as_dict(rank=index) for index, item in enumerate(scored, start=1)]
