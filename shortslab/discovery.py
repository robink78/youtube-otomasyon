"""Collect vidIQ Shorts evidence. No API key or raw errors enter reports."""
import argparse
import json
import math
import os
import statistics
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


class VidIQ:
    def __init__(self, key):
        self.key, self.session, self.counter = key, None, 0

    def request(self, method, params, notification=False):
        self.counter += 1
        body = dict(jsonrpc='2.0', method=method, params=params)
        if not notification:
            body['id'] = self.counter
        headers = {'Authorization': 'Bearer ' + self.key,
                   'Content-Type': 'application/json',
                   'Accept': 'application/json, text/event-stream'}
        if self.session:
            headers['Mcp-Session-Id'] = self.session
        request = urllib.request.Request('https://mcp.vidiq.com/mcp',
                                         data=json.dumps(body).encode(), headers=headers)
        with urllib.request.urlopen(request, timeout=60) as response:
            self.session = response.headers.get('Mcp-Session-Id', self.session)
            raw = response.read(5_000_001)
        if len(raw) > 5_000_000:
            raise ValueError('response too large')
        if notification:
            return None
        text = raw.decode()
        messages = [json.loads(text)] if text.lstrip().startswith('{') else [
            json.loads(line[5:].strip()) for line in text.splitlines()
            if line.startswith('data:') and line[5:].strip().startswith('{')]
        for message in messages:
            if message.get('id') == self.counter:
                if 'error' in message:
                    raise ValueError('provider RPC error')
                return message['result']
        raise ValueError('missing RPC response')

    def start(self):
        self.request('initialize', {'protocolVersion': '2024-11-05',
                     'capabilities': {}, 'clientInfo': {'name': 'shortslab', 'version': '0.2'}})
        self.request('notifications/initialized', {}, notification=True)

    def videos(self, query, language, limit):
        result = self.request('tools/call', {'name': 'vidiq_trending_videos',
            'arguments': {'videoFormat': 'short', 'titleQuery': query,
                          'videoTitleLanguage': language, 'sortBy': 'vph',
                          'vphMin': 0, 'limit': limit}})
        if result.get('isError'):
            raise ValueError('provider tool error')
        data = result.get('structuredContent')
        if not isinstance(data, dict) or not isinstance(data.get('videos'), list):
            raise ValueError('unexpected provider schema')
        return data['videos']


def number(value):
    if isinstance(value, bool) or not isinstance(value, (float, int)):
        return None
    return value if math.isfinite(value) and value >= 0 else None


def normalize(rows):
    videos, seen = [], set()
    for row in rows:
        if not isinstance(row, dict):
            continue
        video_id = row.get('videoId')
        if not isinstance(video_id, str) or not video_id or video_id in seen:
            continue
        seen.add(video_id)
        videos.append({'video_id': video_id, 'title': row.get('videoTitle'),
                       'views': number(row.get('viewCount')),
                       'provider_vph': number(row.get('vph')),
                       'duration_seconds': number(row.get('videoDuration')),
                       'subscribers': number(row.get('subscriberCount'))})
    return videos


def summarize(videos):
    velocities = [v['provider_vph'] for v in videos if v['provider_vph'] is not None]
    return {'sample_size': len(videos), 'vph_observations': len(velocities),
            'median_provider_vph': statistics.median(velocities) if velocities else None,
            'limitations': ['Provider-selected trending sample; not market-wide competition.',
                           'VPH window is provider-defined; no historical growth inferred.',
                           'Revenue, retention and audience geography are not observed.']}


def collect(client, queries, language='en', limit=12):
    run = {'schema_version': 1, 'source': 'vidiq_trending_videos',
           'collected_at': datetime.now(timezone.utc).isoformat(),
           'language': language, 'requested_limit': limit, 'niches': []}
    for query in queries:
        entry = {'query': query}
        try:
            videos = normalize(client.videos(query, language, limit))
            entry.update(status='ok' if videos else 'empty', videos=videos,
                         summary=summarize(videos))
        except Exception:
            # Do not leak provider responses or credential-bearing URLs.
            entry.update(status='error', error='provider_request_failed', videos=[])
        run['niches'].append(entry)
    return run


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--query', action='append', required=True)
    parser.add_argument('--language', default='en')
    parser.add_argument('--limit', type=int, default=12)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(argv)
    if not 1 <= args.limit <= 12:
        parser.error('--limit must be between 1 and 12')
    key = os.environ.get('VIDIQ_KEY', '').strip()
    if not key:
        parser.error('Set VIDIQ_KEY in the environment; never pass it as a CLI argument.')
    if args.output.exists():
        parser.error('Output already exists; choose a new run filename.')
    client = VidIQ(key)
    try:
        client.start()
    except Exception:
        print('vidIQ initialization failed. Check connectivity and VIDIQ_KEY.', file=sys.stderr)
        return 1
    run = collect(client, list(dict.fromkeys(args.query)), args.language, args.limit)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open('x', encoding='utf-8') as handle:
        json.dump(run, handle, ensure_ascii=False, indent=2, allow_nan=False)
        handle.write('\n')
    print(str(args.output))
    return 1 if any(n['status'] == 'error' for n in run['niches']) else 0


if __name__ == '__main__':
    raise SystemExit(main())
