"""Check that each cited quote appears on its source page.

Usage: python3 quote_check.py [--no-proxy] LEDGER.json | -   (JSON list of {id, url, quote})
Prints a JSON list of {id, status, reason}; status is verified, mismatch, blocked,
unreachable, unsupported_type or invalid. Rows whose page was read also carry fetched_at (UTC)
and sha256 of the normalized page text. Markdown is requested first (Cloudflare Markdown for Agents).
A mismatch or blocked page is reread once through the keyless r.jina.ai reader, which renders
JavaScript pages (public URLs only; 20 requests a minute); --no-proxy turns that off.
Reads the network, writes nothing.
"""
import datetime
import hashlib
from html.parser import HTMLParser
import ipaddress
import json
import re
import socket
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

TIMEOUT = 15
MAX_BYTES = 5 * 1024 * 1024
MAX_ITEMS = 200
MAX_REDIRECTS = 5
MIN_QUOTE = 20
DOMAIN_DELAY = 1.0
PROXY = 'https://r.jina.ai/'
PROXY_DELAY = 3.1  # keyless r.jina.ai allows 20 requests a minute
USER_AGENT = 'quote-check/1.0 (citation verification for the deep-search skill)'
TEXT_TYPES = ('text/html', 'application/xhtml+xml', 'text/plain', 'text/markdown')
ACCEPT = 'text/markdown, text/html;q=0.9, application/xhtml+xml;q=0.9, text/plain;q=0.8'
HTML_ACCEPT = 'text/html,application/xhtml+xml,text/plain'
NEGOTIATION_CODES = {404, 406, 415}  # some sites reject a markdown-first Accept; retry once with HTML only
BLOCKED_CODES = {401, 403, 429, 451}
FOLD = str.maketrans({'‘': "'", '’': "'", '‚': "'", '‛': "'", '“': '"', '”': '"', '„': '"', '‟': '"',
                      '‐': '-', '‑': '-', '‒': '-', '–': '-', '—': '-', '―': '-', '−': '-'})
ELLIPSIS = re.compile(r'\[\s*\.\.\.\s*\]|\.\.\.')
MD_LINK = re.compile(r'!?\[([^\]]*)\]\([^)\s]*(?:\s+"[^"]*")?\)')
MD_MARK = re.compile(r'\*\*|__|`|^#+\s*', re.M)


def normalize(text):
    text = unicodedata.normalize('NFKC', text).translate(FOLD)
    return ' '.join(text.split()).casefold()


def _fragments_in(page, quote):
    start = 0
    for fragment in quote:
        found = page.find(fragment, start)
        if found < 0:
            return False
        start = found + len(fragment)
    return True


def quote_status(page_text, quote):
    fragments = [f.strip(' "\'') for f in ELLIPSIS.split(normalize(quote))]
    fragments = [f for f in fragments if f]
    if sum(len(f) for f in fragments) < MIN_QUOTE:
        return 'invalid', f'quote shorter than {MIN_QUOTE} characters'
    page = normalize(page_text)
    if _fragments_in(page, fragments):
        return 'verified', 'quote found'
    # A quote copied from raw Markdown (backticks, **bold**, [text](url)) against the rendered page.
    plain = [f.strip(' "\'') for f in ELLIPSIS.split(normalize(markdown_to_text(quote))) if f.strip(' "\'')]
    if plain != fragments and _fragments_in(page, plain):
        return 'verified', 'quote found after removing Markdown syntax'
    return 'mismatch', 'quote not found on page'


class _Text(HTMLParser):
    SKIP = {'script', 'style', 'noscript', 'template'}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts, self.depth = [], 0

    def handle_starttag(self, tag, attrs):
        self.depth += tag in self.SKIP

    def handle_endtag(self, tag):
        self.depth -= tag in self.SKIP and self.depth > 0

    def handle_data(self, data):
        if not self.depth:
            self.parts.append(data)


def markdown_to_text(text):
    """Keep link text, drop link targets and emphasis/code/heading marks so quotes match prose."""
    return MD_MARK.sub('', MD_LINK.sub(r'\1', text))


def html_to_text(html):
    parser = _Text()
    parser.feed(html)
    parser.close()
    return ' '.join(parser.parts)


def public_host(host):
    # ponytail: resolve-then-connect leaves a DNS-rebinding window; pin the IP if this ever runs unattended.
    try:
        answers = socket.getaddrinfo(host, None)
    except (socket.gaierror, UnicodeError):
        return False
    ips = {ipaddress.ip_address(str(a[4][0]).split('%')[0]) for a in answers}
    return bool(ips) and all(ip.is_global and not ip.is_multicast for ip in ips)


class _Refused(Exception):
    pass


def _allowed(url, allow_host):
    parts = urllib.parse.urlsplit(url)
    if parts.scheme not in ('http', 'https') or not parts.hostname:
        raise _Refused(f'refused URL {url!r}: only http(s) with a host')
    if not allow_host(parts.hostname):
        raise _Refused(f'refused host {parts.hostname}: not a public address')


def _opener(allow_host):
    class Redirect(urllib.request.HTTPRedirectHandler):
        max_redirections = MAX_REDIRECTS

        def http_error_302(self, req, fp, code, msg, headers):
            location = headers.get('location') or headers.get('uri')
            if location:
                _allowed(urllib.parse.urljoin(req.full_url, location), allow_host)
            return super().http_error_302(req, fp, code, msg, headers)

        http_error_301 = http_error_303 = http_error_307 = http_error_308 = http_error_302

    return urllib.request.build_opener(Redirect)


def fetch_page(url, allow_host=public_host, accept=ACCEPT):
    """Return (status, text, reason); status is None when text was read."""
    try:
        _allowed(url, allow_host)
        request = urllib.request.Request(url, headers={'User-Agent': USER_AGENT, 'Accept-Encoding': 'identity',
                                                       'Accept': accept})
        with _opener(allow_host).open(request, timeout=TIMEOUT) as response:
            ctype = response.headers.get_content_type()
            if ctype not in TEXT_TYPES:
                return 'unsupported_type', None, f'content type {ctype}'
            body = response.read(MAX_BYTES + 1)
            if len(body) > MAX_BYTES:
                return 'unreachable', None, f'body too large (> {MAX_BYTES} bytes)'
            text = body.decode(response.headers.get_content_charset() or 'utf-8', errors='replace')
            readable = markdown_to_text(text) if ctype in ('text/plain', 'text/markdown') else html_to_text(text)
            return None, readable, f'HTTP {response.status}'
    except _Refused as exc:
        return 'invalid', None, str(exc)
    except urllib.error.HTTPError as exc:
        if exc.code in NEGOTIATION_CODES and accept != HTML_ACCEPT:
            return fetch_page(url, allow_host, HTML_ACCEPT)
        if exc.code in BLOCKED_CODES:
            return 'blocked', None, f'HTTP {exc.code}'
        return 'unreachable', None, f'HTTP {exc.code}'
    except (urllib.error.URLError, OSError, ValueError) as exc:
        return 'unreachable', None, f'{type(exc).__name__}: {getattr(exc, "reason", exc)}'


def check_items(items, allow_host=public_host, sleep=time.sleep, clock=time.monotonic, proxy=True):
    pages, last_hit, results = {}, {}, []

    def read(url):
        """Fetch once per URL, spacing requests per domain; remember when the page was read."""
        if url not in pages:
            domain = urllib.parse.urlsplit(url).hostname
            delay = PROXY_DELAY if url.startswith(PROXY) else DOMAIN_DELAY
            wait = delay - (clock() - last_hit[domain]) if domain in last_hit else 0
            if wait > 0:
                sleep(wait)
            fetched_at = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
            pages[url] = (*fetch_page(url, allow_host), fetched_at)
            last_hit[domain] = clock()
        return pages[url]

    for item in items:
        url, quote = item.get('url'), item.get('quote')
        if not isinstance(url, str) or not isinstance(quote, str):
            results.append({'id': item.get('id'), 'status': 'invalid', 'reason': 'url and quote must be strings'})
            continue
        status, text, reason, fetched_at = read(url)
        if status is None:
            status, reason = quote_status(text, quote)
        row = {'id': item.get('id'), 'status': status, 'reason': reason}
        # A JavaScript shell or a bot wall says nothing about the claim: reread once through the rendering proxy.
        if proxy and status in ('mismatch', 'blocked') and not url.startswith(PROXY):
            p_status, p_text, _, p_fetched = read(PROXY + url)
            if p_status is None and quote_status(p_text, quote)[0] == 'verified':
                text, fetched_at = p_text, p_fetched
                row.update(status='verified', reason='quote found via proxy reader',
                           via=urllib.parse.urlsplit(PROXY).hostname)
        if text is not None:
            row.update(fetched_at=fetched_at, sha256=hashlib.sha256(normalize(text).encode()).hexdigest())
        results.append(row)
    return results


def main(argv=None, stdin=None, stdout=None):
    argv = sys.argv[1:] if argv is None else argv
    stdin, stdout = stdin or sys.stdin, stdout or sys.stdout
    if argv and argv[0] in ('-h', '--help'):
        stdout.write(__doc__)
        return 0
    try:
        proxy = '--no-proxy' not in argv
        argv = [a for a in argv if a != '--no-proxy']
        if len(argv) != 1:
            raise ValueError('usage: quote_check.py [--no-proxy] LEDGER.json | -')
        raw = stdin.read() if argv[0] == '-' else open(argv[0], encoding='utf-8').read()
        items = json.loads(raw)
        if not isinstance(items, list) or not all(isinstance(i, dict) for i in items):
            raise ValueError('input must be a JSON list of objects')
        if len(items) > MAX_ITEMS:
            raise ValueError(f'at most {MAX_ITEMS} items per run')
    except (OSError, ValueError) as exc:
        json.dump({'error': str(exc)}, stdout)
        return 2
    json.dump(check_items(items, allow_host=public_host, proxy=proxy), stdout, ensure_ascii=False, indent=1)
    return 0


if __name__ == '__main__':
    sys.exit(main())
