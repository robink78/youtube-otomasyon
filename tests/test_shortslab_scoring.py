import unittest

from shortslab.scoring import rank_niches, score_niche


def candidate(name="Example", **overrides):
    item = {
        "name": name,
        "trend_velocity": 80,
        "competition": 20,
        "global_audience": 80,
        "shorts_fit": 80,
        "monetization": 80,
        "content_supply": 80,
        "production_cost": 20,
        "confidence": 100,
    }
    item.update(overrides)
    return item


class ScoringTests(unittest.TestCase):
    def test_known_score(self):
        result = score_niche(candidate())
        self.assertEqual(result.score, 80.0)
        self.assertEqual(result.adjusted_score, 80.0)

    def test_cost_and_competition_are_inverted(self):
        easy = score_niche(candidate(competition=10, production_cost=10))
        hard = score_niche(candidate(competition=90, production_cost=90))
        self.assertGreater(easy.score, hard.score)

    def test_confidence_penalizes_adjusted_score_only(self):
        full = score_niche(candidate(confidence=100))
        weak = score_niche(candidate(confidence=50))
        self.assertEqual(full.score, weak.score)
        self.assertEqual(weak.adjusted_score, weak.score / 2)

    def test_ranking_is_deterministic(self):
        ranked = rank_niches([
            candidate("Beta", trend_velocity=60),
            candidate("Alpha", trend_velocity=90),
        ])
        self.assertEqual([row["name"] for row in ranked], ["Alpha", "Beta"])
        self.assertEqual([row["rank"] for row in ranked], [1, 2])

    def test_invalid_signal_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "between 0 and 100"):
            score_niche(candidate(trend_velocity=101))


if __name__ == "__main__":
    unittest.main()
