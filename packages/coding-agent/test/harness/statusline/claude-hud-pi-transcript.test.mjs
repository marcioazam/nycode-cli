// Run: node --test ~/.pi/agent/claude-home/bin/hud/tests/claude-hud-pi-transcript.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { isPiSession, syncTranscript } from '../claude-hud-pi-transcript.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
let n = 0;
const msg = (message) => ({ type: 'message', id: `e${n++}`, parentId: null, timestamp: '2026-11-11T10:00:00.000Z', message });
const call = (id, name, args) => msg({ role: 'assistant', content: [{ type: 'toolCall', id, name, arguments: args }], usage: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 }, model: 'claude-opus-5-5', responseId: `r-${id}` });
const result = (id, toolName, text, isError = false) => msg({ role: 'toolResult', toolCallId: id, toolName, content: [{ type: 'text', text }], isError });
const header = { type: 'session', version: 3, id: 's', timestamp: '2026-11-11T10:00:00.000Z', cwd: '/x' };

const tmpDirs = [];
after(() => tmpDirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

function setup(entries) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hudpi-'));
  tmpDirs.push(dir);
  const source = path.join(dir, 'session.jsonl');
  fs.writeFileSync(source, [header, ...entries].map((e) => JSON.stringify(e)).join('\n') + '\n');
  return { dir, source, out: path.join(dir, 'out', 'session.jsonl') };
}
const lines = (file) => fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const toolUses = (file) => lines(file).flatMap((l) => (Array.isArray(l.message?.content) ? l.message.content : [])).filter((b) => b.type === 'tool_use');

test('detects pi sessions only', () => {
  const { source, dir } = setup([]);
  assert.equal(isPiSession(source), true);
  const claude = path.join(dir, 'claude.jsonl');
  fs.writeFileSync(claude, '{"type":"user","message":{"content":"x"}}\n');
  assert.equal(isPiSession(claude), false);
  assert.equal(isPiSession(path.join(dir, 'missing.jsonl')), false);
});

test('maps pi tools to the Claude names the HUD knows', () => {
  const { source, out } = setup([
    call('t1', 'bash', { command: 'ls' }), result('t1', 'bash', 'ok'),
    call('t2', 'read', { path: '/a/b.py' }), result('t2', 'read', 'x'),
    call('t3', 'read', { path: '/h/.pi/agent/claude-home/skills/tdd/SKILL.md' }), result('t3', 'read', 'x'),
    call('t4', 'edit', { path: '/a/b.py', edits: [] }), result('t4', 'edit', 'x', true),
    call('t5', 'find', { pattern: '*.ts' }), call('t6', 'mcp__keenable__search_web_pages', { query: 'q' }),
  ]);
  syncTranscript(source, out);
  const uses = toolUses(out);
  assert.deepEqual(uses.map((u) => u.name), ['Bash', 'Read', 'Skill', 'Edit', 'Glob', 'mcp__keenable__search_web_pages']);
  assert.deepEqual(uses[1].input, { file_path: '/a/b.py' });
  assert.deepEqual(uses[2].input, { skill: 'tdd' });
  const results = lines(out).flatMap((l) => (Array.isArray(l.message?.content) ? l.message.content : [])).filter((b) => b.type === 'tool_result');
  assert.deepEqual(results.map((r) => [r.tool_use_id, r.is_error]), [['t1', false], ['t2', false], ['t3', false], ['t4', true]]);
  const usage = lines(out).find((l) => l.type === 'assistant').message.usage;
  assert.deepEqual(usage, { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 });
});

test('subagent calls emit no Agent blocks nor agent queue ops; other tools and todos stay', () => {
  const { source, out } = setup([
    call('s1', 'subagent', { agent: 'code-reviewer', task: 'review the diff' }), result('s1', 'subagent', 'done'),
    call('s2', 'subagent', { tasks: [{ agent: 'Explore', task: 'a' }, { agent: 'swarm-worker', task: 'b' }] }), result('s2', 'subagent', 'done'),
    call('s3', 'subagent', { agent: 'gate-runner', task: 'gate', background: true }),
    result('s3', 'subagent', 'Started background run bg-abc123 (gate-runner). A notification will arrive...'),
    msg({ role: 'user', content: 'x' }),
    { type: 'custom_message', customType: 'subagent-background', content: 'Background subagent run bg-abc123 (gate-runner) done after 5 turns.\n\nok', timestamp: '2026-11-11T10:05:00.000Z' },
    call('t1', 'bash', { command: 'ls' }), result('t1', 'bash', 'ok'),
    call('d1', 'todo', { action: 'add', text: 'tarefa' }), result('d1', 'todo', 'Added #1'),
  ]);
  syncTranscript(source, out);
  const names = toolUses(out).map((u) => u.name);
  assert.equal(names.includes('Agent'), false);
  assert.equal(names.includes('subagent'), false);
  assert.equal(lines(out).some((l) => l.type === 'queue-operation'), false);
  assert.deepEqual(names.filter((n) => n === 'Bash' || n === 'TodoWrite'), ['Bash', 'TodoWrite']);
});

test('todo actions rebuild the list as TodoWrite', () => {
  const { source, out } = setup([
    call('a', 'todo', { action: 'add', text: 'um' }), result('a', 'todo', 'Added todo #1: um'),
    call('b', 'todo', { action: 'add', text: 'dois' }), result('b', 'todo', 'Added todo #2: dois'),
    call('c', 'todo', { action: 'start', id: 1 }), result('c', 'todo', 'Started #1'),
    call('d', 'todo', { action: 'start', id: 2 }), result('d', 'todo', 'Started #2'),
    call('e', 'todo', { action: 'complete', id: 2 }), result('e', 'todo', 'Completed #2'),
    call('f', 'todo', { action: 'complete', id: 9 }), result('f', 'todo', 'no such todo', true),
  ]);
  syncTranscript(source, out);
  const writes = toolUses(out).filter((u) => u.name === 'TodoWrite');
  assert.equal(writes.length, 5);
  assert.deepEqual(writes.at(-1).input.todos, [{ content: 'um', status: 'pending' }, { content: 'dois', status: 'completed' }]);
  assert.equal(toolUses(out).some((u) => u.name === 'todo'), false);
});

test('incremental: appends only new complete lines, rebuilds when the source shrinks', () => {
  const { source, out } = setup([call('t1', 'bash', { command: 'a' })]);
  syncTranscript(source, out);
  assert.equal(toolUses(out).length, 1);
  fs.appendFileSync(source, JSON.stringify(result('t1', 'bash', 'ok')) + '\n' + '{"type":"message","partial');
  syncTranscript(source, out);
  assert.equal(lines(out).length, 2);
  syncTranscript(source, out); // nada novo: idempotente
  assert.equal(lines(out).length, 2);
  fs.writeFileSync(source, JSON.stringify(header) + '\n');
  syncTranscript(source, out);
  assert.equal(fs.readFileSync(out, 'utf8'), '');
});

test('launcher feeds the translated transcript to the HUD (end to end)', async () => {
  const hud = fs.readdirSync(path.join(os.homedir(), '.claude', 'plugins', 'cache'), { withFileTypes: true });
  if (!hud.some((d) => d.name === 'claude-hud')) return; // sem claude-hud instalado: nada a testar
  const { source, dir } = setup([
    call('a', 'todo', { action: 'add', text: 'tarefa' }), result('a', 'todo', 'Added todo #1: tarefa'),
    call('b', 'todo', { action: 'start', id: 1 }), result('b', 'todo', 'Started #1'),
    call('t1', 'bash', { command: 'ls' }), result('t1', 'bash', 'ok'),
  ]);
  fs.mkdirSync(path.join(dir, 'plugins', 'claude-hud'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'plugins', 'claude-hud', 'config.json'), JSON.stringify({ display: { showTools: true, showTodos: true } }));
  const { execFileSync } = await import('node:child_process');
  const payload = JSON.stringify({ model: { display_name: 'Opus' }, cwd: dir, context_window: { used_percentage: 1, context_window_size: 200000 }, transcript_path: source });
  const outText = execFileSync('node', [path.join(here, '..', 'claude-hud-statusline.mjs')], { input: payload, env: { ...process.env, CLAUDE_CONFIG_DIR: dir, COLUMNS: '160' } }).toString().replace(/\x1b\[[0-9;]*m/g, '');
  assert.match(outText, /Bash/);
  assert.match(outText, /tarefa/);
});
