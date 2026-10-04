"""Queue runner for scheduled (every-3-days) production.

Reads approved job specs from `kuyruk/*.json`, produces the oldest one end to
end, and — only when publishing is explicitly enabled AND YouTube credentials
are present — uploads it as a PRIVATE video for later human review. It never
makes anything public on its own and never auto-generates topics: each queue
item is content a human placed there.

Spec file (kuyruk/<name>.json):
    {
      "slug": "concorde-neden-coktu",       # required, [a-z0-9-]
      "title": "Why Concorde Crashed",       # required
      "brief": "Verified facts and sources", # required
      "narration": "kuyruk/concorde.txt"     # optional local narration file;
    }                                        # omit only if paid script gen is set up

Publishing is enabled by the environment variable PUBLISH=1 (a GitHub repo
variable), and still requires YT_CLIENT_ID / YT_CLIENT_SECRET / YT_REFRESH_TOKEN.
Processed specs move to kuyruk/islenen/ so the next run picks the next item.
"""
import json
import os
import shutil
import sys
from pathlib import Path

from . import production

ROOT = production.ROOT
KUYRUK = ROOT / 'kuyruk'
ISLENEN = KUYRUK / 'islenen'


def pending_specs():
    if not KUYRUK.is_dir():
        return []
    return sorted(p for p in KUYRUK.glob('*.json') if p.is_file())


def run_one(spec_path, publish=None):
    spec = json.loads(spec_path.read_text())
    slug = spec['slug']
    title = spec['title']
    brief = spec['brief']
    narration = spec.get('narration')
    script = (ROOT / narration).resolve() if narration else None
    if script and not (script.is_file() and script.stat().st_size > 0):
        raise ValueError(f'{spec_path.name}: narration file missing: {narration}')

    job = production.job_path(slug)
    if not (job / 'konu.json').is_file():
        production.initialize(slug, title, brief, script)
        print(f'init: {slug}')
    production.run(job, 'render')
    print(f'render complete: {slug}')

    # Publishing: opt-in via PUBLISH=1 AND credentials present. Always private.
    if publish is None:
        publish = os.environ.get('PUBLISH') == '1'
    if publish and production.upload_ready():
        code = production.publish(job, verify=False, visibility='private')
        print('upload: private, review before making public' if code == 0
              else f'upload failed (exit {code})')
    else:
        why = 'PUBLISH!=1' if not publish else 'no YouTube credentials'
        print(f'upload skipped ({why}); render kept in uretim/{slug}/Videos/')

    ISLENEN.mkdir(parents=True, exist_ok=True)
    shutil.move(str(spec_path), str(ISLENEN / spec_path.name))
    return slug


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    specs = pending_specs()
    if not specs:
        print('Queue empty (kuyruk/*.json). Nothing to do.')
        return 0
    count = 1
    if '--hepsi' in argv:
        count = len(specs)
    try:
        for spec_path in specs[:count]:
            print(f'--- {spec_path.name} ---')
            run_one(spec_path)
        return 0
    except (ValueError, OSError) as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
