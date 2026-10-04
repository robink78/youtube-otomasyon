import json
import os
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch

from shortslab import production as p
from shortslab import kuyruk as q


class QueueTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.kuyruk = self.root / 'kuyruk'
        self.kuyruk.mkdir()
        self.patchers = [
            patch.object(p, 'ROOT', self.root),
            patch.object(q, 'ROOT', self.root),
            patch.object(q, 'KUYRUK', self.kuyruk),
            patch.object(q, 'ISLENEN', self.kuyruk / 'islenen'),
        ]
        for pt in self.patchers:
            pt.start()
        for name in p.SCRIPTS.values():
            (self.root / name).write_text('adapter')

    def tearDown(self):
        for pt in self.patchers:
            pt.stop()
        self.temp.cleanup()

    def _spec(self, name, slug):
        narration = self.kuyruk / (slug + '.txt')
        narration.write_text('First paragraph.\n\nSecond paragraph.')
        (self.kuyruk / name).write_text(json.dumps({
            'slug': slug, 'title': 'T', 'brief': 'B',
            'narration': 'kuyruk/' + slug + '.txt',
        }))

    def test_empty_queue_is_noop(self):
        self.assertEqual(q.main([]), 0)

    def test_pending_specs_sorted_and_skips_ornek(self):
        self._spec('b.json', 'bee')
        self._spec('a.json', 'ant')
        (self.kuyruk / 'ornek.json.ornek').write_text('{}')
        names = [s.name for s in q.pending_specs()]
        self.assertEqual(names, ['a.json', 'b.json'])

    def test_run_one_produces_and_moves_spec_without_upload(self):
        self._spec('job.json', 'first-job')
        ran = {}
        def fake_run(job, until='render', runner=None):
            ran['job'] = job.name
            return {}
        with patch.object(p, 'run', fake_run), \
             patch.object(p, 'upload_ready', lambda: False), \
             patch.dict(os.environ, {}, clear=False):
            os.environ.pop('PUBLISH', None)
            slug = q.run_one(self.kuyruk / 'job.json')
        self.assertEqual(slug, 'first-job')
        self.assertEqual(ran['job'], 'first-job')
        # Spec moved out of the active queue into islenen/.
        self.assertFalse((self.kuyruk / 'job.json').exists())
        self.assertTrue((self.kuyruk / 'islenen' / 'job.json').exists())

    def test_missing_narration_file_errors(self):
        (self.kuyruk / 'bad.json').write_text(json.dumps({
            'slug': 'bad-job', 'title': 'T', 'brief': 'B',
            'narration': 'kuyruk/yok.txt',
        }))
        with self.assertRaisesRegex(ValueError, 'narration file missing'):
            q.run_one(self.kuyruk / 'bad.json')


if __name__ == '__main__':
    unittest.main()
