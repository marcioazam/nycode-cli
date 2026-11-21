// Onda 12: desenha os mocks a partir de ONDA12 e junta as escolhas. Sem dependências.
// Marcação de linha: "@x " fundo (p s e n u l w) · "~ " centraliza · ">>" empurra à direita
// {classes:texto} colore (uma letra por classe) · {r:─~} preenche o resto da linha com o caractere.
const CHAVE = (typeof window !== 'undefined' && window.ONDA12_CHAVE) || 'onda12-escolhas'
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
const cls = (c) => [...c].join(' ')

function linha(s) {
  let c = 'l'
  const fundo = /^@(\w)(?: |$)/.exec(s)
  if (fundo) { c += ' bg-' + fundo[1]; s = s.slice(fundo[0].length) }
  if (s.startsWith('~ ')) { c += ' ctr'; s = s.slice(2) }
  const html = s.split(/(\{[a-z]+:[^}]*\}|>>)/).filter(Boolean).map((p) => {
    if (p === '>>') return '<span class="grow"></span>'
    const m = /^\{([a-z]+):([^}]*)\}$/.exec(p)
    if (!m) return `<span>${esc(p)}</span>`
    if (m[2].length > 1 && m[2].endsWith('~')) {
      const antes = m[2].slice(0, -2)
      return `${antes ? `<span class="${cls(m[1])}">${esc(antes)}</span>` : ''}<span class="fill ${cls(m[1])}">${esc(m[2].at(-2)).repeat(200)}</span>`
    }
    return `<span class="${cls(m[1])}">${esc(m[2])}</span>`
  }).join('')
  return `<div class="${c}">${html}</div>`
}

const linhas = (txt) => txt.replace(/^\n/, '').replace(/\n\s*$/, '').split('\n')
const term = (txt, tema) => `<div class="term" ${tema ? `data-tema="${tema}" data-fixo` : ''}><div class="in">${linhas(txt).map(linha).join('')}</div></div>`

function variante(c, chave, nome, desc, txt, tema, muda) {
  return `<div class="var"><label><input type="checkbox" data-comp="${c.id}" value="${chave}"><span>${esc(nome)}</span></label>
<p class="desc">${esc(desc || '')}${muda ? ` <span class="muda">Muda decisão em vigor: ${esc(muda)}.</span>` : ''}</p>${txt ? term(txt, tema) : ''}</div>`
}

function componente(c) {
  const vs = c.v.map((v, i) => variante(c, 'ABC'[i], `${'ABC'[i]} · ${v.n}`, v.d, v.l, v.tema, v.muda)).join('')
  const hoje = variante(c, 'hoje', 'Manter como está', c.hojeNota || 'O que o pi desenha hoje.', c.hoje, c.hojeTema)
  return `<section class="comp" id="${c.id}"><header><h3>${esc(c.t)}</h3><span class="onde">${esc(c.onde || '')}</span></header>
${c.nota ? `<p class="nota">${esc(c.nota)}</p>` : ''}<div class="vars">${hoje}${vs}</div>
<textarea class="obs" data-obs="${c.id}" rows="1" placeholder="Observação sobre ${esc(c.t.toLowerCase())} (opcional)" aria-label="Observação sobre ${esc(c.t)}"></textarea></section>`
}

function estado() {
  const sel = {}
  for (const i of document.querySelectorAll('input[data-comp]:checked')) (sel[i.dataset.comp] ||= []).push(i.value)
  const obs = {}
  for (const t of document.querySelectorAll('[data-obs]')) if (t.value.trim()) obs[t.dataset.obs] = t.value.trim()
  return { sel, obs, geral: document.getElementById('geral').value.trim(), tema: document.getElementById('tema').value }
}

function relatorio(e) {
  const rotulo = (c, k) => (k === 'hoje' ? 'manter como está' : `${k} (${c.v['ABC'.indexOf(k)].n})`)
  const out = [`# ${(typeof window !== 'undefined' && window.ONDA12_TITULO) || 'Onda 12 · escolhas do dono'}`, '']
  const faltam = []
  let grupo = ''
  for (const c of window.ONDA12) {
    const ks = e.sel[c.id]
    if (!ks && !e.obs[c.id]) { faltam.push(c.id); continue }
    if (c.g !== grupo) { grupo = c.g; out.push(`## ${grupo}`) }
    out.push(`- ${c.id} · ${c.t}: ${ks ? ks.map((k) => rotulo(c, k)).join(' + ') : 'sem escolha'}${e.obs[c.id] ? ` | obs: ${e.obs[c.id]}` : ''}`)
  }
  out.push('', `Sem escolha (${faltam.length}): ${faltam.join(', ') || 'nenhum'}`)
  if (e.geral) out.push('', '## Observação geral', e.geral)
  return out.join('\n')
}

function salvar() {
  const e = estado()
  try { localStorage.setItem(CHAVE, JSON.stringify(e)) } catch { /* modo privado: segue sem guardar */ }
  const n = Object.keys(e.sel).length
  document.getElementById('cont').textContent = `${n} de ${window.ONDA12.length} componentes decididos`
}

function carregar() {
  let e
  try { e = JSON.parse(localStorage.getItem(CHAVE) || 'null') } catch { e = null }
  if (!e) return
  for (const i of document.querySelectorAll('input[data-comp]')) i.checked = !!e.sel?.[i.dataset.comp]?.includes(i.value)
  for (const t of document.querySelectorAll('[data-obs]')) t.value = e.obs?.[t.dataset.obs] || ''
  document.getElementById('geral').value = e.geral || ''
  if (e.tema) document.getElementById('tema').value = e.tema
}

function aplicarTema() {
  const t = document.getElementById('tema').value
  for (const el of document.querySelectorAll('.term:not([data-fixo])')) el.dataset.tema = t
}

function marcarTudo(k) {
  for (const i of document.querySelectorAll('input[data-comp]')) {
    const tem = document.querySelector(`input[data-comp="${i.dataset.comp}"][value="${k}"]`)
    if (tem) i.checked = i.value === k
  }
  salvar()
}

function gerar() {
  const s = document.getElementById('saida')
  s.value = relatorio(estado())
  document.getElementById('decidir').scrollIntoView()
  s.focus()
  s.select()
}

async function copiar() {
  const s = document.getElementById('saida')
  if (!s.value) gerar()
  let ok = false
  try { await navigator.clipboard.writeText(s.value); ok = true } catch { s.select(); ok = document.execCommand('copy') }
  document.getElementById('aviso').textContent = ok ? 'Copiado. Cole no pi.' : 'Não consegui copiar: selecione o texto e copie.'
}

function baixar() {
  const s = document.getElementById('saida')
  if (!s.value) gerar()
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([s.value], { type: 'text/markdown' })), download: `${CHAVE}.md` })
  a.click()
  URL.revokeObjectURL(a.href)
}

function montar() {
  const grupos = [...new Set(window.ONDA12.map((c) => c.g))]
  const slug = (g) => 'g-' + g.toLowerCase().replace(/[^a-z]+/g, '-')
  document.getElementById('comps').innerHTML = grupos.map((g) =>
    `<h2 id="${slug(g)}">${g}</h2>` + window.ONDA12.filter((c) => c.g === g).map(componente).join('')).join('')
  document.getElementById('grupos').innerHTML = grupos.map((g) => `<a href="#${slug(g)}">${g}</a>`).join('')
  carregar()
  aplicarTema()
  salvar()
  document.addEventListener('input', salvar)
  document.getElementById('tema').addEventListener('change', aplicarTema)
  for (const b of document.querySelectorAll('[data-tudo]')) b.addEventListener('click', () => marcarTudo(b.dataset.tudo))
  document.getElementById('limpar').addEventListener('click', () => {
    if (!confirm('Limpar todas as escolhas e observações desta página?')) return
    localStorage.removeItem(CHAVE)
    location.reload()
  })
  for (const b of document.querySelectorAll('[data-gerar]')) b.addEventListener('click', gerar)
  document.getElementById('copiar').addEventListener('click', copiar)
  document.getElementById('baixar').addEventListener('click', baixar)
}

if (typeof document !== 'undefined') montar()
if (typeof module !== 'undefined') module.exports = { linha, relatorio }
