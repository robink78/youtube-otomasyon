import os
import tempfile
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from shortslab import production as p


class PublishTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.patch = patch.object(p, 'ROOT', self.root)
        self.patch.start()
        for name in p.SCRIPTS.values():
            (self.root / name).write_text('adapter')
        self.job = p.initialize('test-job', 'Title', 'Brief')

    def tearDown(self):
        self.patch.stop()
        self.temp.cleanup()

    def _make_render(self):
        out = p.outputs(self.job, 'render')[0]
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(b'video')

    def test_initialize_uses_cinematic_effect(self):
        import json
        konu = json.loads((self.job / 'konu.json').read_text())
        self.assertEqual(konu.get('efekt'), 'sinematik')

    def test_publish_requires_render(self):
        with self.assertRaisesRegex(ValueError, 'No finished render'):
            p.publish(self.job, runner=lambda *a, **k: SimpleNamespace(returncode=0))

    def test_publish_verify_is_dry_run(self):
        self._make_render()
        seen = {}
        def runner(argv, **kwargs):
            seen['argv'] = argv
            return SimpleNamespace(returncode=0)
        p.publish(self.job, verify=True, runner=runner)
        self.assertIn('youtube-yukle.js', seen['argv'])
        self.assertIn(self.job.name, seen['argv'])
        self.assertIn('--dogrula', seen['argv'])

    def test_publish_default_is_private(self):
        self._make_render()
        seen = {}
        def runner(argv, **kwargs):
            seen['argv'] = argv
            return SimpleNamespace(returncode=0)
        p.publish(self.job, runner=runner)
        # Default private: no visibility override flag is passed.
        self.assertNotIn('--herkese-acik', seen['argv'])
        self.assertNotIn('--liste-disi', seen['argv'])

    def test_publish_public_flag(self):
        self._make_render()
        seen = {}
        def runner(argv, **kwargs):
            seen['argv'] = argv
            return SimpleNamespace(returncode=0)
        p.publish(self.job, visibility='public', runner=runner)
        self.assertIn('--herkese-acik', seen['argv'])

    def test_quality_gate_block_stops_upload(self):
        self._make_render()
        calls = []
        def runner(argv, **kwargs):
            calls.append(argv)
            return SimpleNamespace(returncode=4 if 'quality-gate.js' in argv else 0)
        with self.assertRaisesRegex(ValueError, 'Quality gate BLOCK'):
            p.publish(self.job, runner=runner)
        self.assertFalse(any('youtube-yukle.js' in a for a in calls))

    def test_upload_ready_needs_all_three(self):
        keys = ('YT_CLIENT_ID', 'YT_CLIENT_SECRET', 'YT_REFRESH_TOKEN')
        with patch.dict(os.environ, {k: '' for k in keys}, clear=False):
            for k in keys:
                os.environ.pop(k, None)
            self.assertFalse(p.upload_ready())
        with patch.dict(os.environ, {k: 'x' for k in keys}, clear=False):
            self.assertTrue(p.upload_ready())


if __name__ == '__main__':
    unittest.main()
