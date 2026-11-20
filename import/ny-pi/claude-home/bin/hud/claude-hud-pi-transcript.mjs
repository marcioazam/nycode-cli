// Traduz a sessão JSONL do pi (v3) para o transcript no formato do Claude Code que o claude-hud lê, para as linhas de
// atividade do HUD (tools, todos, skills, MCP) funcionarem no pi. Usado por claude-hud-statusline.mjs.
// Incremental: guarda o deslocamento lido e o estado (todos, nomes de chamadas) em <saída>.state.json e só converte as
// linhas novas; se a sessão encolher ou trocar, refaz do zero. Testes: bin/hud/tests/claude-hud-pi-transcript.test.mjs.
import fs from 'node:fs';
import path from 'node:path';

const SKILL_FILE = /\/skills\/([^/]+)\/SKILL\.md$/;

/** true se o arquivo parece uma sessão do pi (primeira linha `{"type":"session",...}` com versão). */
export function isPiSession(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(512);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const first = buf.subarray(0, n).toString('utf8').split('\n')[0];
    const head = JSON.parse(first);
    return head?.type === 'session' && typeof head.version === 'number';
  } catch {
    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/** Uma chamada de ferramenta do pi como bloco(s) tool_use do Claude. */
export function toolUseBlocks(call, state) {
  const a = call.arguments ?? {};
  const block = (name, input, id = call.id) => ({ type: 'tool_use', id, name, input });
  switch (call.name) {
    case 'bash':
      return [block('Bash', { command: a.command })];
    case 'read': {
      const skill = SKILL_FILE.exec(String(a.path ?? ''))?.[1];
      // No pi uma skill carrega por `read` do SKILL.md: o HUD a mostra como Skill.
      return skill ? [block('Skill', { skill })] : [block('Read', { file_path: a.path })];
    }
    case 'write':
      return [block('Write', { file_path: a.path })];
    case 'edit':
      return [block('Edit', { file_path: a.path })];
    case 'grep':
      return [block('Grep', { pattern: a.pattern })];
    case 'find':
      return [block('Glob', { pattern: a.pattern })];
    case 'subagent':
      return []; // the fleet panel is the only agents surface; no Agent block reaches the HUD
    case 'todo':
      state.pendingTodo[call.id] = a;
      return [];
    default:
      return [block(call.name, a)];
  }
}

/** Aplica o resultado de uma chamada `todo` à lista e devolve o TodoWrite equivalente (ou null). */
export function applyTodo(args, resultText, state) {
  const todos = state.todos;
  const byId = (id) => todos.find((t) => t.id === Number(id));
  switch (args.action) {
    case 'add': {
      const id = Number(/#(\d+)/.exec(resultText ?? '')?.[1] ?? todos.reduce((m, t) => Math.max(m, t.id), 0) + 1);
      todos.push({ id, content: args.text ?? '', status: 'pending' });
      break;
    }
    case 'start':
      for (const t of todos) if (t.status === 'in_progress') t.status = 'pending';
      if (byId(args.id)) byId(args.id).status = 'in_progress';
      break;
    case 'complete':
      if (byId(args.id)) byId(args.id).status = 'completed';
      break;
    case 'delete':
      state.todos = todos.filter((t) => t.id !== Number(args.id));
      break;
    case 'clear':
      state.todos = [];
      break;
    default:
      return null; // list: não muda nada
  }
  return { type: 'tool_use', id: `todo-${state.todoSeq++}`, name: 'TodoWrite', input: { todos: state.todos.map(({ content, status }) => ({ content, status })) } };
}

const textOf = (content) =>
  typeof content === 'string' ? content : Array.isArray(content) ? content.filter((c) => c?.type === 'text').map((c) => c.text).join('\n') : '';

/** Uma entrada da sessão do pi como zero ou mais linhas do transcript do Claude. */
export function convertEntry(entry, state) {
  if (entry?.type !== 'message' || !entry.message) return [];
  const m = entry.message;
  const timestamp = entry.timestamp;
  if (m.role === 'user') {
    const text = textOf(m.content);
    return text ? [{ type: 'user', timestamp, message: { role: 'user', content: text } }] : [];
  }
  if (m.role === 'assistant') {
    const blocks = [];
    for (const c of m.content ?? []) if (c?.type === 'toolCall') blocks.push(...toolUseBlocks(c, state));
    const u = m.usage ?? {};
    return [{
      type: 'assistant',
      timestamp,
      message: {
        id: m.responseId ?? entry.id,
        model: m.model,
        content: blocks,
        usage: { input_tokens: u.input ?? 0, output_tokens: u.output ?? 0, cache_read_input_tokens: u.cacheRead ?? 0, cache_creation_input_tokens: u.cacheWrite ?? 0 },
      },
    }];
  }
  if (m.role === 'toolResult') {
    const todo = state.pendingTodo[m.toolCallId];
    if (todo) {
      delete state.pendingTodo[m.toolCallId];
      if (m.isError) return [];
      const write = applyTodo(todo, textOf(m.content), state);
      return write ? [{ type: 'assistant', timestamp, message: { id: write.id, content: [write] } }] : [];
    }
    return [{
      type: 'user',
      timestamp,
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: m.toolCallId, is_error: m.isError === true }] },
    }];
  }
  return [];
}

const freshState = (source) => ({ source, offset: 0, todos: [], todoSeq: 0, pendingTodo: {} });

/** Atualiza `out` com as linhas novas de `source` e devolve `out`. */
export function syncTranscript(source, out) {
  const statePath = `${out}.state.json`;
  let state;
  try {
    state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch {
    state = null;
  }
  const size = fs.statSync(source).size;
  if (!state || state.source !== source || size < state.offset || !fs.existsSync(out)) {
    state = freshState(source);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, '');
  }
  if (size === state.offset) return out;
  const fd = fs.openSync(source, 'r');
  let chunk;
  try {
    chunk = Buffer.alloc(size - state.offset);
    fs.readSync(fd, chunk, 0, chunk.length, state.offset);
  } finally {
    fs.closeSync(fd);
  }
  const text = chunk.toString('utf8');
  const end = text.lastIndexOf('\n'); // só linhas completas; o resto fica para a próxima vez
  if (end === -1) return out;
  const lines = [];
  for (const raw of text.slice(0, end).split('\n')) {
    if (!raw.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(raw);
    } catch {
      continue;
    }
    for (const line of convertEntry(entry, state)) lines.push(JSON.stringify(line));
  }
  if (lines.length) fs.appendFileSync(out, `${lines.join('\n')}\n`);
  state.offset += Buffer.byteLength(text.slice(0, end + 1), 'utf8');
  fs.writeFileSync(statePath, JSON.stringify(state));
  return out;
}
