#!/usr/bin/env python3
"""/puxar no pi: importa a sessão mais recente (ou a N-ésima, ou uma por id) deste diretório de um perfil do
Claude Code para o pi, convertida para o formato de sessão v3 do pi, pronta para /resume.

  puxar.py '<perfil> [N|session-id]' [cwd] [dir]   imprime o resultado; a última linha é PI_SESSION_FILE=<arquivo>
                                             dir: pasta de sessões do pi para o cwd (a extensão passa a da
                                             sessão aberta, que respeita --session-dir e sessionDir)
                                             exit 1 em erro (mensagem no stderr)

Porte do ~/.claude/bin/puxar.py (que copia entre perfis do Claude). No pi não há perfis: o destino é o
diretório de sessões do pi (PI_CODING_AGENT_SESSION_DIR, ou ~/.pi/agent/sessions), e o arquivo precisa
ser convertido, porque o pi não lê o JSONL do Claude Code. Quem chama é a extensão
~/.pi/agent/extensions/puxar.ts, que depois abre a sessão importada. Testes: bin/puxar/test_puxar.py.

<perfil>: 1|claude = ~/.claude, N = ~/.claude-N, nome = ~/.claude-nome, ou caminho absoluto.
[N]: 1 = mais recente por mtime (padrão), 2 = penúltima...; ou o id (uuid) de uma sessão do perfil.

Conversão (ramo ativo, do último registro até a raiz, atravessando compactações):
- user texto/imagem -> user; tool_result -> toolResult (com o nome da ferramenta da chamada);
- assistant (linhas com o mesmo message.id viram uma mensagem) -> assistant com text/thinking/toolCall;
  Bash/Read/Write/Edit/MultiEdit viram bash/read/write/edit com os argumentos do pi, o resto mantém o nome;
- mensagens isMeta (corpo de skill, lembretes) -> custom_message oculta, que entra no contexto;
- compact_boundary + resumo -> entrada `compaction` do pi (o contexto continua só com o resumo + o depois);
- erros sintéticos de API, sidechains, anexos e metadados do Claude ficam de fora.
As mensagens do assistente levam api "claude-code-import": o pi descarta o thinking assinado de outro
"modelo" ao reenviar (assinaturas do Claude Code não são reaproveitadas) e mantém texto e chamadas.

Reimportar a mesma sessão substitui a cópia anterior, exceto se ela já foi continuada no pi: aí a nova
importação ganha outro id e a cópia continuada fica intacta.
"""
import json
import os
import re
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

USAGE = ('uso: /puxar <perfil> [N|session-id]  (perfil: 1=~/.claude, 2=~/.claude-2, glm=~/.claude-glm ou caminho; '
         'N: 1=mais recente (padrão), 2=penúltima...)')
IMPORT_TYPE = 'claude-import'
API = 'claude-code-import'
UUID_RE = re.compile(r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')


def profile_dir(name: str) -> Path:
    if name.startswith('/'):
        return Path(name)
    if name.startswith('~'):
        return Path(name).expanduser()
    if name in ('1', 'claude', '.claude'):
        return Path.home() / '.claude'
    return Path.home() / ('.claude-' + name.removeprefix('.').removeprefix('claude-'))


def claude_project_key(cwd: str) -> str:
    # Claude Code: o caminho com todo caractere não alfanumérico trocado por '-'.
    return re.sub(r'[^a-zA-Z0-9]', '-', cwd)


def pi_sessions_dir(cwd: str) -> Path:
    # pi: tira a barra inicial e troca / \ : por '-', entre '--' (docs/session-format.md).
    base = Path(os.environ.get('PI_CODING_AGENT_SESSION_DIR') or Path.home() / '.pi' / 'agent' / 'sessions')
    return base / ('--' + re.sub(r'[/\\:]', '-', cwd.lstrip('/\\')) + '--')


def iso_ms(value) -> int:
    try:
        return int(datetime.fromisoformat(str(value).replace('Z', '+00:00')).timestamp() * 1000)
    except (TypeError, ValueError):
        return int(time.time() * 1000)


def iso(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.') + f'{ms % 1000:03d}Z'


# ---------------------------------------------------------------- leitura do Claude

def read_claude(path: Path) -> list[dict]:
    records = []
    with path.open(encoding='utf-8', errors='replace') as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except ValueError:
                continue
            if isinstance(rec, dict):
                records.append(rec)
    return records


def is_message(rec: dict) -> bool:
    if rec.get('type') not in ('user', 'assistant') or rec.get('isSidechain'):
        return False
    msg = rec.get('message')
    if not isinstance(msg, dict):
        return False
    if rec['type'] == 'assistant' and (rec.get('isApiErrorMessage') or msg.get('model') == '<synthetic>'):
        return False
    return True


def active_branch(records: list[dict]) -> list[dict]:
    """O ramo ativo: do último registro de mensagem até a raiz. Uma fronteira de compactação tem
    parentUuid null e aponta o histórico anterior em logicalParentUuid; seguimos por ela."""
    by_uuid = {r['uuid']: r for r in records if isinstance(r.get('uuid'), str)}
    # O logicalParentUuid costuma apontar um registro que não foi gravado; aí o histórico anterior continua
    # na última mensagem gravada antes da fronteira.
    before_boundary, last_msg = {}, None
    for r in records:
        if r.get('subtype') == 'compact_boundary' and isinstance(r.get('uuid'), str):
            before_boundary[r['uuid']] = last_msg
        elif is_message(r):
            last_msg = r
    leaf = next((r for r in reversed(records) if is_message(r)), None)
    chain, seen, cur = [], set(), leaf
    while cur is not None and cur['uuid'] not in seen:
        seen.add(cur['uuid'])
        chain.append(cur)
        if cur.get('parentUuid'):
            cur = by_uuid.get(cur['parentUuid'])
        elif cur.get('subtype') == 'compact_boundary':
            cur = by_uuid.get(cur.get('logicalParentUuid') or '') or before_boundary.get(cur['uuid'])
        else:
            cur = None
    chain.reverse()
    return [r for r in chain if is_message(r) or (r.get('type') == 'system' and r.get('subtype') == 'compact_boundary')]


# ---------------------------------------------------------------- conversão de blocos

def image_block(block: dict):
    src = block.get('source') or {}
    if src.get('type') == 'base64' and src.get('data'):
        return {'type': 'image', 'data': src['data'], 'mimeType': src.get('media_type', 'image/png')}
    return {'type': 'text', 'text': '[imagem não importada]'}


def user_blocks(content) -> list[dict]:
    if isinstance(content, str):
        return [{'type': 'text', 'text': content}] if content else []
    out = []
    for b in content or []:
        if not isinstance(b, dict):
            continue
        if b.get('type') == 'text' and b.get('text'):
            out.append({'type': 'text', 'text': b['text']})
        elif b.get('type') == 'image':
            out.append(image_block(b))
    return out


def result_blocks(content) -> list[dict]:
    if isinstance(content, str):
        return [{'type': 'text', 'text': content}]
    out = []
    for b in content or []:
        if not isinstance(b, dict):
            continue
        kind = b.get('type')
        if kind == 'text':
            out.append({'type': 'text', 'text': b.get('text', '')})
        elif kind == 'image':
            out.append(image_block(b))
        elif kind == 'tool_reference':
            out.append({'type': 'text', 'text': f"[tool_reference: {b.get('tool_name') or b.get('name', '?')}]"})
        else:
            out.append({'type': 'text', 'text': json.dumps(b, ensure_ascii=False)})
    return out or [{'type': 'text', 'text': ''}]


def map_tool(name: str, args: dict) -> tuple[str, dict]:
    """As ferramentas de arquivo e shell do Claude no vocabulário do pi; as demais passam sem mudança."""
    a = args if isinstance(args, dict) else {}
    if name == 'Bash':
        out = {'command': a.get('command', '')}
        if isinstance(a.get('timeout'), (int, float)):
            out['timeout'] = max(1, round(a['timeout'] / 1000))  # Claude: ms; pi: s
        return 'bash', out
    if name == 'Read':
        out = {'path': a.get('file_path', '')}
        out.update({k: a[k] for k in ('offset', 'limit') if k in a})
        return 'read', out
    if name == 'Write':
        return 'write', {'path': a.get('file_path', ''), 'content': a.get('content', '')}
    if name == 'Edit':
        return 'edit', {'path': a.get('file_path', ''),
                        'edits': [{'oldText': a.get('old_string', ''), 'newText': a.get('new_string', '')}]}
    if name == 'MultiEdit':
        return 'edit', {'path': a.get('file_path', ''),
                        'edits': [{'oldText': e.get('old_string', ''), 'newText': e.get('new_string', '')}
                                  for e in a.get('edits') or [] if isinstance(e, dict)]}
    return name, a


def text_of(content) -> str:
    return '\n'.join(b['text'] for b in user_blocks(content) if b['type'] == 'text')


# ---------------------------------------------------------------- montagem da sessão do pi

class Builder:
    def __init__(self):
        self.entries: list[dict] = []
        self.ids: set[str] = set()
        self.parent: str | None = None

    def new_id(self) -> str:
        while True:
            i = uuid.uuid4().hex[:8]
            if i not in self.ids:
                self.ids.add(i)
                return i

    def add(self, entry: dict, ms: int) -> str:
        eid = self.new_id()
        self.entries.append({'type': entry.pop('type'), 'id': eid, 'parentId': self.parent, 'timestamp': iso(ms), **entry})
        self.parent = eid
        return eid


def convert(records: list[dict], source: Path, cwd: str, sid: str) -> tuple[list[dict], dict]:
    chain = active_branch(records)
    if not chain:
        raise ValueError(f'{source} não tem mensagens para importar')
    b = Builder()
    first_ms = iso_ms(chain[0].get('timestamp'))
    stats = {'user': 0, 'assistant': 0, 'toolResult': 0, 'meta': 0, 'compactions': 0}
    b.add({'type': 'custom', 'customType': IMPORT_TYPE,
           'data': {'source': str(source), 'sourceSessionId': sid, 'sourceMtime': source.stat().st_mtime,
                    'importedAt': iso(int(time.time() * 1000))}}, first_ms)

    tool_names: dict[str, str] = {}      # id da chamada -> nome no pi
    answered: set[str] = set()
    pending: dict | None = None          # mensagem do assistente sendo montada (mesmo message.id)
    pending_ms = 0

    def flush():
        nonlocal pending
        if pending and pending['content']:
            pending['stopReason'] = 'toolUse' if any(c['type'] == 'toolCall' for c in pending['content']) else 'stop'
            b.add({'type': 'message', 'message': pending}, pending_ms)
            stats['assistant'] += 1
        pending = None

    def compaction(summary: str, tokens_before: int, ms: int):
        # Retain-none: firstKeptEntryId aponta a própria entrada, e o contexto segue só com o resumo + o depois,
        # que é o que o Claude enviava após compactar.
        flush()
        eid = b.new_id()
        b.entries.append({'type': 'compaction', 'id': eid, 'parentId': b.parent, 'timestamp': iso(ms),
                          'summary': summary, 'firstKeptEntryId': eid, 'tokensBefore': tokens_before})
        b.parent = eid
        stats['compactions'] += 1

    skip_next_summary = False
    for i, rec in enumerate(chain):
        ms = iso_ms(rec.get('timestamp'))
        if rec.get('type') == 'system':  # compact_boundary: o resumo vem no registro seguinte
            nxt = chain[i + 1] if i + 1 < len(chain) else None
            has_summary = bool(nxt and nxt.get('type') == 'user' and nxt.get('isCompactSummary'))
            summary = text_of(nxt['message'].get('content')) if has_summary else ''
            tokens = int((rec.get('compactMetadata') or {}).get('preTokens') or 0)
            compaction(summary or 'Conversation compacted', tokens, ms)
            skip_next_summary = has_summary
            continue
        msg = rec['message']
        if rec['type'] == 'user' and rec.get('isCompactSummary'):
            if skip_next_summary:  # já virou o resumo da compactação acima
                skip_next_summary = False
                continue
            compaction(text_of(msg.get('content')) or 'Conversation compacted', 0, ms)  # resumo sem fronteira
            continue
        if rec['type'] == 'assistant':
            mid = msg.get('id')
            if pending is None or pending.get('responseId') != mid:
                flush()
                usage = msg.get('usage') or {}
                u = {'input': int(usage.get('input_tokens') or 0), 'output': int(usage.get('output_tokens') or 0),
                     'cacheRead': int(usage.get('cache_read_input_tokens') or 0),
                     'cacheWrite': int(usage.get('cache_creation_input_tokens') or 0)}
                u['totalTokens'] = sum(u.values())
                u['cost'] = {'input': 0, 'output': 0, 'cacheRead': 0, 'cacheWrite': 0, 'total': 0}
                pending = {'role': 'assistant', 'content': [], 'api': API, 'provider': 'anthropic',
                           'model': msg.get('model') or 'claude', 'usage': u, 'stopReason': 'stop', 'timestamp': ms}
                if mid:
                    pending['responseId'] = mid
                pending_ms = ms
            for blk in msg.get('content') or []:
                if not isinstance(blk, dict):
                    continue
                kind = blk.get('type')
                if kind == 'text' and blk.get('text'):
                    pending['content'].append({'type': 'text', 'text': blk['text']})
                elif kind == 'thinking' and (blk.get('thinking') or blk.get('signature')):
                    th = {'type': 'thinking', 'thinking': blk.get('thinking', '')}
                    if blk.get('signature'):
                        th['thinkingSignature'] = blk['signature']
                    pending['content'].append(th)
                elif kind == 'tool_use' and blk.get('id'):
                    name, args = map_tool(blk.get('name', ''), blk.get('input'))
                    tool_names[blk['id']] = name
                    pending['content'].append({'type': 'toolCall', 'id': blk['id'], 'name': name, 'arguments': args})
                elif kind not in ('thinking', 'redacted_thinking', 'text', 'tool_use'):
                    pending['content'].append({'type': 'text', 'text': f'[{kind}] ' + json.dumps(blk, ensure_ascii=False)[:2000]})
            continue
        # user
        flush()
        content = msg.get('content')
        if isinstance(content, list):
            for blk in content:
                if isinstance(blk, dict) and blk.get('type') == 'tool_result':
                    call = blk.get('tool_use_id')
                    if call not in tool_names or call in answered:
                        continue  # resultado sem chamada no ramo importado: a API recusaria
                    answered.add(call)
                    b.add({'type': 'message', 'message': {
                        'role': 'toolResult', 'toolCallId': call, 'toolName': tool_names[call],
                        'content': result_blocks(blk.get('content')), 'isError': bool(blk.get('is_error')),
                        'timestamp': ms}}, ms)
                    stats['toolResult'] += 1
        blocks = user_blocks(content)
        if not blocks:
            continue
        if rec.get('isMeta'):
            if text_of(content).lstrip().startswith('<local-command-caveat>'):
                continue
            b.add({'type': 'custom_message', 'customType': IMPORT_TYPE, 'content': blocks, 'display': False}, ms)
            stats['meta'] += 1
        else:
            b.add({'type': 'message', 'message': {'role': 'user', 'content': blocks, 'timestamp': ms}}, ms)
            stats['user'] += 1
    flush()
    title = next((r.get('aiTitle') or r.get('customTitle') for r in reversed(records)
                  if r.get('type') in ('custom-title', 'ai-title') and (r.get('aiTitle') or r.get('customTitle'))), None)
    if title:
        b.add({'type': 'session_info', 'name': f'[claude] {title}'}, iso_ms(chain[-1].get('timestamp')))
    if not (stats['user'] or stats['assistant']):
        raise ValueError(f'{source} não tem mensagens para importar')
    return b.entries, stats


# ---------------------------------------------------------------- gravação

def existing_copy(dest_dir: Path, sid: str) -> Path | None:
    found = sorted(dest_dir.glob(f'*_{sid}.jsonl'))
    return found[-1] if found else None


def import_record(path: Path) -> tuple[dict | None, int]:
    """Os dados de importação gravados na cópia do pi e o número de linhas que ela tem."""
    data, lines = None, 0
    with path.open(encoding='utf-8', errors='replace') as fh:
        for line in fh:
            if not line.strip():
                continue
            lines += 1
            if data is None and IMPORT_TYPE in line:
                try:
                    rec = json.loads(line)
                except ValueError:
                    continue
                if rec.get('type') == 'custom' and rec.get('customType') == IMPORT_TYPE:
                    data = rec.get('data') or {}
    return data, lines


def write_session(dest_dir: Path, pi_id: str, cwd: str, entries: list[dict], start_ms: int, mtime: float) -> Path:
    dest_dir.mkdir(parents=True, exist_ok=True)
    stamp = iso(start_ms).replace(':', '-').replace('.', '-')
    target = dest_dir / f'{stamp}_{pi_id}.jsonl'
    header = {'type': 'session', 'version': 3, 'id': pi_id, 'timestamp': iso(start_ms), 'cwd': cwd}
    entries[0]['data']['lines'] = len(entries) + 1
    tmp = dest_dir / f'.{target.name}.tmp'
    with tmp.open('w', encoding='utf-8') as fh:
        for rec in [header, *entries]:
            fh.write(json.dumps(rec, ensure_ascii=False) + '\n')
    os.utime(tmp, (mtime, mtime))  # /resume ordena pela atividade real, não pela hora da importação
    os.replace(tmp, target)
    return target


def pick_source(src: Path, cwd: str, which: str) -> Path:
    project = src / 'projects' / claude_project_key(cwd)
    if UUID_RE.match(which):
        found = project / f'{which}.jsonl'
        if not found.is_file():
            raise ValueError(f'sessão {which} de {cwd} não existe em {src}')
        return found
    if not which.isdecimal() or int(which) < 1:
        raise ValueError(USAGE)
    sessions = sorted(project.glob('*.jsonl'), key=lambda s: s.stat().st_mtime, reverse=True)
    if not sessions:
        raise ValueError(f'nenhuma sessão de {cwd} em {src}')
    if int(which) > len(sessions):
        raise ValueError(f'só há {len(sessions)} sessão(ões) de {cwd} em {src}')
    return sessions[int(which) - 1]


def pull(args: str, cwd: str, dest: str | None = None) -> tuple[str, Path]:
    parts = args.split()
    if not parts or len(parts) > 2:
        raise ValueError(USAGE)
    src = profile_dir(parts[0])
    if not src.is_dir():
        raise ValueError(f'perfil {src} não existe')
    source = pick_source(src, cwd, parts[1] if len(parts) > 1 else '1')
    sid, mtime = source.stem, source.stat().st_mtime
    dest_dir = Path(dest) if dest else pi_sessions_dir(cwd)
    when = time.strftime('%d/%m %H:%M', time.localtime(mtime))

    pi_id, note = sid, ''
    prev = existing_copy(dest_dir, sid) if dest_dir.is_dir() else None
    if prev:
        data, lines = import_record(prev)
        if data is None or lines > int(data.get('lines') or 0):
            # Continuada no pi (ou não é uma importação): nunca sobrescrever trabalho feito no pi. A nova cópia
            # ganha um id derivado do estado da fonte, então repetir o /puxar não cria duplicatas.
            pi_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f'claude-session:{sid}@{mtime}'))
            note = f' (a cópia {prev.name} já foi continuada no pi e ficou intacta; esta é outra)'
            again = existing_copy(dest_dir, pi_id)
            if again:
                return f'já atualizada: {sid} (última atividade {when}) de {src}{note}', again
        elif float(data.get('sourceMtime') or 0) >= mtime:
            return f'já atualizada: {sid} (última atividade {when}) de {src}', prev

    entries, stats = convert(read_claude(source), source, cwd, sid)
    start_ms = iso_ms(entries[0]['timestamp'])
    target = write_session(dest_dir, pi_id, cwd, entries, start_ms, mtime)
    if prev and pi_id == sid and prev != target:
        prev.unlink()  # cópia antiga e não continuada da mesma sessão: substituída pela nova
    size = source.stat().st_size / 2**20
    msg = (f'importada: {sid} ({size:.1f} MB, última atividade {when}) de {src}{note}\n'
           f"{stats['user']} msgs do usuário, {stats['assistant']} do assistente, {stats['toolResult']} resultados de "
           f"ferramenta, {stats['meta']} ocultas, {stats['compactions']} compactações")
    return msg, target


def main(argv: list[str]) -> int:
    try:
        msg, target = pull(argv[0] if argv else '', argv[1] if len(argv) > 1 and argv[1] else os.getcwd(),
                           argv[2] if len(argv) > 2 and argv[2] else None)
    except (ValueError, OSError) as err:
        print(err, file=sys.stderr)
        return 1
    print(msg)
    print(f'PI_SESSION_FILE={target}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
