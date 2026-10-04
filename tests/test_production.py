import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from shortslab import production as p


class ProductionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.patch = patch.object(p, 'ROOT', self.root)
        self.patch.start()
        for name in p.SCRIPTS.values():
            (self.root / name).write_text('adapter')
        self.job = p.initialize('test-job', 'Title', 'Brief')
        p.outputs(self.job, 'script')[0].write_text('First paragraph.\n\nSecond paragraph.')

    def tearDown(self):
        self.patch.stop()
        self.temp.cleanup()

    def test_reject_traversal(self):
        for slug in ('../secret', '/tmp/x', 'a/b', 'a;ls'):
            with self.assertRaises(ValueError):
                p.job_path(slug)

    def test_resume_and_modified_narration(self):
        calls = []
        def runner(argv, **kwargs):
            calls.append(argv)
            for file in p.outputs(self.job, 'voice'):
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_bytes(b'audio')
            return SimpleNamespace(returncode=0)
        p.run(self.job, 'voice', runner)
        p.run(self.job, 'voice', runner)
        self.assertEqual(len(calls), 1)
        p.outputs(self.job, 'script')[0].write_text('Changed narration.')
        p.run(self.job, 'voice', runner)
        self.assertEqual(len(calls), 2)

    def test_missing_paragraph_stops_pipeline(self):
        def runner(argv, **kwargs):
            file = p.outputs(self.job, 'voice')[0]
            file.parent.mkdir(parents=True)
            file.write_bytes(b'audio')
            return SimpleNamespace(returncode=0)
        with self.assertRaisesRegex(ValueError, 'voice failed'):
            p.run(self.job, runner=runner)
        state = json.loads((self.job / 'production-state.json').read_text())
        self.assertEqual(state['voice']['status'], 'failed')
        self.assertNotIn('visuals', state)
        self.assertFalse((self.job / '.production.lock').exists())

    def test_lock_prevents_duplicate_run(self):
        (self.job / '.production.lock').write_text('123')
        with self.assertRaises(FileExistsError):
            p.run(self.job)

    def test_corrupt_output_is_regenerated(self):
        count = []
        def runner(argv, **kwargs):
            count.append(1)
            for file in p.outputs(self.job, 'voice'):
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_bytes(b'valid')
            return SimpleNamespace(returncode=0)
        p.run(self.job, 'voice', runner)
        p.outputs(self.job, 'voice')[0].write_bytes(b'changed')
        p.run(self.job, 'voice', runner)
        self.assertEqual(len(count), 2)


if __name__ == '__main__':
    unittest.main()
