// Ambiente compartilhado dos testes da frota: uma única cópia do pacote pi-code, para a cobertura juntar os arquivos de teste.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { after } from 'node:test'

// O Node não tira tipos de .ts dentro de node_modules: testa uma cópia do pacote, com o pi ao lado.
// Com FLEET_TEST_PKG (o gate), usa a cópia dele sem tocar; o dono dela a apaga.
export function fleetTestEnv(prefix: string): { tmp: string; ext: string } {
  const home = homedir() // antes de qualquer teste trocar o HOME
  const tmp = mkdtempSync(join(tmpdir(), prefix))
  // fleetRoot() segue os.tmpdir(): as raízes que o teste cria e varre ficam longe da raiz das sessões vivas.
  process.env.TMPDIR = join(tmp, 'os-tmp')
  mkdirSync(process.env.TMPDIR)
  const shared = process.env.FLEET_TEST_PKG
  if (shared) {
    after(() => rmSync(tmp, { recursive: true }))
    return { tmp, ext: join(shared, 'extensions') }
  }
  const ext = join(tmp, 'extensions')
  cpSync(`${home}/.pi/agent/npm/node_modules/pi-code/extensions`, ext, { recursive: true })
  symlinkSync(`${home}/.pi/agent/install/releases/${readFileSync(`${home}/.pi/agent/install/current-version`, 'utf8').trim()}/node_modules`, join(tmp, 'node_modules'))
  // Com cobertura, o runner lê as fontes da cópia depois que este processo sai: a cópia fica e o gate apaga o TMPDIR dele.
  after(() => process.env.NODE_V8_COVERAGE || rmSync(tmp, { recursive: true }))
  return { tmp, ext }
}
