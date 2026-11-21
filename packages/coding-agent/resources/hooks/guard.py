#!/usr/bin/env python3
"""Guard de permissões do nycode (hook PreToolUse, no estilo Claude Code).

Registrado por padrão em hooks.PreToolUse de settings-defaults.ts (matcher Bash|Edit|Write|Read).
Lê o payload JSON do stdin e responde:
  - nada (exit 0)  -> allow
  - permissionDecision "ask"  -> o nycode mostra confirmação; sem UI (nycode -p, subagent) vira bloqueio
  - permissionDecision "deny" -> bloqueado sempre

Política "Equilibrada":
  DENY (catastrófico; nem o bypass libera):
    rm recursivo+force, mkfs, dd of=/dev/..., redirecionar para disco (/dev/sd*, nvme*...),
    curl|wget com pipe para shell, git push --force para main/master, fork bomb,
    chmod/chown -R na raiz, pkill -f / pgrep -f ligado a kill cujo padrão casa com a própria linha
    do `bash -c` (o shell se mata: exit 143/144; use o colchete, `pkill -f '[n]ome'`, ou o PID).
    Também (2026-11): dispositivos de bloco (dm/loop/md/mapper...) via redirect/dd/tee/cp/mv, wipefs -a,
    cryptsetup luksFormat/erase, blkdiscard, sgdisk --zap-all, parted mklabel, sfdisk em /dev,
    shutdown/reboot/poweroff/halt/init 0|6/systemctl poweroff|reboot|halt|kexec, kill -1 ou PID 1,
    git push apagando main/master, rm -r em /, ~, $HOME e diretórios de sistema.
    Corpo de heredoc (exceto lido por shell) é mascarado: texto citado não é comando.
  ASK (arriscado):
    sudo/su/doas, rm -r, git reset --hard / clean -f / push / rebase / branch -D,
    chmod -R, chown -R, shred, kill -9, docker rm/rmi/prune, npm|pnpm|yarn publish,
    Edit/Write em arquivo sensível (.env*, chaves, ~/.ssh, ~/.aws, auth.json, settings do nycode,
    wrapper ~/.local/bin/nycode, rc do shell) ou fora do projeto atual (/tmp é livre).
  DENY de Read (paridade com as 13 regras Read(...) deny de ~/.claude/settings.json, mais as
    credenciais do nycode): ~/.ssh/**, ~/.config/claude-secrets/**, ~/.claude*/.credentials.json,
    ~/.nycode/agent/.credentials.json, ~/.codex/auth.json, ~/.config/mcp/secrets.env,
    ~/.nycode/agent/auth.json e mcp-auth.json, e em qualquer lugar .env, .env.local, .env.*.local,
    .env.production. Só a ferramenta read: `cat` via bash não é coberto (rules/safety.md).
  Resto: allow.

Bypass (igual ao "Bypass Permissions" do Claude Code): NYCODE_BYPASS_PERMISSIONS=1 transforma
todo ASK em allow; DENY continua. O padrão é o modo seguro (confirmações ligadas); o bypass entra
com NYCODE_BYPASS_PERMISSIONS=1 no ambiente do nycode. Este script só lê a variável: `--bypass` e
`permissions.bypass` não chegam a ele (o motor nativo de permissão, K11, os honra).

Ajustar: edite as listas/funções abaixo e rode `python3 -m pytest test/harness/hooks/test_guard.py` em packages/coding-agent.
Desligar: "hooks": {"PreToolUse": []} em ~/.nycode/agent/settings.json (ou "disableAllHooks": true).
Falha interna: JSON inválido permite (stderr); exceção na ferramenta Bash vira ASK "guard: erro interno"
(no bypass, aprovado sozinho como todo ASK); outras ferramentas permitem.
Análise do Bash: agrupamento/palavras-chave, opções de envoltórios, `bash -c`/eval/xargs/find -exec, $(...) e
crases (profundidade máx. 3, além disso ASK), continuação de linha, opções longas abreviadas e caminhos normalizados.
"""

from __future__ import annotations

import json
import os
import re
import shlex
import sys
import tempfile
from typing import Any

# fmt: off
HOME = os.path.expanduser("~")
SHELLS = {"sh", "bash", "zsh", "dash", "ksh", "fish"}
FETCHERS = {"curl", "wget"}
WRAPPERS = {"env", "nohup", "time", "command", "exec", "nice", "stdbuf", "timeout"}
# Opções de cada envoltório que consomem o argumento seguinte.
WRAPPER_VALUE_OPTS = {
    "env": {"-u", "-C", "-S", "--unset", "--chdir", "--split-string"}, "nice": {"-n", "--adjustment"},
    "stdbuf": {"-i", "-o", "-e", "--input", "--output", "--error"}, "timeout": {"-s", "-k", "--signal", "--kill-after"},
    "time": {"-f", "-o", "--format", "--output"}, "exec": {"-a"},
}
XARGS_VALUE_OPTS = {"-a", "-d", "-E", "-I", "-L", "-n", "-P", "-s", "--arg-file", "--delimiter", "--eof",
                    "--max-lines", "--max-args", "--max-procs", "--max-chars", "--process-slot-var"}
FIND_EXEC = {"-exec", "-execdir", "-ok", "-okdir"}
MAX_DEPTH = 3  # acima: ask, mas ainda analisa (deny vence) até HARD_DEPTH
HARD_DEPTH = 24
KEYWORDS = {"{", "}", "!", "then", "do", "else", "elif", "if", "while", "until", "fi", "done"}
Finding = tuple[str, str]
DEEP: Finding = ("ask", "comando aninhado fundo demais para analisar")
PRIV = {"sudo", "su", "doas"}
SEPARATORS = {";", "&&", "||", "|", "&", "|&", "\n"}
DISK_RE = re.compile(r"^/dev/(sd[a-z]|nvme\d|hd[a-z]|vd[a-z]|xvd[a-z]|mmcblk\d|disk\d|disk/|dm-\d|mapper/|loop\d|md\d)")
SAFE_DEV_RE = re.compile(r"^/dev/(null|stdout|stderr|tty|shm/|fd/)")
POWER_CMDS = {"shutdown", "reboot", "poweroff", "halt"}
SYSTEMCTL_POWER = {"poweroff", "reboot", "halt", "kexec"}
CATASTROPHIC_RM = {"", "~", "$HOME", "${HOME}", HOME, "/home", "/usr", "/etc", "/bin", "/sbin",
                   "/lib", "/lib64", "/boot", "/var", "/opt", "/root", "/srv"}
SFDISK_READ_FLAGS = {"-l", "--list", "-s", "--show-size", "-d", "--dump", "-J", "--json", "-F", "--list-free",
                     "-V", "--verify", "-h", "--help"}
FORK_BOMB_RE = re.compile(r"(\S+)\s*\(\)\s*\{\s*\1\s*\|\s*\1\s*&\s*\}")
PROTECTED_BRANCHES = {"main", "master"}

SENSITIVE_DIRS = [os.path.join(HOME, d) for d in (".ssh", ".aws", ".gnupg", ".config/gh", ".kube", ".docker")]
SENSITIVE_FILES = {
    os.path.join(HOME, p)
    for p in (
        ".nycode/agent/settings.json",
        ".nycode/agent/auth.json",
        ".local/bin/nycode",
        ".zshrc",
        ".zshenv",
        ".zprofile",
        ".bashrc",
        ".bash_profile",
        ".profile",
        ".netrc",
        ".npmrc",
        ".git-credentials",
    )
}
ENV_SAFE_SUFFIXES = (".example", ".sample", ".template", ".dist")
READ_DENY_DIRS = [os.path.join(HOME, d) for d in (".ssh", ".config/claude-secrets")]
READ_DENY_FILES = {
    os.path.join(HOME, p)
    for p in (
        ".codex/auth.json",
        ".config/mcp/secrets.env",
        ".nycode/agent/auth.json",
        ".nycode/agent/mcp-auth.json",
        ".nycode/agent/.credentials.json",
    )
}
CLAUDE_CREDENTIALS_RE = re.compile(r"^" + re.escape(HOME) + r"/\.claude(-[^/]+)?/\.credentials\.json$")
READ_DENY_ENV_RE = re.compile(r"^\.env(\.local|\.production|\..+\.local)?$")
# fmt: on


# ---------- parsing ----------


def tokenize(cmd: str) -> list[str]:
    try:
        lex = shlex.shlex(cmd.replace("\n", " ; "), posix=True, punctuation_chars=True)
        lex.whitespace_split = True
        lex.commenters = ""
        return list(lex)
    except ValueError:  # aspas desbalanceadas: corte grosseiro, melhor que nada
        return re.findall(r"\|\||&&|[;|&]|[^\s;|&]+", cmd)


def segments(tokens: list[str]) -> list[tuple[list[str], bool]]:
    """Lista de (argv, piped_from_previous). `(`, `)` e, em posição de comando, `{ } ! then do ...` separam."""
    out: list[tuple[list[str], bool]] = []
    cur: list[str] = []
    piped = next_piped = False
    for t in tokens:
        sep = t in SEPARATORS
        if sep or (not cur and t in KEYWORDS) or re.fullmatch(r"[<>]?\(+|\)+", t):
            if cur:
                out.append((cur, piped))
            if sep:
                next_piped = t in ("|", "|&")
            elif cur:
                next_piped = (
                    False  # agrupamento sem separador antes mantém o pipe pendente
                )
            cur, piped = [], False
            continue
        if not cur:
            piped, next_piped = next_piped, False
        cur.append(t)
    if cur:
        out.append((cur, piped))
    return out


def strip_prefixes(argv: list[str]) -> tuple[list[str], bool]:
    """Remove VAR=x, wrappers e sudo; devolve (argv_real, usou_privilegio)."""
    priv = False
    i = 0
    while i < len(argv):
        w = argv[i]
        base = os.path.basename(w)
        if re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", w):
            i += 1
        elif base in PRIV:
            priv = True
            i += 1
            while i < len(argv) and argv[i].startswith("-"):  # flags do sudo
                flag = argv[i]
                i += 1
                if flag in ("-u", "-g", "-C", "-h", "-p", "-c") and base != "su":
                    i += 1
                elif base == "su" and flag == "-c":
                    rest = argv[i:]
                    return (tokenize(rest[0]) if rest else []), True
        elif base in WRAPPERS:
            i += 1
            values = WRAPPER_VALUE_OPTS.get(base, set())
            while i < len(argv) and argv[i].startswith("-"):
                i += 2 if argv[i] in values else 1
            if base == "timeout":
                i += 1  # duração
        else:
            break
    return argv[i:], priv


def short_flags(args: list[str]) -> set[str]:
    flags: set[str] = set()
    for a in args:
        if a.startswith("--"):
            flags.add(a)
        elif a.startswith("-") and len(a) > 1:
            flags.update("-" + c for c in a[1:])
    return flags


def long_match(flags: set[str], name: str) -> bool:
    """Opção longa do GNU, inclusive abreviada por prefixo único (`--r` = `--recursive`)."""
    return any(
        f.startswith("--") and len(f) > 2 and name.startswith(f.split("=")[0])
        for f in flags
    )


def norm_path(p: str) -> str:
    """Normaliza caminho absoluto (`//dev/./sda` -> `/dev/sda`); outros ficam como estão."""
    return re.sub(r"^/+", "/", os.path.normpath(p)) if p.startswith("/") else p


def target_dirs(args: list[str]) -> list[str]:
    """Valores de -t / --target-directory (cp, mv)."""
    out = []
    for i, a in enumerate(args):
        if a.startswith("--target-directory="):
            out.append(a.split("=", 1)[1])
        elif a in ("-t", "--target-directory") and i + 1 < len(args):
            out.append(args[i + 1])
    return out


def skip_opts(args: list[str], values: set[str]) -> list[str]:
    """Remove as opções (e seus valores) do início de args; devolve o comando que sobra."""
    i = 0
    while i < len(args) and args[i].startswith("-") and args[i] != "--":
        i += 2 if args[i] in values else 1
    if i < len(args) and args[i] == "--":
        i += 1
    return args[i:]


def nested_commands(name: str, args: list[str]) -> tuple[list[str], list[list[str]]]:
    """Comandos dentro do comando: (scripts de shell para reanalisar, argvs para reanalisar)."""
    scripts: list[str] = []
    argvs: list[list[str]] = []
    if name in SHELLS:
        for i, a in enumerate(args[:-1]):
            if re.match(r"^-[a-zA-Z]*c[a-zA-Z]*$", a):
                scripts.append(args[i + 1])
                break
    elif name == "eval" and args:
        scripts.append(" ".join(args))
    elif name == "xargs":
        rest = skip_opts(args, XARGS_VALUE_OPTS)
        if rest:
            argvs.append(rest)
    elif name == "find":
        for i, a in enumerate(args):
            if a in FIND_EXEC:
                end = i + 1
                while end < len(args) and args[end] not in (";", "+"):
                    end += 1
                if end > i + 1:
                    argvs.append(args[i + 1 : end])
    return scripts, argvs


# ---------- regras bash ----------


def check_segment(
    argv: list[str],
    piped: bool,
    prev_names: set[str],
    cmd: str = "",
    depth: int = 0,
    cwd: str = "",
) -> tuple[list[Finding], str | None]:
    """Retorna lista de (nivel, motivo) para um segmento."""
    if depth > HARD_DEPTH:
        return [DEEP], None
    found: list[Finding] = [DEEP] if depth > MAX_DEPTH else []
    real, priv = strip_prefixes(argv)
    if priv:
        found.append(("ask", "comando com privilégio (sudo/su/doas)"))
    if not real:
        return found, None
    name = os.path.basename(real[0])
    args = real[1:]
    flags = short_flags(args)
    positional = [a for a in args if not a.startswith("-")]

    if piped and name in SHELLS and prev_names & FETCHERS:
        found.append(("deny", "download com pipe direto para shell"))

    for i, t in enumerate(argv):
        if (
            t in (">", ">>", ">|", "&>", ">&", "&>>")
            and i + 1 < len(argv)
            and DISK_RE.match(norm_path(argv[i + 1]))
        ):
            found.append(("deny", f"escrita direta em disco {argv[i + 1]}"))

    scripts, argvs = nested_commands(name, args)
    for script in scripts:
        found.extend(check_bash(script, cwd, depth + 1, cmd))
    for sub in argvs:
        found.extend(check_segment(sub, False, set(), cmd, depth + 1, cwd)[0])

    if name == "rm":
        rec = bool(flags & {"-r", "-R", "--recursive"}) or long_match(
            flags, "--recursive"
        )
        force = bool(flags & {"-f", "--force"}) or long_match(flags, "--force")
        if rec and force:
            found.append(("deny", "rm recursivo forçado"))
        elif rec:
            found.append(("ask", "rm recursivo"))
        if rec and any(catastrophic_rm_target(a) for a in positional):
            found.append(("deny", "rm recursivo em diretório raiz, home ou sistema"))
    elif name.startswith("mkfs"):
        found.append(("deny", "formatação de sistema de arquivos"))
    elif name == "dd" and any(
        a.startswith("of=/")
        and norm_path(a[3:]).startswith("/dev/")
        and not SAFE_DEV_RE.match(norm_path(a[3:]))
        for a in args
    ):
        found.append(("deny", "dd escrevendo em dispositivo"))
    elif name == "tee" and any(DISK_RE.match(norm_path(a)) for a in positional):
        found.append(("deny", "tee escrevendo em dispositivo de bloco"))
    elif name in ("cp", "mv") and any(
        DISK_RE.match(norm_path(t)) for t in positional[-1:] + target_dirs(args)
    ):
        found.append(("deny", f"{name} escrevendo em dispositivo de bloco"))
    elif name == "wipefs" and flags & {"-a", "--all", "-o", "--offset"}:
        found.append(("deny", "wipefs apagando assinaturas"))
    elif name == "cryptsetup" and set(positional) & {
        "luksFormat",
        "erase",
        "luksErase",
    }:
        found.append(("deny", "cryptsetup destruindo cabeçalho LUKS"))
    elif name == "blkdiscard":
        found.append(("deny", "blkdiscard apaga o dispositivo"))
    elif name == "sgdisk" and flags & {"-Z", "-z", "--zap-all", "--zap"}:
        found.append(("deny", "sgdisk apagando tabela de partições"))
    elif name == "parted" and {"mklabel", "mktable"} & set(positional):
        found.append(("deny", "parted mklabel apaga a tabela de partições"))
    elif (
        name == "sfdisk"
        and any(a.startswith("/dev/") for a in positional)
        and not flags & SFDISK_READ_FLAGS
    ):
        found.append(("deny", "sfdisk reescrevendo tabela de partições"))
    elif name in POWER_CMDS and "-c" not in flags:
        found.append(("deny", f"{name} desliga/reinicia a máquina"))
    elif name == "systemctl" and set(positional) & SYSTEMCTL_POWER:
        found.append(("deny", "systemctl desliga/reinicia a máquina"))
    elif name in ("init", "telinit") and positional[:1] and positional[0] in ("0", "6"):
        found.append(("deny", f"{name} desliga/reinicia a máquina"))
    elif name in ("chmod", "chown", "chgrp"):
        rec = bool(flags & {"-R", "--recursive"})
        if rec and "/" in [norm_path(a) for a in positional]:
            found.append(("deny", f"{name} recursivo na raiz"))
        elif rec:
            found.append(("ask", f"{name} recursivo"))
    elif name == "shred":
        found.append(("ask", "shred"))
    elif name in ("kill", "pkill", "killall"):
        if any(a in ("-9", "-KILL", "-SIGKILL") for a in args) or (
            "-s" in args and any(a in ("KILL", "9") for a in args)
        ):
            found.append(("ask", "kill -9"))
        if name == "kill" and kill_targets(args) & {"-1", "1"}:
            found.append(("deny", "kill em todos os processos ou no PID 1"))
        pattern = full_match_pattern(args) if name == "pkill" else None
        if pattern and matches_self(pattern, cmd):
            found.append(("deny", SELF_KILL_MSG.format("pkill")))
    elif name in ("docker", "podman"):
        if any(a in ("rm", "rmi", "prune") for a in args):
            found.append(("ask", f"{name} removendo recursos"))
    elif name in ("npm", "pnpm", "yarn", "bun") and "publish" in positional:
        found.append(("ask", f"{name} publish"))
    elif name == "git":
        found.extend(check_git(args, cwd))
    return found, name


def catastrophic_rm_target(t: str) -> bool:
    if not t or t[0] not in "/~$":
        return False
    t = norm_path(t)
    return re.sub(r"(/\*?)+$", "", t) in CATASTROPHIC_RM


def kill_targets(args: list[str]) -> set[str]:
    """Alvos de `kill` sem a especificação de sinal (-9, -KILL, -s X, -n X, --)."""
    i = 0
    if args and args[0] in ("-s", "-n", "--signal"):
        i = 2
    elif args and args[0].startswith("-") and args[0] != "--":
        i = 1
    if i < len(args) and args[i] == "--":
        i += 1
    return set(args[i:])


def strip_ref(a: str) -> str:
    return a.removeprefix("refs/heads/")


def deletes_protected(rest: list[str]) -> bool:
    strip = strip_ref
    pos = [a for a in rest if not a.startswith("-")]
    if any(
        a.lstrip("+").startswith(":") and strip(a.lstrip("+")[1:]) in PROTECTED_BRANCHES
        for a in pos
    ):
        return True
    return bool(short_flags(rest) & {"--delete", "-d"}) and any(
        strip(a) in PROTECTED_BRANCHES for a in pos
    )


def current_branch(cwd: str) -> str | None:
    """Branch atual lendo HEAD (`.git/HEAD` ou o gitdir de worktree) a partir de cwd, sem subprocesso."""
    d = os.path.abspath(cwd) if cwd else ""
    try:
        while d:
            g = os.path.join(d, ".git")
            if os.path.isfile(g):
                with open(g) as f:
                    first = f.readline().strip()
                if not first.startswith("gitdir:"):
                    return None
                g = os.path.join(d, first[7:].strip())
            if os.path.isdir(g):
                with open(os.path.join(g, "HEAD")) as f:
                    head = f.readline().strip()
                return (
                    head.removeprefix("ref: refs/heads/")
                    if head.startswith("ref: refs/heads/")
                    else None
                )
            parent = os.path.dirname(d)
            if parent == d:
                break
            d = parent
    except (OSError, UnicodeDecodeError):
        pass
    return None


def check_git(args: list[str], cwd: str = "") -> list[Finding]:
    i = 0
    while i < len(args) and args[i].startswith("-"):
        if args[i] in ("-C", "--git-dir", "--work-tree"):
            cwd = ""  # repositório diferente do cwd: branch desconhecida
        i += 2 if args[i] in ("-C", "-c", "--git-dir", "--work-tree") else 1
    if i >= len(args):
        return []
    sub, rest = args[i], args[i + 1 :]
    flags = short_flags(rest)
    if sub == "push":
        pos = [a for a in rest if not a.startswith("-")]
        force = (
            bool(flags & {"-f", "--force", "--mirror"})
            or any(f.startswith("--force-with-lease") for f in flags)
            or any(a.startswith("+") for a in rest)
        )
        head = current_branch(cwd) or ""
        targets = {strip_ref(a.split(":")[-1].lstrip("+")) for a in pos}
        targets |= {head for t in targets if t in ("HEAD", "@")}
        if deletes_protected(rest):
            return [("deny", "git push apagando main/master")]
        if force and ("--mirror" in flags or targets & PROTECTED_BRANCHES):
            return [("deny", "git push forçado para main/master")]
        if force and len(pos) <= 1 and current_branch(cwd) in PROTECTED_BRANCHES:
            return [("deny", "git push forçado da branch main/master")]
        return [("ask", "git push" + (" --force" if force else ""))]
    if sub == "reset" and "--hard" in rest:
        return [("ask", "git reset --hard")]
    if sub == "clean" and flags & {"-f", "--force"}:
        return [("ask", "git clean -f")]
    if sub == "rebase":
        return [("ask", "git rebase")]
    if sub == "branch" and flags & {"-D"}:
        return [("ask", "git branch -D")]
    if sub == "checkout" and ("--" in rest or "." in rest):
        return [("ask", "git checkout descartando mudanças")]
    return []


# Opções do pkill/pgrep que consomem o argumento seguinte (procps-ng).
PGREP_VALUE_OPTS = {
    "-u",
    "-U",
    "-g",
    "-G",
    "-P",
    "-s",
    "-t",
    "-d",
    "--signal",
    "--euid",
    "--uid",
    "--pgroup",
    "--group",
    "--parent",
    "--session",
    "--terminal",
    "--delimiter",
    "--ns",
    "--nslist",
}
PGREP_KILL_RE = re.compile(r"\bpgrep\s+([^|;&)`]*)")
SELF_KILL_MSG = (
    "{0} -f com padrão que casa com a própria linha de comando do shell (o bash -c que roda isto morre, "
    "exit 143/144); use o colchete, ex. '[c]hrome', ou o PID salvo"
)


def full_match_pattern(args: list[str]) -> str | None:
    """Padrão de pkill/pgrep quando -f/--full está presente; senão None."""
    if not (short_flags(args) & {"-f", "--full"}):
        return None
    rest: list[str] = []
    skip = False
    for a in args:
        if skip:
            skip = False
        elif a in PGREP_VALUE_OPTS:
            skip = True
        elif not a.startswith("-"):
            rest.append(a)
    return rest[-1] if rest else None


def matches_self(pattern: str, cmd: str) -> bool:
    try:
        return re.search(pattern, cmd) is not None
    except (
        re.error,
        OverflowError,
        RecursionError,
    ):  # padrão inválido ou grande demais: texto literal
        return pattern in cmd


HEREDOC_RE = re.compile(
    r"(?<!<)<<[-~]?[ \t]*(['\"]?)(\w+)\1[^\n]*\n(.*?)^[ \t]*\2[ \t]*$",
    re.DOTALL | re.MULTILINE,
)
SHELL_WORD_RE = re.compile(r"(?<![\w.-])(?:ba|z|da|k|fi)?sh\b(?!\.)")


def mask_heredocs(cmd: str) -> str:
    """Mesmo tamanho, corpo de heredoc em branco (quebras de linha mantidas), exceto quando a linha do `<<`
    tem um shell (`bash <<EOF`, `<<EOF | sh`): ali o texto roda."""
    out = list(cmd)
    for m in HEREDOC_RE.finditer(cmd):
        start = cmd.rfind("\n", 0, m.start()) + 1
        end = cmd.find("\n", m.start())
        if not SHELL_WORD_RE.search(cmd[start:end]):
            for i in range(m.start(3), m.end(3)):
                if out[i] != "\n":
                    out[i] = " "
    return "".join(out)


def mask_text(cmd: str) -> str:
    """Mesmo tamanho, com corpo de heredoc e conteúdo entre aspas trocados: texto citado não é comando.
    Heredoc lido por um shell (`bash <<EOF`) fica: ali o texto roda.
    ponytail: aspas após `bash -c` também são mascaradas (falso negativo raro); tratar se aparecer."""
    out = list(mask_heredocs(cmd))
    quote: str | None = None
    for i, c in enumerate(out):
        if quote:
            if c == quote and (quote == "'" or out[i - 1] != "\\"):
                quote = None
            else:
                out[i] = "x"
        elif c in ("'", '"'):
            quote = c
    return "".join(out)


def check_self_kill(cmd: str) -> list[Finding]:
    """pgrep -f cuja saída vai para kill (`| xargs kill`, `kill $(...)`, crases) e casa com o próprio shell.
    O padrão casa com o comando inteiro (o `bash -c` carrega tudo), mas só conta pgrep/kill fora de texto citado."""
    found: list[Finding] = []
    masked = mask_text(cmd)
    for m in PGREP_KILL_RE.finditer(masked):
        before, after = masked[: m.start()], masked[m.end() :]
        to_kill = re.match(r"\s*\|\s*xargs\b[^|;&]*\bkill\b", after) or re.search(
            r"\bkill\b[^;|&]*(\$\(|`)\s*$", before
        )
        if not to_kill:
            continue
        raw = cmd[m.start(1) : m.end(1)]
        try:
            args = shlex.split(raw)
        except ValueError:
            args = raw.split()
        pattern = full_match_pattern(args)
        if pattern and matches_self(pattern, cmd):
            found.append(("deny", SELF_KILL_MSG.format("pgrep")))
    return found


def substitutions(cmd: str) -> list[str]:
    """Corpos de `$(...)` e de crases fora de aspas simples (dentro de aspas duplas também executam)."""
    out: list[str] = []
    i, n, quote = 0, len(cmd), ""
    while i < n:
        c = cmd[i]
        if c == "\\":
            i += 2
            continue
        if quote == "'":
            quote = "" if c == "'" else quote
        elif c == "'" and not quote:  # dentro de "..." o ' é literal
            quote = "'"
        elif c == '"':
            quote = "" if quote else '"'
        elif c == "`":
            j = cmd.find("`", i + 1)
            j = n if j < 0 else j
            out.append(cmd[i + 1 : j])
            i = j
        elif cmd.startswith("$(", i):
            depth, j = 1, i + 2
            while j < n and depth:
                depth += (cmd[j] == "(") - (cmd[j] == ")")
                j += 1
            out.append(cmd[i + 2 : j - 1 if depth == 0 else j])
            i = j - 1
        i += 1
    return out


def check_bash(
    cmd: str, cwd: str = "", depth: int = 0, root: str | None = None
) -> list[Finding]:
    if depth > HARD_DEPTH:
        return [DEEP]
    root = cmd if root is None else root
    cmd = cmd.replace("\\\n", "")  # continuação de linha
    found: list[Finding] = [DEEP] if depth > MAX_DEPTH else []
    body_free = mask_heredocs(cmd)  # corpo de heredoc não-shell é texto, não comando
    if depth == 0:
        if FORK_BOMB_RE.search(body_free):
            found.append(("deny", "fork bomb"))
        found.extend(check_self_kill(cmd))
    for sub in substitutions(body_free):
        found.extend(check_bash(sub, cwd, depth + 1, root))
    prev_names: set[str] = set()
    for argv, piped in segments(tokenize(body_free)):
        if not piped:
            prev_names = set()
        f, name = check_segment(argv, piped, prev_names, root, depth, cwd)
        found.extend(f)
        if name:
            prev_names.add(name)
    return found


# ---------- regras de arquivo ----------


def inside(path: str, root: str) -> bool:
    return bool(root) and (path == root or path.startswith(root.rstrip("/") + "/"))


def check_file(path: str, cwd: str, project: str) -> list[Finding]:
    if not path:
        return []
    p = os.path.abspath(
        os.path.expanduser(
            path
            if os.path.isabs(path) or path.startswith("~")
            else os.path.join(cwd or os.getcwd(), path)
        )
    )
    base = os.path.basename(p)
    if (base == ".env" or base.startswith(".env.")) and not base.endswith(
        ENV_SAFE_SUFFIXES
    ):
        return [("ask", f"arquivo de segredos {base}")]
    if base.endswith((".pem", ".key", ".p12", ".pfx")) or re.match(
        r"^id_(rsa|ed25519|ecdsa|dsa)", base
    ):
        return [("ask", f"chave/certificado {base}")]
    if (
        base == "auth.json"
        or p in SENSITIVE_FILES
        or any(inside(p, d) for d in SENSITIVE_DIRS)
    ):
        return [("ask", f"arquivo sensível {p}")]
    tmp_roots = {"/tmp", tempfile.gettempdir(), "/var/tmp"}
    if any(inside(p, r) for r in tmp_roots):
        return []
    if not (inside(p, project) or inside(p, cwd)):
        return [("ask", f"fora do projeto: {p}")]
    return []


def read_denied(p: str) -> bool:
    return bool(
        p in READ_DENY_FILES
        or any(inside(p, d) for d in READ_DENY_DIRS)
        or CLAUDE_CREDENTIALS_RE.match(p)
        or READ_DENY_ENV_RE.match(os.path.basename(p))
    )


def check_read(path: str, cwd: str) -> list[Finding]:
    if not path:
        return []
    p = os.path.abspath(
        os.path.expanduser(
            path
            if os.path.isabs(path) or path.startswith("~")
            else os.path.join(cwd or os.getcwd(), path)
        )
    )
    if any(
        read_denied(q) for q in (p, os.path.realpath(p))
    ):  # realpath: link para segredo
        return [("deny", f"leitura de segredo bloqueada: {p}")]
    return []


# ---------- main ----------


def bypass_on() -> bool:
    return os.environ.get("NYCODE_BYPASS_PERMISSIONS", "").lower() in (
        "1",
        "true",
        "on",
        "yes",
    )


def decide(payload: dict[str, Any]) -> tuple[str, str] | None:
    tool = payload.get("tool_name", "")
    ti = payload.get("tool_input") or {}
    cwd = payload.get("cwd") or os.getcwd()
    project = os.environ.get("CLAUDE_PROJECT_DIR") or cwd
    if tool == "Bash":
        found = check_bash(ti.get("command") or "", os.path.abspath(cwd))
    elif tool in ("Edit", "Write", "MultiEdit"):
        found = check_file(
            ti.get("file_path") or "", os.path.abspath(cwd), os.path.abspath(project)
        )
    elif tool == "Read":
        found = check_read(ti.get("file_path") or "", os.path.abspath(cwd))
    else:
        return None
    denies = [r for lvl, r in found if lvl == "deny"]
    if denies:
        return "deny", "Bloqueado pelo guard: " + "; ".join(dict.fromkeys(denies))
    asks = [r for lvl, r in found if lvl == "ask"]
    if asks:
        if bypass_on():
            return None
        return "ask", "Confirmação necessária: " + "; ".join(dict.fromkeys(asks))
    return None


def main() -> int:
    tool = ""
    result: tuple[str, str] | None = None
    try:
        payload = json.loads(sys.stdin.read() or "{}")
        if isinstance(payload, dict):
            tool = str(payload.get("tool_name", ""))
            result = decide(payload)
    except Exception as e:  # noqa: BLE001  # nunca travar o trabalho por bug do guard
        print(f"guard.py: erro interno: {e!r}", file=sys.stderr)
        if tool == "Bash" and not bypass_on():
            result = ("ask", "guard: erro interno")
    if result:
        decision, reason = result
        print(
            json.dumps(
                {
                    "hookSpecificOutput": {
                        "hookEventName": "PreToolUse",
                        "permissionDecision": decision,
                        "permissionDecisionReason": reason,
                    }
                }
            )
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
