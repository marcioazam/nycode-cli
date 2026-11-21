/* Onda 10 · demos. Regra do mock: dentro de .term só muda cor de frente, cor de fundo ou glifo de célula inteira,
   como num terminal. Exceções que o protocolo desenha de fato: sublinhado ondulado (P12), ponteiro (P21),
   barra de progresso da janela (P22) e texto em escala (P24). Depende de dados.js (PAL, NOTIF). */
'use strict';

let THEME = 'dark';
let MODE = 'normal'; // normal | reduzido | desligado
const VARIANTE = { P25: 'envio' };

const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const C = n => hex(PAL[THEME][n]);
const clamp01 = t => Math.max(0, Math.min(1, t));
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * clamp01(t)));
const rgb = a => `rgb(${a[0]} ${a[1]} ${a[2]})`;
const k = (cor, s) => `<span style="color:${rgb(cor)}">${esc(s)}</span>`;
const c = (cls, s) => `<span class="${cls}">${esc(s)}</span>`;
const R = (l, r = '', cls = '') => `<div class="r ${cls}"><span>${l || ' '}</span>${r ? `<span class="m">${r}</span>` : ''}</div>`;
const easeOut = t => 1 - (1 - clamp01(t)) ** 3;
const easeInOut = t => ((t = clamp01(t)) < .5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
const num = (n, d = 2) => n.toFixed(d).replace('.', ',');
const fmtS = s => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`);
const FR = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';

/* Cor: contraste WCAG 2.x e OKLab (para o pico proposto). */
const lin = v => ((v /= 255) <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
const Y = q => .2126 * lin(q[0]) + .7152 * lin(q[1]) + .0722 * lin(q[2]);
const contraste = (a, b) => (Math.max(Y(a), Y(b)) + .05) / (Math.min(Y(a), Y(b)) + .05);
const toOk = q => {
  const [r, g, b] = q.map(lin);
  const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b), m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b), s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
  return [.2104542553 * l + .793617785 * m - .0040720468 * s, 1.9779984951 * l - 2.428592205 * m + .4505937099 * s, .0259040371 * l + .7827717662 * m - .808675766 * s];
};
const fromOk = ([L, a, b]) => {
  const l = (L + .3963377774 * a + .2158037573 * b) ** 3, m = (L - .1055613458 * a - .0638541728 * b) ** 3, s = (L - .0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + .2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - .3413193965 * s, -.0041960863 * l - .7034186147 * m + 1.707614701 * s]
    .map(v => Math.round(255 * ((v = clamp01(v)) <= .0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - .055)));
};

/* Cópia fiel de motion.ts:86-101 (relLum e highlightPeak): decide pelo texto, não pelo fundo. */
const relLum = q => .2126 * (q[0] / 255) ** 2.2 + .7152 * (q[1] / 255) ** 2.2 + .0722 * (q[2] / 255) ** 2.2;
const peakHoje = base => (relLum(base) > .35 ? [15, 23, 42] : [245, 250, 255]);
/** Pico proposto (P04): o token mais claro em OKLCH; recua até o pico manter 3:1 contra o fundo. */
function peakNovo(base, bg) {
  const ok = toOk(base);
  for (let d = .16; d > .01; d -= .02) {
    const p = fromOk([Math.min(1, ok[0] + d), ok[1], ok[2]]);
    if (contraste(mix(base, p, .88), bg) >= 3) return p;
  }
  return base;
}
const gauss = (i, pos, w = 2.2) => Math.exp(-((i - pos) ** 2) / w);
/** Shimmer atual: varredura linear de 1350 ms, mistura 0,88 (motion.ts:104-125). */
function shimHoje(word, t, base) {
  const peak = peakHoje(base), ch = [...word], pos = ((t % 1350) / 1350) * (ch.length + 5) - 2.5;
  return ch.map((x, i) => k(mix(base, peak, gauss(i, pos) * .88), x)).join('');
}
/** Shimmer proposto: 900 ms com aceleração e freio, 500 ms de descanso, pico na cor do token. */
function shimNovo(word, t, base, bg) {
  const peak = peakNovo(base, bg), ch = [...word], pos = easeInOut((t % 1400) / 900) * (ch.length + 5) - 2.5;
  return ch.map((x, i) => k(mix(base, peak, gauss(i, pos) * .88), x)).join('');
}
/** Assentamento atual ao concluir: 240 ms, decaimento quadrático, mistura 0,78 (motion.ts:133-150). */
function settle(word, base, age) {
  if (MODE !== 'normal' || age < 0 || age >= 240) return k(base, word);
  return k(mix(base, peakHoje(base), (1 - age / 240) ** 2 * .78), word);
}

/** Linha de trabalho real: spinner em accent, fase com shimmer, resto em syntaxType. */
function work(t, head, tail, o = {}) {
  if (MODE === 'desligado') return R(o.fixo ?? c('sy', 'trabalhando… · esc interrompe'));
  const sp = o.spin ?? c('ac', MODE === 'normal' ? FR[Math.floor(t / 80) % 10] : '●');
  const h = MODE === 'normal' && !o.semShim ? (o.shim ?? shimHoje)(head, o.tq ?? t, C('syn'), C('bg')) : c('sy', head);
  return R(`${sp} ${h}${c('sy', tail)}`);
}
const pill = s => `<span class="pill">${esc(s)}</span>`;
/** Caixa de tool: ícone, nome em negrito, estado; pílula e hora à direita; corpo com trilho. */
function tool(o) {
  const right = o.direita ?? [o.dica === false ? '' : pill('ctrl+o abre'), o.hora ? pill(o.hora) : ''].filter(Boolean).join(' ');
  const head = `${c('mu', o.icone ?? '$')} <b>${esc(o.nome ?? 'bash')}</b>${c('d', ' · ')}${o.estado}`;
  return `<div class="bx" style="background:${o.bg}">${R(head, right)}${(o.corpo ?? []).map(l => R(`  ${c('d', '│')} ${l}`)).join('')}</div>`;
}
const v = n => `var(--k-${n})`;
const nota = s => R(c('d', s));

/* ───── demos animadas: (t em ms desde o início ou o último repetir) => [antes, depois] ───── */
const DEMOS = {
  P01(t) {
    const linha = (m, rotulo) => {
      const salvo = MODE; MODE = m;
      const html = work(salvo === 'normal' ? t : 240, 'pensando', ' · 12s · esc interrompe');
      MODE = salvo;
      return `<div class="${salvo === m ? 'u' : ''}">${R(`<b>${rotulo}</b>`, salvo === m ? 'em uso nesta página' : '')}${html}</div>`;
    };
    const tab = [['PI_REDUCED_MOTION=1', 0, 0], ['PI_REDUCED_MOTION=true', 1, 0], ['TERM=linux', 1, 0], ['NO_COLOR=1', 1, 0], ['NO_PROGRESS=1', 0, 0], ['TERM=dumb', 0, 0]];
    const cel = on => (on ? c('wn', 'anima   ') : 'parado  ');
    return [
      R(c('d', `${'variável'.padEnd(25)}spinner shimmer`)) + tab.map(([n, s, h]) => R(`${esc(n.padEnd(25))}${cel(s)}${cel(h)}`)).join('') + nota('duas funções, duas respostas'),
      linha('normal', 'normal') + linha('reduzido', 'reduzido') + linha('desligado', 'desligado'),
    ];
  },
  P02(t) {
    const base = C('syn'), q = fps => Math.floor(t / (1000 / fps)) * (1000 / fps);
    const bytes = [...'pensando'].reduce((n, _, i) => n + 11 + mix(base, peakHoje(base), gauss(i, 4) * .88).join('').length, 5);
    const kb = fps => `≈ ${num(bytes * fps / 1000, 1)} kB/s`;
    const trab = tq => (MODE === 'desligado' ? c('sy', 'trabalhando…')
      : `${c('ac', MODE === 'normal' ? FR[Math.floor(tq / 80) % 10] : '●')} ${MODE === 'normal' ? shimHoje('pensando', tq, base) : c('sy', 'pensando')}${c('sy', ' · 12s')}`);
    const linha = (fps, rot) => R(`${String(fps).padStart(3)} fps  ${trab(q(fps))}`, rot);
    return [
      linha(120, kb(120)) + nota('com ou sem foco, em qualquer conexão') + nota(`este navegador desenha ${FPS.valor || '…'} quadros por segundo`),
      linha(60, 'transições curtas') + linha(30, `contínuos · ${kb(30)}`) + linha(15, `tmux ou SSH · ${kb(15)}`)
        + R(`  0 fps  ${c('ac', '●')} ${c('sy', 'pensando · 12s')}`, 'sem foco: pausado') + nota('kB/s: estimativa só da palavra com shimmer'),
    ];
  },
  P03(t) {
    const p = MODE === 'normal' ? clamp01((t % 2600) / 1000) : 1;
    const trilho = (rot, f, desc) => {
      const pos = Math.round(f(p) * 23);
      return R(`${rot.padEnd(10)}${c('d', '─'.repeat(pos))}${c('ac', '█')}${c('d', '─'.repeat(23 - pos))}  ${c('d', desc)}`);
    };
    const hoje = [['80 ms', 'spinner', 'a11y.ts:8'], ['165 ms', 'brilho de tecla', 'editor.ts:353'], ['225 ms', 'varredura da régua', 'editor.ts:361'], ['240 ms', 'assentamento', 'motion.ts:133'],
      ['240 ms', 'pulso da bolinha', 'icons.ts:179'], ['1350 ms', 'shimmer', 'motion.ts:115'], ['0.0048', 'cometa (seno)', 'motion.ts:172']];
    return [
      hoje.map(([a, b, f]) => R(`${a.padEnd(9)}${esc(b)}`, f)).join(''),
      R(`<b>rápido</b> 120 ms  <b>padrão</b> 200 ms  <b>lento</b> 320 ms`) + R(' ')
        + trilho('saída', easeOut, 'entra e assenta') + trilho('movimento', easeInOut, 'vai de A a B') + trilho('contínuo', x => x, 'spinner, shimmer')
        + R(' ') + nota('em câmera lenta 5×: o trajeto real leva 200 ms'),
    ];
  },
  P04(t) {
    const base = C('syn'), lado = (shim, peak) => {
      const pico = mix(base, peak, .88), st = MODE === 'normal' ? shim('executando', t, base, C('pend')) : c('sy', 'executando');
      return tool({ bg: v('pend'), estado: st, corpo: [`${c('mu', '$ ')}npm test`] }) + work(t, 'pensando', ' · 12s · esc interrompe', { shim })
        + nota(`contraste no pico: ${num(contraste(pico, C('pend')))}:1 na caixa · ${num(contraste(pico, C('bg')))}:1 no fundo`);
    };
    return [lado(shimHoje, peakHoje(base)), lado(shimNovo, peakNovo(base, C('pend')))];
  },
  P05(t) {
    const tt = t % 11000, s = 41 + Math.floor(tt / 1000), parado = tt >= 2500 && tt < 8000, tau = tt - 2500;
    const fase = nota(tt < 2500 ? 'simulação: eventos chegando' : parado ? 'simulação: nenhum evento do modelo' : 'simulação: evento chegou');
    const antes = work(t, 'pensando', ` · ${fmtS(s)} · esc interrompe`);
    if (!parado) return [antes + fase, work(t, tt < 2500 ? 'pensando' : 'escrevendo', ` · ${fmtS(s)} · esc interrompe`) + fase];
    const cor = MODE === 'normal' ? mix(C('accent'), C('warn'), tau / 2000) : C('warn');
    const txt = `sem resposta há ${10 + Math.floor(tau / 1000)}s`;
    const dep = MODE === 'desligado' ? R(`${c('wn', txt)}${c('sy', ' · esc interrompe')}`)
      : R(`${k(cor, MODE === 'normal' ? FR[Math.floor(t / 80) % 10] : '●')} ${k(cor, txt)}${c('sy', ' · esc interrompe')}`);
    return [antes + fase, dep + fase];
  },
  P06(t) {
    const tt = t % 9000, fim = tt >= 6000, s = Math.floor(tt / 1000);
    const saida = ['PASS src/auth/token.test.ts', 'PASS src/auth/sessao.test.ts', 'RUNS src/api/rotas.test.ts'].slice(0, fim ? 3 : Math.floor(tt / 1500));
    const corpo = [`${c('mu', '$ ')}npm test`, ...saida.map(l => c('mu', fim ? l.replace('RUNS', 'PASS') : l))];
    const caixa = tempo => tool({
      bg: v(fim ? 'succ' : 'pend'), hora: fim ? '10:42' : '', corpo,
      estado: fim ? `${settle('concluído', C('ok'), tt - 6000)}${c('d', ' · 6s')}`
        : `${MODE === 'normal' ? shimHoje('executando', t, C('syn')) : c('sy', 'executando')}${tempo && s >= 2 ? c('sy', ` · ${s}s`) : ''}`,
    });
    return [caixa(false), caixa(MODE !== 'desligado')];
  },
  P07(t) {
    const tt = t % 7000, erro = tt >= 3500, loc = erro ? tt - 3500 : tt, fim = loc >= 1500, age = loc - 1500;
    const alvo = erro ? 'fail' : 'succ', cor = C(erro ? 'err' : 'ok'), palavra = erro ? 'erro' : 'concluído';
    const corpo = [`${c('mu', '$ ')}npm test`, ...(fim ? [c('mu', erro ? '1 falhou: o token expira antes da renovação' : '14 testes, 14 passaram')] : [])];
    const caixa = novo => tool({
      corpo, hora: fim ? '10:42' : '',
      bg: !fim ? v('pend') : novo && MODE !== 'desligado' ? rgb(mix(C('pend'), C(alvo), easeOut(age / 200))) : v(alvo),
      estado: !fim ? (MODE === 'normal' ? shimHoje('executando', t, C('syn')) : c('sy', 'executando')) : erro && !novo ? k(cor, palavra) : settle(palavra, cor, age),
    });
    return [caixa(false), caixa(true)];
  },
  P08(t) {
    const passo = 1400, tt = t % (8 * passo + 2400), done = Math.min(8, Math.floor(tt / passo)), ativo = done < 8;
    const itens = ['ler o teste que falha', 'achar onde o token renova', 'mover a checagem', 'cobrir com teste novo', 'rodar a suíte de auth', 'rodar o lint', 'revisar o diff', 'escrever o resumo'];
    const titulo = `${c('ac', '☰')} <b>Task</b>${c('d', ' · ')}${done ? `${c('ok', 'concluída')} ${c('ac', `#${done}`)}  ${esc(itens[done - 1])}` : `${c('sy', 'iniciada')} ${c('ac', '#1')}  ${esc(itens[0])}`}`;
    const fim = ` ${c('mu', `${done}/8`)} ${c('d', `${Math.round(done / 8 * 100)}%`)}`;
    const cheias = Math.min(6, Math.round(done / 8 * 6)), rem = 6 - cheias;
    let cauda = c('d', '╌'.repeat(rem));
    if (ativo && MODE === 'normal' && rem) {
      const pos = rem === 1 ? 0 : ((Math.sin(t * .0048) + 1) / 2) * (rem - 1);
      cauda = Array.from({ length: rem }, (_, i) => { const g = gauss(i, pos, 1.15); return k(mix(C('dim'), C('syn'), g), g > .62 ? '━' : '╌'); }).join('');
    }
    const prog = done ? done - 1 + (MODE === 'normal' ? easeOut((tt - done * passo) / 200) : 1) : 0;
    const oit = Math.round(prog / 8 * 48), ch = Math.floor(oit / 8), parte = oit % 8;
    const barra = `<span class="trk">${c('ok', '█'.repeat(ch) + (parte ? ' ▏▎▍▌▋▊▉'[parte] : ''))}${' '.repeat(6 - ch - (parte ? 1 : 0))}</span>`;
    const caixa = b => `<div class="bx" style="background:${v('surf')}">${R(titulo, pill('10:42'))}${R(`  ${b}${fim}`)}</div>`;
    return [caixa(c('ok', '━'.repeat(cheias)) + cauda) + nota('6 passos para 8 tarefas'), caixa(barra) + nota('48 passos; cada tarefa move a barra')];
  },
  P09(t) {
    const tt = t % 16000, s = 3 + Math.floor(tt / 500), dicas = ['ctrl+o abre a saída da tool', '? mostra os atalhos', 'ctrl+s guarda o rascunho'];
    const linha = work(t, 'pensando', ` · ${fmtS(s)} · esc interrompe`), rel = nota('tempo da demo: 2× mais rápido');
    let dica = R(' ');
    if (s >= 5 && MODE !== 'desligado') {
      const age = ((s - 5) % 8) * 500 + (tt % 500);
      dica = R(`  ${k(MODE === 'normal' ? mix(C('bg'), C('dim'), age / 200) : C('dim'), `dica: ${dicas[Math.floor((s - 5) / 8) % 3]}`)}`);
    }
    return [linha + R(' ') + rel, linha + dica + rel];
  },
  P10(t) {
    const tt = t % 30000, s = 12 + Math.floor(tt / 1000), n = 840 + Math.floor(tt * .06);
    const tok = (n < 1000 ? String(n) : `${num(n / 1000, 1)}k`).padStart(4);
    return [work(t, 'escrevendo', ` · ${fmtS(s)} · esc interrompe`), work(t, 'escrevendo', ` · ${fmtS(s)} · ↓ ${tok} · esc interrompe`, { fixo: c('sy', 'trabalhando… · esc interrompe') })];
  },
  P11(t) {
    const txt = 'O teste falha porque o token expira antes da renovação. Vou mover a checagem para antes da chamada e cobrir o caso com um teste novo em token.test.ts.';
    const raj = [[0, 0], [300, 31], [1000, 55], [1250, 98], [2100, 119], [2500, txt.length]], tt = MODE === 'desligado' ? 1e5 : t % 6500;
    const chegou = x => raj.reduce((n, [quando, total]) => (x >= quando ? total : n), 0);
    const antes = `<div class="r wrap">${esc(txt.slice(0, chegou(tt)))}</div>`;
    const visto = [];
    for (let x = 0, s = 0; x <= tt && visto.length < txt.length; x += 16) {
      const atraso = chegou(x) - s;
      s += Math.min(atraso, (30 + atraso * 4) * .016);
      while (visto.length < Math.floor(s + 1e-6)) visto.push(x);
    }
    const firme = visto.findIndex(x => tt - x < 150), corte = MODE !== 'normal' || firme < 0 ? visto.length : firme;
    const cauda = visto.slice(corte).map((x, i) => k(mix(C('dim'), C('text'), (tt - x) / 150), txt[corte + i])).join('');
    return [antes, `<div class="r wrap">${esc(txt.slice(0, corte))}${cauda}</div>`];
  },
  P14(t) {
    const m = ['Conferindo onde o token é renovado', 'Comparando com o teste que falha', 'Planejando a correção em token.ts'], i = Math.floor(t / 3000) % 3;
    const cor = MODE === 'normal' ? mix(C('bg'), C('dim'), (t % 3000) / 200) : C('dim');
    const hoje = R(`${c('d', '◇')} ${c('d', 'raciocínio · clique abre')}`);
    return [hoje, MODE === 'desligado' ? hoje : R(`${c('d', '◇')} <i>${k(cor, m[i])}</i>`, c('d', 'clique abre'))];
  },
  P15(t) {
    const tt = t % 6000, on = tt >= 800 && tt < 4300, msg = ' ✓ Sem mudanças                       ';
    const topo = `<div class="um">${R(`${c('ac', '❯')} /diff`, c('d', '10:42'))}</div>${R(' ')}`;
    const seco = on || MODE === 'desligado' ? `<div class="r" style="background:${v('surf')}"><span>${c('ok', ' ✓')}${esc(msg.slice(2))}</span></div>` : R(' ');
    if (MODE === 'desligado') return [topo + seco + R(' '), topo + seco + R(' ')];
    const kk = tt < 800 ? 0 : tt < 4300 ? easeOut((tt - 800) / 160) : 1 - easeOut((tt - 4300) / 100);
    const suave = kk > 0 ? `<div class="r" style="background:${rgb(mix(C('bg'), C('surf'), kk))}"><span>${k(mix(C('bg'), C('ok'), kk), ' ✓')}${k(mix(C('bg'), C('text'), kk), msg.slice(2))}</span></div>` : R(' ');
    const regua = on && MODE === 'normal' ? R(c('d', '━'.repeat(Math.ceil(36 * (1 - (tt - 800) / 3500))))) : R(' ');
    return [topo + seco + R(' '), topo + suave + regua];
  },
  P16(t) {
    const tt = t % 7000, aberto = tt >= 1000 && tt < 5000 || MODE === 'desligado';
    const kk = MODE === 'desligado' ? .4 : tt < 1000 ? 0 : tt < 5000 ? .4 * easeOut((tt - 1000) / 200) : .4 * (1 - easeOut((tt - 5000) / 100));
    const cena = veu => {
      const f = n => rgb(mix(C(n), C('bg'), veu)), s = (n, x) => `<span style="color:${f(n)}">${esc(x)}</span>`;
      return `<div class="rel"><div class="r" style="background:${f('user')}"><span>${s('accent', '❯')} ${s('text', 'retoma a sessão de ontem')}</span></div>`
        + R(s('text', 'Você tem três sessões recentes neste projeto.'))
        + `<div style="background:${f('succ')}">${R(`${s('muted', '$')} <b>${s('text', 'bash')}</b>${s('dim', ' · ')}${s('ok', 'concluído')}`)}${R(`  ${s('dim', '│')} ${s('muted', '$ git status')}`)}</div>`
        + R(s('text', 'O repositório está limpo.')) + R(' ')
        + (aberto ? `<div class="ov">${R(c('d', '╭─ Retomar sessão ─────────╮'))}${R(`${c('d', '│')} ${c('ac', '❯')} corrigir token   2 min ${c('d', '│')}`)}${R(`${c('d', '│')}   onda 10          ontem ${c('d', '│')}`)}${R(`${c('d', '│')}   bench S3           seg ${c('d', '│')}`)}${R(c('d', '╰─ ↑↓ escolhe · esc fecha ─╯'))}</div>` : '') + '</div>';
    };
    return [cena(0), cena(kk)];
  },
  P17(t) {
    const serie = [8, 14, 21, 29, 38, 47, 55, 62, 71, 78, 86, 91], i = MODE === 'desligado' ? 8 : Math.floor(t / 1200) % serie.length, val = serie[i];
    const cls = val >= 85 ? 'er' : val >= 70 ? 'wn' : 'ok', graf = serie.slice(Math.max(0, i - 7), i + 1).map(x => '▁▂▃▄▅▆▇█'[Math.min(7, Math.floor(x / 12.5))]).join('');
    const rot = val >= 85 ? ' · acima de 85%' : val >= 70 ? ' · acima de 70%' : '';
    return [R(`${c('d', 'contexto')} ${c(cls, `${val}%`)}`, c('d', `turno ${i + 1}`)), R(`${c('d', 'contexto')} ${c(cls, graf.padStart(8))} ${c(cls, `${val}%`)}${c(cls, rot)}`, c('d', `turno ${i + 1}`))];
  },
  P19(t) {
    const tt = t % 5000, seg = [[[' ', ''], ['▀', 'color:rgb(228 138 122);background:rgb(79 142 179)'], ['▀█', 'color:rgb(228 138 122)'], ['   ', ''], ['pi', `font-weight:700;color:${v('text')}`], [' 1.5.2', `color:${v('dim')}`]],
      [[' ', ''], ['█▀', 'color:rgb(79 142 179)'], [' ', ''], ['█', 'color:rgb(234 182 93)'], ['  ', ''], ['?', `font-weight:700;color:${v('text')}`], [' atalhos    ', `color:${v('dim')}`], ['/', `font-weight:700;color:${v('text')}`], [' comandos    ', `color:${v('dim')}`], ['!', `font-weight:700;color:${v('text')}`], [' shell', `color:${v('dim')}`]]];
    const corta = n => seg.map(l => { let resto = n; return R(l.map(([s, st]) => { const x = [...s].slice(0, Math.max(0, resto)).join(''); resto -= [...s].length; return x ? `<span style="${st}">${esc(x)}</span>` : ''; }).join('')); }).join('');
    const cheio = MODE !== 'normal' || tt >= 600;
    return [corta(cheio ? 99 : 0), corta(MODE !== 'normal' ? 99 : tt < 600 ? 0 : Math.ceil(easeOut((tt - 600) / 320) * 44))];
  },
  P20(t) {
    const tt = t % 5000, fim = tt >= 800 || MODE !== 'normal', age = tt - 800;
    const caixa = varre => {
      if (!fim) return tool({ icone: '◈', nome: 'plano', bg: v('pend'), dica: false, estado: `${shimHoje('executando', t, C('syn'))}${c('d', ' · 5/6')}` });
      const pos = varre && MODE === 'normal' && age < 600 ? easeInOut(age / 600) * 26 - 3 : -99;
      const sw = (txt, n, o) => [...txt].map((x, i) => k(mix(C(n), peakNovo(C(n), C('succ')), gauss(o + i, pos, 4) * .88), x)).join('');
      return `<div class="bx" style="background:${v('succ')}">${R(`${sw('◈', 'muted', 0)} <b>${sw('plano', 'text', 2)}</b>${sw(' · ', 'dim', 7)}${varre ? sw('concluído', 'ok', 10) : settle('concluído', C('ok'), age)}${sw(' · 6/6', 'dim', 19)}`, pill('10:42'))}${R(`  ${c('d', '│')} ${c('mu', 'próximo passo: revisar o diff')}`)}</div>`;
    };
    return [caixa(false), caixa(true)];
  },
  P22(t) {
    const est = [['trabalhando', 'OSC 9;4;3', 'accent'], ['Task 5/8 · 62%', 'OSC 9;4;1;62', 'accent'], ['esperando permissão', 'OSC 9;4;4', 'warn'], ['parou com erro', 'OSC 9;4;2', 'err']];
    const i = MODE === 'desligado' ? 1 : Math.floor(t / 2600) % 4, x = MODE === 'normal' ? ((t % 1400) / 1400) * 130 - 30 : 35;
    const barra = i === 0 ? `left:${x}%;width:30%` : `left:0;width:${i === 3 ? 100 : 62}%`;
    const lista = dep => est.map(([n, o], j) => R(`${j === i ? c('ac', '❯') : ' '} ${esc(n)}`, dep ? o : 'sem barra', j === i ? 'u' : '')).join('');
    return [
      `${lista(false)}${nota('kitty: suportado() responde não')}`,
      `<div class="pg"><i style="${barra};background:${v(est[i][2])}"></i></div>${lista(true)}${nota('seu kitty é 0.45.0; a barra existe desde a 0.47')}`,
    ];
  },
  P25(t) {
    const txt = 'corrige o teste de token', tt = t % 6000, n = Math.max(0, Math.min(txt.length, Math.floor((tt - 400) / 110))), enviado = tt >= 3400;
    const lado = modo => {
      const brilho = age => (MODE === 'normal' && age >= 0 && age < 165 ? mix(C('text'), peakHoje(C('text')), (1 - age / 165) ** 2 * .88) : C('text'));
      const msg = enviado ? `<div class="um">${R(`${c('ac', '❯')} ${k(modo === 'envio' ? brilho(tt - 3400) : C('text'), txt)}`, c('d', '10:42'))}</div>` : R(' ');
      const dig = enviado || !n ? '' : esc(txt.slice(0, n - 1)) + k(modo === 'manter' ? brilho(tt - 400 - n * 110) : C('text'), txt[n - 1]);
      return `${msg}<div class="rl"></div>${R(`${c('ac', '❯')} ${dig}${c('ac', '▏')}`)}<div class="rl"></div>`;
    };
    return [lado('manter'), lado(VARIANTE.P25) + nota(`variante: ${{ manter: 'manter', envio: 'só no envio', remover: 'remover' }[VARIANTE.P25]}`)];
  },
};

/* ───── demos paradas ou interativas: montadas uma vez (cores só por classe) ───── */
const PARADAS = {
  P12(a, b) {
    const cod = sub => `<div class="bx" style="background:${v('surf')}">${R(`${c('ac', '✎')} <b>token.ts</b>  ${c('d', 'src/auth')}${c('d', ' · ')}${c('er', 'erro de sintaxe')}`)}`
      + R(`  ${c('d', '41')}  export function ${c('ac', 'ttl')}(env: Env): number {`)
      + R(`  ${c('d', '42')}    return ${c('ac', 'parseInt')}(<span class="${sub ? 'uc' : 'er'}">env.TTL, ${sub ? c('cd', '10') : '10'}</span>`)
      + R(`  ${c('d', '43')}  }`) + R(`  ${c('er', '✕')} linha 42: “)” esperado`) + '</div>';
    a.innerHTML = cod(false); b.innerHTML = cod(true);
  },
  P13(a, b) {
    const cena = lk => {
      const p = s => (lk ? `<button type="button" class="lk" data-abre="${esc(s)}">${esc(s)}</button>` : esc(s));
      return tool({ icone: '✎', nome: 'token.ts', bg: v('surf'), hora: '10:42', estado: `${c('ok', '+3')} ${c('er', '−1')}${c('d', ' · ')}${c('ok', 'concluído')}`, corpo: [`<span class="mu">${p('src/auth/token.ts:42')}</span>`] })
        + R(' ') + `<div class="r wrap">Corrigi em ${p('src/auth/token.ts:42')} e registrei na ${p('#123')}.</div>` + R(' ')
        + `<div class="r d" ${lk ? 'role="status"' : ''}>${lk ? 'clique num caminho' : 'texto comum: nada para clicar'}</div>`;
    };
    a.innerHTML = cena(false); b.innerHTML = cena(true);
    b.addEventListener('click', e => { const x = e.target.closest('[data-abre]'); if (x) b.querySelector('[role=status]').textContent = `abriria ${x.dataset.abre} ${x.dataset.abre[0] === '#' ? 'no navegador' : 'no editor'}`; });
  },
  P18(a, b) {
    const ed = (ph, rot) => `<div class="rl"><span>corrigir token</span></div><div class="r ed"><span class="ac">❯</span><input type="text" autocomplete="off" spellcheck="false" aria-label="${rot}" ${ph ? 'placeholder="Pergunte, ou / comandos · @ arquivos · ! shell"' : ''}></div><div class="rl"></div>`;
    a.innerHTML = ed(false, 'Editor de exemplo, como é hoje'); b.innerHTML = ed(true, 'Editor de exemplo, com placeholder');
  },
  P21(a, b) {
    const cena = hv => tool({ bg: v('succ'), estado: c('ok', 'concluído'), corpo: [`${c('mu', '$ ')}npm test`], direita: `<span class="pill ${hv}">ctrl+o abre</span> ${pill('10:42')}` })
      + R(' ') + `<div class="r"><span><span class="${hv}">${c('d', '◇ raciocínio · clique abre')}</span></span></div>` + R(' ') + nota(hv ? 'passe o mouse: realce e ponteiro de mão' : 'passe o mouse: nada muda');
    a.innerHTML = cena(''); b.innerHTML = cena('hv');
  },
  P23(a, b) {
    const tab = novo => NOTIF.map(([term, seq]) => { const mudo = !novo && term === 'iTerm2'; return R(`${term.padEnd(11)}${c('d', seq)}`, mudo ? c('wn', 'sem aviso') : c('ok', 'avisa')); }).join('');
    a.innerHTML = R(c('d', 'envia OSC 99 e OSC 777')) + tab(false); b.innerHTML = R(c('d', 'envia OSC 99, OSC 777 e OSC 9; BEL por último')) + tab(true);
  },
  P24(a, b) {
    const corpo = R(' ') + R('O token expira antes da renovação.') + R(`Mover a checagem em ${c('cd', 'token.ts')} resolve.`);
    a.innerHTML = R(`<b>${c('ac', 'Plano de correção')}</b>`) + corpo;
    b.innerHTML = `<div class="x2"><b>${c('ac', 'Plano de correção')}</b></div>` + corpo + nota('ocupa duas linhas; o pi-tui conta uma');
  },
};

/* ───── motor: um relógio, só o que está visível, pausa global, modo global ───── */
const FPS = { valor: 0, n: 0, t0: 0 };
const Motor = {
  itens: new Map(), T: 0, ultimo: 0, pausado: false, sujo: true,
  registra(id, raiz, a, b) {
    const it = { id, a, b, t0: 0, visivel: false, ha: '', hb: '' };
    this.itens.set(id, it);
    if (PARADAS[id]) return PARADAS[id](a, b);
    this.obs.observe(raiz); raiz.__it = it;
  },
  repete(id) { const it = this.itens.get(id); if (it) { it.t0 = this.T; this.sujo = true; } },
  quadro(agora) {
    const dt = Math.min(100, agora - (this.ultimo || agora)); this.ultimo = agora;
    if (++FPS.n && agora - FPS.t0 >= 1000) { FPS.valor = Math.round(FPS.n * 1000 / (agora - FPS.t0)); FPS.n = 0; FPS.t0 = agora; }
    const anda = !this.pausado && MODE !== 'desligado';
    if (anda) this.T += dt;
    if (anda || this.sujo) {
      for (const it of this.itens.values()) {
        if (!DEMOS[it.id] || (!it.visivel && !this.sujo)) continue;
        const [ha, hb] = DEMOS[it.id](MODE === 'desligado' ? 2600 : this.T - it.t0);
        if (ha !== it.ha) it.a.innerHTML = it.ha = ha;
        if (hb !== it.hb) it.b.innerHTML = it.hb = hb;
      }
      this.sujo = false;
    }
    requestAnimationFrame(x => this.quadro(x));
  },
  inicia() {
    this.obs = new IntersectionObserver(es => es.forEach(e => { e.target.__it.visivel = e.isIntersecting; }), { rootMargin: '80px' });
    requestAnimationFrame(x => this.quadro(x));
  },
};
/** Aplica os tokens do tema ao mock (variáveis --k-*) e redesenha. */
function aplicaTema(escuro) {
  THEME = escuro ? 'dark' : 'light';
  for (const [n, h] of Object.entries(PAL[THEME])) document.documentElement.style.setProperty(`--k-${n}`, h);
  // pílula: a mesma conta de pillChip (motion.ts:189-190), escurece o fundo da caixa
  document.documentElement.style.setProperty('--k-pill', escuro ? 'rgb(10 11 18/.36)' : 'rgb(0 0 0/.08)');
  Motor.sujo = true;
}
