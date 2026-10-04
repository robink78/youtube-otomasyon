import unittest
from shortslab.discovery import collect, normalize, summarize


class DiscoveryTests(unittest.TestCase):
    def test_missing_is_not_zero_and_duplicates_removed(self):
        rows = normalize([{'videoId': 'a'}, {'videoId': 'a', 'vph': 3},
                          {'videoId': 'b', 'vph': 0}, {'videoId': 'c', 'vph': float('nan')}])
        self.assertEqual(len(rows), 3)
        self.assertIsNone(rows[0]['provider_vph'])
        self.assertEqual(summarize(rows)['vph_observations'], 1)
        self.assertEqual(summarize(rows)['median_provider_vph'], 0)

    def test_partial_failure_is_preserved_without_secrets(self):
        class Client:
            def videos(self, query, language, limit):
                if query == 'bad':
                    raise ValueError('secret credential')
                return []
        run = collect(Client(), ['bad', 'good'])
        self.assertEqual([n['status'] for n in run['niches']], ['error', 'empty'])
        self.assertNotIn('secret credential', str(run))

    def test_even_sample_median(self):
        rows = normalize([{'videoId': 'a', 'vph': 2}, {'videoId': 'b', 'vph': 8}])
        self.assertEqual(summarize(rows)['median_provider_vph'], 5)
