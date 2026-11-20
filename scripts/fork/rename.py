#!/usr/bin/env python3
"""Renomeia pi -> nycode em um worktree. Uso: rename.py ROOT [--dry]"""
import os, re, subprocess, sys, collections

root = sys.argv[1]
dry = "--dry" in sys.argv
os.chdir(root)

SKIP_NAMES = {"package-lock.json", "flake.lock", "LICENSE", "NOTICE"}
SKIP_BASENAME_RE = re.compile(r"^CHANGELOG(\..*)?\.md$")
SKIP_PATH_PARTS = ("/third-party/", "examples/extensions/doom-overlay/doom/")

files = subprocess.check_output(["git", "ls-files", "-z"], text=True).split("\0")
files = [f for f in files if not f.endswith(".jsonl")]
files = [f for f in files if f and os.path.isfile(f) and not os.path.islink(f)]

WORKSPACE_PI = "agent-core|ai|codemode|coding-agent-install|coding-agent|durable|env|evals|mcp|schema|telemetry|tui"
KEEP_SCOPE = (r"@earendil-works/(?:gondolin[\w./-]*|elanor[\w./-]*|design-tokens|dev-probe|p2-contracts|p2\b|"
              r"pi-agent-old|pi-server|pi-client|pi-protocol|schema\b|x\b|undeclared)")

masks = [
    re.compile(r"@mariozechner/[\w./-]*"), re.compile(r"HazAT/pi-[\w-]+"), re.compile(r"badlogic/pi-observers"),
    re.compile(r"pi-markdown-preview"), re.compile(r"pi-interactive-subagents"),
    re.compile(r"(?:earendil-works|badlogic)/pi(?:-mono)?/(?:issues|pull|discussions)/\d+"),
    re.compile(r"(?:earendil-works|badlogic)/pi(?:-mono)?#\d+"),
    re.compile(r"(?<!@)earendil-works/pi-(?!mono)[\w-]+"),
    re.compile(r"(?<=\(\?:badlogic\|earendil-works\)/)pi-mono"),
    re.compile(r"npm:pi-[\w@.-]*"), re.compile(r"@oh-my-pi/[\w.-]+"),
    re.compile(r"[pP]\{Pi\}"), re.compile(r"\bpi-(?:formatter|tools)\b"),
    re.compile(r"pi\.dev"), re.compile(r"pkg\.earendil\.com"), re.compile(r"pi\.LICENSE"),
    re.compile(r"earendil-works/pi-agent-old"), re.compile(KEEP_SCOPE),
    re.compile(r"[A-Za-z0-9+/=]{40,}"),  # filtrado abaixo: so base64 (digito + maiuscula)
]

REPO = r"(?:earendil-works|badlogic)/pi(?:-mono)?(?![\w-])"
pre = [  # URLs do repo
    (re.compile(r"(?:(?<=github\.com/)|(?<=github:)|(?<=github\.com:)|(?<![\w@./:-]))" + REPO), "marcioazam/nycode-cli"),
]
WS = "agent-core|ai|codemode|coding-agent-install|coding-agent|durable|env|evals|mcp|schema|telemetry|tui"
SEP = r"(\\\\|\\/|/|\+|[\"'`]\s*,\s*[\"'`])"
scope = [
    (re.compile(r"@earendil-works" + SEP + r"pi-(%s)(?![A-Za-z0-9-])" % WS), r"@nycode\1\2"),
    (re.compile(r"@earendil-works" + SEP + r"(chord|p3-sign-in|p3-sessions|p3-runner|p3-control|p3)(?![A-Za-z0-9-])"), r"@nycode\1\2"),
    (re.compile(r"@earendil-works/pi-(?=[\"'`])"), "@nycode/"),
]
words = [
    (re.compile(r"\bPI_(?=[A-Z0-9])"), "NYCODE_"),
    (re.compile(r"(?<![A-Za-z0-9])pi(?![a-z0-9])"), "nycode"),
    (re.compile(r"(?<![A-Za-z])Pi(?![a-z])"), "Nycode"),
    (re.compile(r"(?<=[a-z])Pi(?![a-z])"), "Nycode"),
]

seen = collections.Counter()


def transform(text, path):
    hold = []

    def keep(m):
        s = m.group(0)
        if len(s) >= 40 and not (re.search(r"\d", s) and re.search(r"[A-Z]", s) and re.search(r"[a-z]", s)):
            return s  # caminho ou identificador longo, nao base64
        hold.append(s)
        return "\x00%d\x00" % (len(hold) - 1)

    for rx in masks:
        text = rx.sub(keep, text)
    for rx, rep in pre + scope:
        text = rx.sub(rep, text)
    for rx, rep in words:
        if dry:
            for m in rx.finditer(text):
                a, b = max(0, m.start() - 14), min(len(text), m.end() + 14)
                seen[re.sub(r"\s+", " ", text[a:b])] += 1
        text = rx.sub(rep, text)
    return re.sub(r"\x00(\d+)\x00", lambda m: hold[int(m.group(1))], text)


def skipped(f):
    return (os.path.basename(f) in SKIP_NAMES or SKIP_BASENAME_RE.match(os.path.basename(f))
            or any(p in "/" + f for p in SKIP_PATH_PARTS))


changed = 0
for f in files:
    if skipped(f):
        continue
    raw = open(f, "rb").read()
    if b"\0" in raw:
        continue
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        continue
    new = transform(text, f)
    if new != text:
        changed += 1
        if not dry:
            with open(f, "wb") as fh:
                fh.write(new.encode("utf-8"))
print("arquivos de conteudo alterados:", changed)

# renomeia caminhos (componentes)
renames = []
for f in files:
    if skipped(f):
        continue
    new = "/".join(
        re.sub(r"(?<![A-Za-z])Pi(?=[A-Z])", "Nycode", re.sub(r"(?<![A-Za-z0-9])pi(?![a-z0-9])", "nycode", part))
        for part in f.split("/"))
    if new != f:
        renames.append((f, new))
for a, b in renames:
    print("mv", a, "->", b)
    if not dry:
        os.makedirs(os.path.dirname(b) or ".", exist_ok=True)
        subprocess.check_call(["git", "mv", a, b])

if dry:
    with open("/tmp/nycode-rename/dry.txt", "w") as fh:
        for k, v in seen.most_common():
            fh.write("%6d  %s\n" % (v, k))
