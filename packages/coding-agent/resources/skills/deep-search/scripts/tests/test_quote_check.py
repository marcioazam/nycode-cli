"""Behavior tests for quote_check.py; HTTP cases use a local server only."""
import http.server
import io
import json
from pathlib import Path
import socket
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import quote_check as qc  # noqa: E402

QUOTE = 'The lead agent spins up subagents in parallel rather than serially.'
PAGE = ('<html><head><title>t</title><style>.x{}</style><script>var hidden = "secret phrase here";</script>'
        '</head><body><p>Intro.</p><p>The lead agent spins up&nbsp;subagents in parallel rather than '
        'serially.</p><noscript>enable js please now</noscript></body></html>')


MARKDOWN = '# Versioning\n\nThe current protocol version is [2026-07-28](https://example.org/spec/2026-07-28/). **Bold** `code`.\n'


class Handler(http.server.BaseHTTPRequestHandler):
    hits = []

    def log_message(self, *args):
        pass

    def send(self, code, body=b'', ctype='text/html; charset=utf-8', headers=()):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        for key, value in headers:
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        Handler.hits.append((self.path, dict(self.headers)))
        port = self.server.server_address[1]
        routes = {
            '/page': lambda: self.send(200, PAGE.encode()),
            '/latin': lambda: self.send(200, '<p>Ação de verificação de citações em português.</p>'.encode('latin-1'),
                                        'text/html; charset=latin-1'),
            '/plain': lambda: self.send(200, QUOTE.encode(), 'text/plain'),
            '/pdf': lambda: self.send(200, b'%PDF-1.7', 'application/pdf'),
            '/forbidden': lambda: self.send(403),
            '/limited': lambda: self.send(429),
            '/missing': lambda: self.send(404),
            '/big': lambda: self.send(200, b'a' * 4096),
            '/slow': lambda: (time.sleep(1.0), self.send(200, PAGE.encode())),
            '/loop': lambda: self.send(302, headers=[('Location', '/loop')]),
            '/to-private': lambda: self.send(302, headers=[('Location', f'http://127.0.0.1:{port}/page')]),
            '/to-file': lambda: self.send(302, headers=[('Location', 'file:///etc/passwd')]),
            '/md': lambda: self.send(200, MARKDOWN.encode(), 'text/markdown; charset=utf-8'),
            '/js': lambda: self.send(200, b'<html><body><div id="root"></div></body></html>'),
            '/no-md': lambda: (self.send(404) if self.headers.get('Accept', '').startswith('text/markdown')
                               else self.send(200, PAGE.encode())),
        }
        if self.path.startswith('/proxy/'):
            inner = self.path[len('/proxy/'):]
            ok = inner.endswith(('/js', '/forbidden'))
            return self.send(200 if ok else 404, f'Title: t\n\nMarkdown Content:\n{QUOTE}'.encode(), 'text/plain; charset=utf-8')
        routes.get(self.path, lambda: self.send(404))()


class LocalServer(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        cls.port = cls.server.server_address[1]
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def url(self, path, host='localhost'):
        return f'http://{host}:{self.port}{path}'

    def fetch(self, path, host='localhost'):
        return qc.fetch_page(self.url(path, host), allow_host=lambda h: h == 'localhost')


class MatchingTests(unittest.TestCase):
    def test_normalize_folds_unicode_quotes_dashes_space_and_case(self):
        self.assertEqual(qc.normalize('“Smart” quotes — and ‘dashes’ ﬁ  TEXT'),
                         '"smart" quotes - and \'dashes\' fi text')

    def test_exact_quote_is_verified(self):
        self.assertEqual(qc.quote_status('Before. ' + QUOTE + ' After.', QUOTE)[0], 'verified')

    def test_quote_with_typographic_differences_is_verified(self):
        page = 'He said “the lead agent spins up subagents—in parallel” today and more words.'
        self.assertEqual(qc.quote_status(page, '"The lead agent spins up subagents-in parallel"')[0], 'verified')

    def test_ellipsis_splits_fragments_that_must_appear_in_order(self):
        page = 'Alpha beta gamma delta. Many words between here. Epsilon zeta eta theta.'
        self.assertEqual(qc.quote_status(page, 'Alpha beta gamma … epsilon zeta eta')[0], 'verified')
        self.assertEqual(qc.quote_status(page, 'Epsilon zeta eta [...] alpha beta gamma')[0], 'mismatch')

    def test_quote_copied_from_raw_markdown_matches_rendered_text(self):
        page = 'Set the GITHUB_PAT environment variable. With no GROUPS or TOOLS, all 32 tools are enabled.'
        self.assertEqual(qc.quote_status(page, 'With no `GROUPS` or `TOOLS`, all **32 tools** are enabled.')[0], 'verified')
        self.assertEqual(qc.quote_status('Events go to our Umami Cloud instance now.',
                                         'Events go to our [Umami Cloud](https://umami.is) instance')[0], 'verified')

    def test_absent_quote_is_mismatch(self):
        self.assertEqual(qc.quote_status('Totally unrelated page text here.', QUOTE)[0], 'mismatch')

    def test_short_quote_is_invalid(self):
        self.assertEqual(qc.quote_status(QUOTE, 'lead agent')[0], 'invalid')

    def test_html_to_text_drops_script_style_noscript_and_decodes_entities(self):
        text = qc.html_to_text(PAGE)
        self.assertIn('spins up subagents', qc.normalize(text))
        self.assertNotIn('secret phrase', text)
        self.assertNotIn('.x{}', text)
        self.assertNotIn('enable js', text)


class HostTests(unittest.TestCase):
    def addr(self, ip):
        family = socket.AF_INET6 if ':' in ip else socket.AF_INET
        return [(family, socket.SOCK_STREAM, 6, '', (ip, 443))]

    def test_public_address_allowed(self):
        with mock.patch('socket.getaddrinfo', return_value=self.addr('93.184.216.34')):
            self.assertTrue(qc.public_host('example.org'))

    def test_private_loopback_link_local_and_reserved_refused(self):
        for ip in ('10.0.0.5', '127.0.0.1', '169.254.169.254', '192.168.1.1', '::1', '0.0.0.0', '240.0.0.1'):
            with self.subTest(ip=ip), mock.patch('socket.getaddrinfo', return_value=self.addr(ip)):
                self.assertFalse(qc.public_host('internal.example'))

    def test_any_private_answer_refuses_host(self):
        answers = self.addr('93.184.216.34') + self.addr('10.1.2.3')
        with mock.patch('socket.getaddrinfo', return_value=answers):
            self.assertFalse(qc.public_host('mixed.example'))

    def test_unresolvable_host_refused(self):
        with mock.patch('socket.getaddrinfo', side_effect=socket.gaierror('no')):
            self.assertFalse(qc.public_host('nope.invalid'))


class FetchTests(LocalServer):
    def test_html_page_text_returned(self):
        status, text, _ = self.fetch('/page')
        self.assertIsNone(status)
        self.assertIn('subagents in parallel', qc.normalize(text))

    def test_sends_identity_encoding_and_identified_agent(self):
        Handler.hits.clear()
        self.fetch('/page')
        headers = Handler.hits[-1][1]
        self.assertEqual(headers.get('Accept-Encoding'), 'identity')
        self.assertIn('quote-check', headers.get('User-Agent', ''))

    def test_requests_markdown_first(self):
        Handler.hits.clear()
        self.fetch('/page')
        self.assertTrue(Handler.hits[-1][1].get('Accept', '').startswith('text/markdown'))

    def test_markdown_page_drops_link_and_emphasis_syntax(self):
        status, text, _ = self.fetch('/md')
        self.assertIsNone(status)
        self.assertEqual(qc.quote_status(text, 'The current protocol version is 2026-07-28. Bold code.')[0], 'verified')

    def test_markdown_negotiation_failure_falls_back_to_html_once(self):
        Handler.hits.clear()
        status, text, _ = self.fetch('/no-md')
        self.assertIsNone(status)
        self.assertIn('subagents in parallel', qc.normalize(text))
        self.assertEqual([h[1].get('Accept', '')[:9] for h in Handler.hits], ['text/mark', 'text/html'])

    def test_real_not_found_is_still_unreachable_after_one_html_retry(self):
        Handler.hits.clear()
        self.assertEqual(self.fetch('/missing')[0], 'unreachable')
        self.assertEqual(len(Handler.hits), 2)

    def test_declared_charset_decoded(self):
        status, text, _ = self.fetch('/latin')
        self.assertIsNone(status)
        self.assertIn('Ação de verificação', text)

    def test_plain_text_accepted(self):
        self.assertIsNone(self.fetch('/plain')[0])

    def test_pdf_is_unsupported_type(self):
        self.assertEqual(self.fetch('/pdf')[0], 'unsupported_type')

    def test_forbidden_and_rate_limited_are_blocked_without_retry(self):
        self.assertEqual(self.fetch('/forbidden')[0], 'blocked')
        Handler.hits.clear()
        self.assertEqual(self.fetch('/limited')[0], 'blocked')
        self.assertEqual(len(Handler.hits), 1)

    def test_not_found_is_unreachable(self):
        status, _, reason = self.fetch('/missing')
        self.assertEqual(status, 'unreachable')
        self.assertIn('404', reason)

    def test_body_over_limit_is_unreachable(self):
        with mock.patch.object(qc, 'MAX_BYTES', 1024):
            status, _, reason = self.fetch('/big')
        self.assertEqual(status, 'unreachable')
        self.assertIn('too large', reason)

    def test_timeout_is_unreachable(self):
        with mock.patch.object(qc, 'TIMEOUT', 0.2):
            self.assertEqual(self.fetch('/slow')[0], 'unreachable')

    def test_redirect_loop_is_unreachable(self):
        self.assertEqual(self.fetch('/loop')[0], 'unreachable')

    def test_redirect_to_refused_host_is_invalid(self):
        status, _, reason = self.fetch('/to-private')
        self.assertEqual(status, 'invalid')
        self.assertIn('127.0.0.1', reason)

    def test_redirect_to_non_http_scheme_is_invalid(self):
        self.assertEqual(self.fetch('/to-file')[0], 'invalid')

    def test_refused_first_host_never_requested(self):
        Handler.hits.clear()
        status, _, _ = self.fetch('/page', host='127.0.0.1')
        self.assertEqual(status, 'invalid')
        self.assertEqual(Handler.hits, [])

    def test_non_http_scheme_is_invalid(self):
        for url in ('file:///etc/passwd', 'ftp://example.org/x', 'not a url'):
            with self.subTest(url=url):
                self.assertEqual(qc.fetch_page(url, allow_host=lambda h: True)[0], 'invalid')

    def test_default_guard_refuses_loopback_server(self):
        self.assertEqual(qc.fetch_page(self.url('/page', '127.0.0.1'))[0], 'invalid')


class CheckItemsTests(LocalServer):
    def run_items(self, items, **kwargs):
        return qc.check_items(items, allow_host=lambda h: h == 'localhost', **kwargs)

    def test_statuses_per_item(self):
        items = [{'id': 'C1', 'url': self.url('/page'), 'quote': QUOTE},
                 {'id': 'C2', 'url': self.url('/page'), 'quote': 'This sentence is not on the page at all.'},
                 {'id': 'C3', 'url': self.url('/forbidden'), 'quote': QUOTE},
                 {'id': 'C4', 'url': self.url('/page')},
                 {'id': 'C5', 'url': self.url('/plain'), 'quote': 'tiny'}]
        result = {r['id']: r['status'] for r in self.run_items(items, sleep=lambda s: None)}
        self.assertEqual(result, {'C1': 'verified', 'C2': 'mismatch', 'C3': 'blocked', 'C4': 'invalid',
                                  'C5': 'invalid'})

    def proxied(self, items, proxy=True, sleep=lambda s: None, clock=time.monotonic):
        # The proxy is its own domain (127.0.0.1 here, r.jina.ai in use), so origin hits never delay it.
        with mock.patch.object(qc, 'PROXY', self.url('/proxy/', host='127.0.0.1')):
            return qc.check_items(items, allow_host=lambda h: h in ('localhost', '127.0.0.1'), sleep=sleep,
                                  clock=clock, proxy=proxy)

    def test_mismatch_and_blocked_pages_are_reread_once_through_the_proxy_reader(self):
        Handler.hits.clear()
        items = [{'id': 'J', 'url': self.url('/js'), 'quote': QUOTE},
                 {'id': 'F', 'url': self.url('/forbidden'), 'quote': QUOTE},
                 {'id': 'M', 'url': self.url('/missing'), 'quote': QUOTE}]
        rows = {r['id']: r for r in self.proxied(items)}
        self.assertEqual([rows[i]['status'] for i in 'JFM'], ['verified', 'verified', 'unreachable'])
        self.assertIn('via proxy reader', rows['J']['reason'])
        self.assertEqual(rows['J']['via'], '127.0.0.1')
        self.assertEqual(sum(1 for path, _ in Handler.hits if path.startswith('/proxy/')), 2)

    def test_proxy_reader_can_be_disabled(self):
        Handler.hits.clear()
        rows = self.proxied([{'id': 'J', 'url': self.url('/js'), 'quote': QUOTE}], proxy=False)
        self.assertEqual(rows[0]['status'], 'mismatch')
        self.assertFalse(any(path.startswith('/proxy/') for path, _ in Handler.hits))

    def test_proxy_reads_are_spaced_for_its_rate_limit(self):
        waits, now = [], [100.0]
        items = [{'id': p, 'url': self.url(p), 'quote': QUOTE} for p in ('/js', '/forbidden')]
        with mock.patch.object(qc, 'DOMAIN_DELAY', 0):
            self.proxied(items, sleep=waits.append, clock=lambda: now[0])
        self.assertEqual(waits, [qc.PROXY_DELAY])

    def test_rows_with_a_read_page_carry_fetch_time_and_content_hash(self):
        rows = self.run_items([{'id': 'C1', 'url': self.url('/page'), 'quote': QUOTE},
                               {'id': 'C2', 'url': self.url('/missing'), 'quote': QUOTE}], sleep=lambda s: None)
        self.assertRegex(rows[0]['fetched_at'], r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$')
        self.assertRegex(rows[0]['sha256'], r'^[0-9a-f]{64}$')
        self.assertNotIn('sha256', rows[1])

    def test_same_domain_requests_are_spaced(self):
        waits, now = [], [100.0]
        items = [{'id': p, 'url': self.url(p), 'quote': QUOTE} for p in ('/page', '/plain', '/latin')]
        self.run_items(items, sleep=waits.append, clock=lambda: now[0])
        self.assertEqual(len(waits), 2)
        self.assertTrue(all(0 < w <= qc.DOMAIN_DELAY for w in waits))

    def test_each_url_fetched_once(self):
        Handler.hits.clear()
        items = [{'id': 'A', 'url': self.url('/page'), 'quote': QUOTE},
                 {'id': 'B', 'url': self.url('/page'), 'quote': 'Intro. The lead agent spins up subagents'}]
        result = self.run_items(items, sleep=lambda s: None)
        self.assertEqual([r['status'] for r in result], ['verified', 'verified'])
        self.assertEqual(len(Handler.hits), 1)


class CliTests(LocalServer):
    def run_cli(self, payload, argv=('-',)):
        out = io.StringIO()
        with mock.patch.object(qc, 'public_host', lambda h: h == 'localhost'):
            code = qc.main(list(argv), stdin=io.StringIO(payload), stdout=out)
        return code, out.getvalue()

    def test_stdin_json_to_stdout_json(self):
        code, out = self.run_cli(json.dumps([{'id': 'C1', 'url': self.url('/page'), 'quote': QUOTE}]))
        self.assertEqual(code, 0)
        row = json.loads(out)[0]
        self.assertEqual({k: row[k] for k in ('id', 'status', 'reason')}, {'id': 'C1', 'status': 'verified', 'reason': 'quote found'})
        self.assertEqual(set(row), {'id', 'status', 'reason', 'fetched_at', 'sha256'})

    def test_no_proxy_flag(self):
        code, out = self.run_cli(json.dumps([{'id': 'C1', 'url': self.url('/js'), 'quote': QUOTE}]), argv=('--no-proxy', '-'))
        self.assertEqual((code, json.loads(out)[0]['status']), (0, 'mismatch'))

    def test_file_argument(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        path = Path(temp.name) / 'ledger.json'
        path.write_text(json.dumps([{'id': 'C1', 'url': self.url('/missing'), 'quote': QUOTE}]))
        code, out = self.run_cli('', argv=(str(path),))
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out)[0]['status'], 'unreachable')

    def test_invalid_json_exits_2(self):
        code, out = self.run_cli('{not json')
        self.assertEqual(code, 2)
        self.assertIn('error', json.loads(out))

    def test_non_list_and_too_many_items_exit_2(self):
        self.assertEqual(self.run_cli('{"id": 1}')[0], 2)
        many = [{'id': str(i), 'url': 'https://example.org', 'quote': QUOTE} for i in range(qc.MAX_ITEMS + 1)]
        self.assertEqual(self.run_cli(json.dumps(many))[0], 2)

    def test_missing_argument_exits_2(self):
        self.assertEqual(self.run_cli('', argv=())[0], 2)

    def test_help_prints_usage_and_exits_0(self):
        code, out = self.run_cli('', argv=('--help',))
        self.assertEqual(code, 0)
        self.assertIn('Usage: python3 quote_check.py', out)


if __name__ == '__main__':
    unittest.main()
