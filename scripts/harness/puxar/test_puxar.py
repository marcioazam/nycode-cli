"""puxar.py (pi) importa sessões do Claude Code para o formato de sessão v3 do pi.

Run: python3 ~/.pi/agent/claude-home/bin/puxar/test_puxar.py
"""
import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SPEC = importlib.util.spec_from_file_location('puxar', Path(__file__).resolve().parent / 'puxar.py')
assert SPEC and SPEC.loader
puxar = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(puxar)

CWD = '/src/my.app'
ENC = '-src-my-app'
PI_ENC = '--src-my.app--'
SID = '11111111-2222-3333-4444-555555555555'


def rec(kind, uid, parent, content, ts='2026-11-01T10:00:00.000Z', **extra):
    msg = {'role': kind, 'content': content}
    if kind == 'assistant':
        msg.update(model=extra.pop('model', 'claude-opus-5-5'), id=extra.pop('mid', 'msg_' + uid))
    return {'type': kind, 'uuid': uid, 'parentUuid': parent, 'timestamp': ts, 'message': msg, **extra}


def simple_session():
    return [
        rec('user', 'u1', None, 'oi'),
        rec('assistant', 'a1', 'u1', [{'type': 'thinking', 'thinking': 'hm', 'signature': 'sig'}], mid='m1'),
        rec('assistant', 'a2', 'a1', [{'type': 'tool_use', 'id': 'toolu_1', 'name': 'Bash',
                                       'input': {'command': 'ls', 'timeout': 120000, 'description': 'x'}}], mid='m1'),
        rec('user', 'u2', 'a2', [{'type': 'tool_result', 'tool_use_id': 'toolu_1', 'content': 'a.txt'}]),
        rec('assistant', 'a3', 'u2', [{'type': 'text', 'text': 'pronto'}], mid='m2'),
        {'type': 'ai-title', 'aiTitle': 'Listar arquivos'},
    ]


class Base(unittest.TestCase):
    def setUp(self):
        self.home = Path(tempfile.mkdtemp())
        self.pi_dir = self.home / 'pi-sessions'
        env = mock.patch.dict(os.environ, {'HOME': str(self.home), 'PI_CODING_AGENT_SESSION_DIR': str(self.pi_dir)})
        env.start()
        self.addCleanup(env.stop)

    def session(self, profile, sid, mtime, records=None):
        f = self.home / profile / 'projects' / ENC / f'{sid}.jsonl'
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(''.join(json.dumps(r) + '\n' for r in (records or simple_session())))
        os.utime(f, (mtime, mtime))
        return f

    def load(self, path):
        return [json.loads(line) for line in Path(path).read_text().splitlines()]

    def messages(self, path, role=None):
        out = [e['message'] for e in self.load(path) if e['type'] == 'message']
        return [m for m in out if role is None or m['role'] == role]


class PickTest(Base):
    def test_newest_by_mtime_not_by_name(self):
        self.session('.claude-2', 'aaa', 1000)
        self.session('.claude-2', 'zzz', 2000)
        self.session('.claude-2', 'mmm', 3000)
        out, target = puxar.pull('2', CWD)
        self.assertIn('importada: mmm', out)
        self.assertTrue(target.name.endswith('_mmm.jsonl'), target)
        self.assertEqual(target.parent, self.pi_dir / PI_ENC)
        self.assertEqual(target.stat().st_mtime, 3000)  # /resume ordena pela atividade real

    def test_nth_and_out_of_range(self):
        for sid, mt in (('aaa', 1000), ('zzz', 3000), ('mmm', 2000)):
            self.session('.claude-2', sid, mt)
        self.assertIn('importada: mmm', puxar.pull('2 2', CWD)[0])
        self.assertIn('importada: aaa', puxar.pull(' 2  3 ', CWD)[0])
        with self.assertRaisesRegex(ValueError, 'só há 3 sessão'):
            puxar.pull('2 4', CWD)

    def test_by_session_id(self):
        self.session('.claude', SID, 1000)
        self.session('.claude', 'bbb', 5000)
        self.assertIn(f'importada: {SID}', puxar.pull(f'1 {SID}', CWD)[0])
        with self.assertRaisesRegex(ValueError, 'não existe'):
            puxar.pull('1 99999999-2222-3333-4444-555555555555', CWD)

    def test_profiles(self):
        self.assertEqual(puxar.profile_dir('1'), self.home / '.claude')
        self.assertEqual(puxar.profile_dir('claude'), self.home / '.claude')
        self.assertEqual(puxar.profile_dir('glm'), self.home / '.claude-glm')
        self.assertEqual(puxar.profile_dir('claude-3'), self.home / '.claude-3')
        self.assertEqual(puxar.profile_dir('/x/y'), Path('/x/y'))

    def test_usage_errors(self):
        for bad in ('', '1 2 3', '1 0', '1 x'):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                (self.home / '.claude').mkdir(exist_ok=True)
                puxar.pull(bad, CWD)
        with self.assertRaisesRegex(ValueError, 'não existe'):
            puxar.pull('nope', CWD)
        (self.home / '.claude-5').mkdir()
        with self.assertRaisesRegex(ValueError, 'nenhuma sessão'):
            puxar.pull('5', CWD)

    def test_explicit_session_dir_wins(self):
        self.session('.claude', SID, 1000)
        dest = self.home / 'outra' / '--src-my.app--'
        _, target = puxar.pull('1', CWD, str(dest))
        self.assertEqual(target.parent, dest)
        self.assertFalse((self.pi_dir / PI_ENC).exists())

    def test_main_prints_file_and_exit_codes(self):
        self.session('.claude', SID, 1000)
        with mock.patch('builtins.print') as p:
            self.assertEqual(puxar.main(['1', CWD]), 0)
        self.assertTrue(str(p.call_args_list[-1].args[0]).startswith('PI_SESSION_FILE='))
        with mock.patch('builtins.print'):
            self.assertEqual(puxar.main(['', CWD]), 1)


class ConvertTest(Base):
    def test_header_tree_and_messages(self):
        self.session('.claude', SID, 1000)
        _, target = puxar.pull('1', CWD)
        entries = self.load(target)
        self.assertEqual(entries[0], {'type': 'session', 'version': 3, 'id': SID,
                                      'timestamp': '2026-11-01T10:00:00.000Z', 'cwd': CWD})
        ids = [e['id'] for e in entries[1:]]
        self.assertEqual(len(ids), len(set(ids)))
        for prev, cur in zip(entries[1:], entries[2:]):
            self.assertEqual(cur['parentId'], prev['id'])  # um ramo linear
        self.assertIsNone(entries[1]['parentId'])
        self.assertEqual(entries[1]['customType'], 'claude-import')
        self.assertEqual(entries[1]['data']['lines'], len(entries))
        self.assertEqual(entries[-1], {**entries[-1], 'type': 'session_info', 'name': '[claude] Listar arquivos'})
        roles = [m['role'] for m in self.messages(target)]
        self.assertEqual(roles, ['user', 'assistant', 'toolResult', 'assistant'])

    def test_assistant_pieces_merge_and_tool_mapping(self):
        self.session('.claude', SID, 1000)
        _, target = puxar.pull('1', CWD)
        first = self.messages(target, 'assistant')[0]
        self.assertEqual(first['api'], 'claude-code-import')
        self.assertEqual(first['stopReason'], 'toolUse')
        self.assertEqual(first['content'][0], {'type': 'thinking', 'thinking': 'hm', 'thinkingSignature': 'sig'})
        self.assertEqual(first['content'][1], {'type': 'toolCall', 'id': 'toolu_1', 'name': 'bash',
                                               'arguments': {'command': 'ls', 'timeout': 120}})
        result = self.messages(target, 'toolResult')[0]
        self.assertEqual((result['toolCallId'], result['toolName'], result['isError']), ('toolu_1', 'bash', False))
        self.assertEqual(result['content'], [{'type': 'text', 'text': 'a.txt'}])
        self.assertEqual(self.messages(target, 'assistant')[1]['stopReason'], 'stop')

    def test_map_tool(self):
        self.assertEqual(puxar.map_tool('Read', {'file_path': '/a', 'offset': 3}), ('read', {'path': '/a', 'offset': 3}))
        self.assertEqual(puxar.map_tool('Write', {'file_path': '/a', 'content': 'x'}), ('write', {'path': '/a', 'content': 'x'}))
        self.assertEqual(puxar.map_tool('Edit', {'file_path': '/a', 'old_string': 'o', 'new_string': 'n'}),
                         ('edit', {'path': '/a', 'edits': [{'oldText': 'o', 'newText': 'n'}]}))
        self.assertEqual(puxar.map_tool('MultiEdit', {'file_path': '/a', 'edits': [{'old_string': 'o', 'new_string': 'n'}]}),
                         ('edit', {'path': '/a', 'edits': [{'oldText': 'o', 'newText': 'n'}]}))
        self.assertEqual(puxar.map_tool('mcp__x__y', {'q': 1}), ('mcp__x__y', {'q': 1}))

    def test_skips_noise_and_keeps_meta_hidden(self):
        records = [
            rec('user', 'u1', None, 'oi'),
            rec('user', 'm1', 'u1', '<local-command-caveat>ignore</local-command-caveat>', isMeta=True),
            rec('user', 'm2', 'm1', [{'type': 'text', 'text': 'corpo da skill'}], isMeta=True),
            {'type': 'attachment', 'uuid': 'at', 'parentUuid': 'm2'},
            rec('assistant', 'side', 'at', [{'type': 'text', 'text': 'sidechain'}], isSidechain=True),
            rec('assistant', 'err', 'at', [{'type': 'text', 'text': 'API Error'}], model='<synthetic>', isApiErrorMessage=True),
            rec('user', 'u2', 'err', [{'type': 'tool_result', 'tool_use_id': 'toolu_orfao', 'content': 'x'},
                                      {'type': 'text', 'text': 'segue'},
                                      {'type': 'image', 'source': {'type': 'base64', 'media_type': 'image/jpeg', 'data': 'AAAA'}}]),
            rec('assistant', 'a1', 'u2', [{'type': 'text', 'text': 'ok'}]),
        ]
        self.session('.claude', SID, 1000, records)
        out, target = puxar.pull('1', CWD)
        entries = self.load(target)
        hidden = [e for e in entries if e['type'] == 'custom_message']
        self.assertEqual(len(hidden), 1)
        self.assertEqual((hidden[0]['display'], hidden[0]['content']), (False, [{'type': 'text', 'text': 'corpo da skill'}]))
        msgs = self.messages(target)
        self.assertEqual([m['role'] for m in msgs], ['user', 'user', 'assistant'])  # órfão, sidechain e erro fora
        self.assertEqual(msgs[1]['content'][1], {'type': 'image', 'data': 'AAAA', 'mimeType': 'image/jpeg'})
        self.assertNotIn('sidechain', json.dumps(entries))
        self.assertIn('1 ocultas', out)

    def test_compaction_with_unrecorded_logical_parent(self):
        records = [
            rec('user', 'u1', None, 'antes'),
            rec('assistant', 'a1', 'u1', [{'type': 'text', 'text': 'resposta antiga'}]),
            {'type': 'system', 'subtype': 'compact_boundary', 'uuid': 'cb', 'parentUuid': None,
             'logicalParentUuid': 'nao-gravado', 'timestamp': '2026-11-01T11:00:00.000Z',
             'compactMetadata': {'preTokens': 500000}},
            rec('user', 'sum', 'cb', 'This session is being continued... RESUMO', isCompactSummary=True),
            rec('user', 'u2', 'sum', 'depois'),
            rec('assistant', 'a2', 'u2', [{'type': 'text', 'text': 'nova'}]),
        ]
        self.session('.claude', SID, 1000, records)
        out, target = puxar.pull('1', CWD)
        entries = self.load(target)
        comp = [e for e in entries if e['type'] == 'compaction']
        self.assertEqual(len(comp), 1)
        self.assertEqual(comp[0]['firstKeptEntryId'], comp[0]['id'])  # retain-none
        self.assertEqual(comp[0]['tokensBefore'], 500000)
        self.assertIn('RESUMO', comp[0]['summary'])
        texts = json.dumps([e for e in entries if e['type'] == 'message'])
        self.assertIn('resposta antiga', texts)  # o histórico anterior continua navegável no /tree
        self.assertNotIn('This session is being continued', texts)  # o resumo não vira mensagem de usuário
        self.assertIn('1 compactações', out)

    def test_empty_session_is_an_error(self):
        self.session('.claude', SID, 1000, [{'type': 'ai-title', 'aiTitle': 'x'}])
        with self.assertRaisesRegex(ValueError, 'não tem mensagens'):
            puxar.pull('1', CWD)


class RefreshTest(Base):
    def test_same_source_is_up_to_date_and_newer_source_replaces(self):
        src = self.session('.claude', SID, 1000)
        _, first = puxar.pull('1', CWD)
        out, again = puxar.pull('1', CWD)
        self.assertTrue(out.startswith('já atualizada'), out)
        self.assertEqual(again, first)
        recs = simple_session() + [rec('user', 'u3', 'a3', 'mais uma')]
        src.write_text(''.join(json.dumps(r) + '\n' for r in recs))
        os.utime(src, (2000, 2000))
        out, second = puxar.pull('1', CWD)
        self.assertTrue(out.startswith('importada'), out)
        self.assertEqual(list((self.pi_dir / PI_ENC).glob('*.jsonl')), [second])
        self.assertIn('mais uma', second.read_text())

    def test_copy_continued_in_pi_is_never_overwritten(self):
        src = self.session('.claude', SID, 1000)
        _, first = puxar.pull('1', CWD)
        with first.open('a') as fh:  # o usuário continuou a sessão no pi
            fh.write(json.dumps({'type': 'message', 'id': 'zz', 'parentId': None, 'timestamp': 'x',
                                 'message': {'role': 'user', 'content': 'trabalho no pi', 'timestamp': 1}}) + '\n')
        before = first.read_text()
        os.utime(src, (2000, 2000))
        out, other = puxar.pull('1', CWD)
        self.assertIn('ficou intacta', out)
        self.assertNotEqual(other, first)
        self.assertEqual(first.read_text(), before)
        out2, other2 = puxar.pull('1', CWD)  # repetir não duplica
        self.assertTrue(out2.startswith('já atualizada'), out2)
        self.assertEqual(other2, other)
        self.assertEqual(len(list((self.pi_dir / PI_ENC).glob('*.jsonl'))), 2)


if __name__ == '__main__':
    unittest.main()
