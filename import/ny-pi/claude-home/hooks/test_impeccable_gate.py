"""Testes do impeccable_gate.sh . Rodar: python3 -m unittest -v test_impeccable_gate (neste diretório)."""

import json
import os
import socket
import subprocess
import tempfile
import unittest

GATE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "impeccable_gate.sh")
FAKE = '#!/bin/sh\nprintf "%s" "$*" > "$0.argv"\ncat > "$0.stdin"\necho ran\n'


def mkexe(path):
    with open(path, "w") as f:
        f.write(FAKE)
    os.chmod(path, 0o755)


class GateTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.tmp = os.path.realpath(self._tmp.name)
        self.launcher = os.path.join(self.tmp, "fake-launcher")
        mkexe(self.launcher)

    def mkdir(self, *parts):
        d = os.path.join(self.tmp, *parts)
        os.makedirs(d, exist_ok=True)
        return d

    def run_gate(self, args, cwd, payload=b"", env_extra=None, sock=True):
        env = dict(os.environ, IMPECCABLE_GATE_LAUNCHER=self.launcher)
        env.update(env_extra or {})
        if sock:  # pi-code hands hooks a Unix socket as stdin
            a, b = socket.socketpair()
            a.sendall(payload)
            a.shutdown(socket.SHUT_WR)
            try:
                return subprocess.run([GATE, *args], stdin=b, capture_output=True, env=env, cwd=cwd, timeout=10)
            finally:
                a.close()
                b.close()
        return subprocess.run([GATE, *args], input=payload, capture_output=True, env=env, cwd=cwd, timeout=10)

    def read(self, path, suffix):
        with open(path + suffix, "rb") as f:
            return f.read().decode()

    def payload(self, cwd):
        return (json.dumps({"hook_event_name": "PostToolUse", "cwd": cwd}) + "\n").encode()

    def test_hook_non_design_dir_is_silent(self):
        d = self.mkdir("plain")
        p = self.run_gate(["hook"], d, self.payload(d))
        self.assertEqual((p.returncode, p.stdout, p.stderr), (0, b"", b""))
        self.assertFalse(os.path.exists(self.launcher + ".argv"))
        self.assertFalse(os.path.exists(os.path.join(d, ".impeccable")))

    def test_hook_opt_in_markers_call_launcher_with_same_stdin(self):
        for name, make in (("dir", lambda d: os.mkdir(os.path.join(d, ".impeccable"))),
                           ("product", lambda d: open(os.path.join(d, "PRODUCT.md"), "w").close()),
                           ("design", lambda d: open(os.path.join(d, "DESIGN.md"), "w").close())):
            d = self.mkdir(name)
            make(d)
            if os.path.exists(self.launcher + ".argv"):
                os.remove(self.launcher + ".argv")
            pl = self.payload(d)
            p = self.run_gate(["hook"], d, pl)
            self.assertEqual((p.returncode, p.stdout), (0, b"ran\n"), name)
            self.assertEqual(self.read(self.launcher, ".argv"), "hook", name)
            self.assertEqual(self.read(self.launcher, ".stdin").encode(), pl, name)

    def test_hook_git_subdir_resolves_to_root(self):
        root = self.mkdir("repo")
        subprocess.run(["git", "init", "-q", root], check=True)
        open(os.path.join(root, "PRODUCT.md"), "w").close()
        sub = self.mkdir("repo", "src", "a")
        pl = self.payload(sub)
        p = self.run_gate(["hook"], sub, pl)
        self.assertEqual(p.stdout, b"ran\n")
        self.assertEqual(self.read(self.launcher, ".stdin").encode(), pl)

    def test_hook_without_cwd_uses_pwd(self):
        d = self.mkdir("nocwd")
        open(os.path.join(d, "DESIGN.md"), "w").close()
        p = self.run_gate(["hook"], d, b"{}\n", sock=False)
        self.assertEqual(p.stdout, b"ran\n")

    def test_missing_launcher_exits_zero(self):
        d = self.mkdir("fb")
        open(os.path.join(d, "PRODUCT.md"), "w").close()
        p = self.run_gate(["hook"], d, self.payload(d), env_extra={"IMPECCABLE_GATE_LAUNCHER": os.path.join(self.tmp, "nope")})
        self.assertEqual((p.returncode, p.stdout, p.stderr), (0, b"", b""))


if __name__ == "__main__":
    unittest.main()
