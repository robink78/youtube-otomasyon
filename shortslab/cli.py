"""Command-line entry point for the ShortsLab niche scorer."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from .scoring import DEFAULT_WEIGHTS, rank_niches


def _load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _markdown(results: list[dict[str, Any]]) -> str:
    lines = [
        "# ShortsLab Niche Ranking",
        "",
        "> Scores are decision support, not a monetization guarantee.",
        "",
        "| Rank | Niche | Raw score | Confidence | Adjusted score |",
        "|---:|---|---:|---:|---:|",
    ]
    for row in results:
        lines.append(
            f"| {row['rank']} | {row['name']} | {row['score']:.2f} | "
            f"{row['confidence']:.0f}% | {row['adjusted_score']:.2f} |"
        )
    lines.extend(["", "## Top 3 breakdown", ""])
    for row in results[:3]:
        parts = ", ".join(f"{key}={value:.2f}" for key, value in row["breakdown"].items())
        lines.append(f"- **{row['name']}**: {parts}")
    return "\n".join(lines) + "\n"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="shortslab", description="ShortsLab tools")
    subparsers = parser.add_subparsers(dest="command", required=True)
    rank = subparsers.add_parser("rank", help="rank niche candidates")
    rank.add_argument("--input", type=Path, required=True, help="candidate JSON file")
    rank.add_argument("--output", type=Path, help="optional JSON output")
    rank.add_argument("--markdown", type=Path, help="optional Markdown report")
    rank.add_argument("--top", type=int, default=0, help="print only top N; 0 means all")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command != "rank":
        return 2

    payload = _load_json(args.input)
    niches = payload.get("niches") if isinstance(payload, dict) else payload
    if not isinstance(niches, list) or not niches:
        raise ValueError("input must contain a non-empty 'niches' list")
    weights = payload.get("weights", DEFAULT_WEIGHTS) if isinstance(payload, dict) else DEFAULT_WEIGHTS
    results = rank_niches(niches, weights)

    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if args.markdown:
        args.markdown.parent.mkdir(parents=True, exist_ok=True)
        args.markdown.write_text(_markdown(results), encoding="utf-8")

    visible = results[: args.top] if args.top > 0 else results
    print(json.dumps(visible, ensure_ascii=False, indent=2))
    return 0
