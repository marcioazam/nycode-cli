"""compaction_restart.py on synthetic pi sessions: restart share arithmetic, copy dedupe, UTC window and CLI output."""
import contextlib
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import compaction_restart as cr  # noqa: E402


def req(mid, prompt, ts='2026-11-10T10:00:00.000Z', role='assistant'):
    usage = {'input': 1, 'output': 5, 'cacheRead': prompt - 11, 'cacheWrite': 10, 'totalTokens': prompt + 5}
    return {'type': 'message', 'id': f'e-{mid}', 'timestamp': ts,
            'message': {'role': role, 'model': 'claude-opus-5-5', 'responseId': f'msg_{mid}', 'usage': usage}}


def bound(uid, pre, ts='2026-11-10T10:00:00.000Z'):
    return {'type': 'compaction', 'id': uid, 'timestamp': ts, 'summary': 's', 'firstKeptEntryId': 'k',
            'tokensBefore': pre, 'usage': {'input': 999_999, 'cacheRead': 0, 'cacheWrite': 0}}


def aborted(mid, ts='2026-11-10T10:00:00.000Z'):
    row = req(mid, 11, ts)
    row['message']['usage'] = {'input': 0, 'output': 0, 'cacheRead': 0, 'cacheWrite': 0}
    return row


class CompactionRestartTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.sessions = Path(self.tmp.name) / 'sessions'

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, rows, cwd='--home-x--', name='s1.jsonl'):
        path = self.sessions / cwd / name
        path.parent.mkdir(parents=True, exist_ok=True)
        header = {'type': 'session', 'id': 'h', 'timestamp': '2026-11-10T09:00:00.000Z'}
        path.write_text('\n'.join(json.dumps(r) for r in [header, *rows]) + '\n{"usage": broken\n')
        return path

    def run_cli(self, *argv):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(cr.main(['--sessions', str(self.sessions), '--since', '2026-11-09', *argv]), 0)
        return out.getvalue()

    SESSION = [req('a', 200), bound('b1', 410_000), req('c', 100), req('c', 100), req('d', 150), req('e', 80),
               bound('b2', 900_000), req('f', 120), aborted('g'), req('u', 300, role='user')]

    def test_share_counts_restart_once_per_later_request(self):
        self.write(self.SESSION)
        r = cr.measure(cr.main_transcripts(self.sessions, '2026-11-09'), '2026-11-09', None, 400_000)
        # prompts 200+100+150+80+120 = 650; restart carried 100+100+80 (min) + 120 = 400;
        # duplicate c, aborted g, the user row and the compaction's own summary usage are skipped.
        self.assertEqual((r['requests'], r['prompt_tokens'], r['restart_tokens']), (5, 650, 400))
        self.assertEqual(r['restart_share'], round(400 / 650, 4))
        self.assertEqual((r['compactions'], r['under_window']), (2, 1))
        self.assertEqual((r['restart_p50'], r['restart_p90'], r['pre_tokens_p50']), (120, 120, 655_000))

    def test_copied_session_counts_once_and_its_continuation_keeps_the_restart(self):
        self.write(self.SESSION)
        self.write(self.SESSION + [req('h', 130)], cwd='--home-y--')
        r = cr.measure(cr.main_transcripts(self.sessions, '2026-11-09'), '2026-11-09', None, 400_000)
        self.assertEqual((r['files'], r['requests'], r['prompt_tokens'], r['restart_tokens']), (2, 6, 780, 520))
        self.assertEqual(r['compactions'], 2)

    def test_window_bounds_are_utc_days_and_until_is_exclusive(self):
        self.write([bound('b0', 300_000, ts='2026-11-08T23:00:00.000Z'), req('x', 100, ts='2026-11-08T23:30:00.000Z'),
                    req('y', 150, ts='2026-11-09T00:10:00.000Z'), req('z', 90, ts='2026-11-11T00:00:00.000Z')])
        r = cr.measure(cr.main_transcripts(self.sessions, '2026-11-09'), '2026-11-09', '2026-11-11', 400_000)
        # The compaction and its restart fall before the window; y still carries that restart.
        self.assertEqual((r['requests'], r['prompt_tokens'], r['restart_tokens']), (1, 150, 100))
        self.assertEqual((r['compactions'], r['restart_p50']), (0, None))

    def test_cli_json_and_text_report_without_a_verdict(self):
        empty = json.loads(self.run_cli('--json'))
        self.assertEqual((empty['restart_share'], empty['requests']), (None, 0))
        self.write(self.SESSION)
        report = json.loads(self.run_cli('--json'))
        self.assertEqual((report['restart_share'], report['restart_p50']), (0.6154, 120))
        self.assertNotIn('verdict', report)  # a high share is expected near the optimum: no automatic verdict
        text = self.run_cli()
        self.assertIn('restart_share 0.6154', text)
        self.assertNotIn('verdict', text)

    def test_old_files_and_bad_dates_are_rejected(self):
        path = self.write(self.SESSION)
        os.utime(path, (1_700_000_000, 1_700_000_000))
        self.assertEqual(cr.main_transcripts(self.sessions, '2026-11-09'), [])
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            cr.main(['--since', '09/11/2026'])


if __name__ == '__main__':
    unittest.main()
