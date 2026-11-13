// Testes de ~/.pi/agent/extensions/sound-notify/index.ts. Rodar: node --experimental-strip-types --test <este arquivo>
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { playerCommand } from '../../../extensions/sound-notify/index.ts'

test('ordem: canberra, depois pw-play com o som, senão nenhum (bell)', () => {
  assert.equal(playerCommand((b) => b === 'canberra-gtk-play', true)?.[0], 'canberra-gtk-play')
  assert.deepEqual(playerCommand((b) => b === 'pw-play', true), ['pw-play', '/usr/share/sounds/freedesktop/stereo/complete.oga'])
  assert.equal(playerCommand((b) => b === 'pw-play', false), undefined)
  assert.equal(playerCommand(() => false, true), undefined)
})
