# Serviços públicos sem conta (/mobile, /ios, /android, /stickers, /upgrade)

Estado: implementado em `extensions/claude-compat/services/` (`public.ts`, `mobile-qr.ts`); **registro ainda não ligado** ao `index.ts`, matriz ou UI (cabe ao integrador: `import { registerPublicServices } from './services/public.ts'`). Não implementa serviços que dependem de conta, token ou sessão Claude; isso segue bloqueado em `work.md`.

## Contrato
- `/mobile`, `/ios`, `/android`: overlay com o QR de exatamente `https://claude.ai/mobile` (fonte: https://code.claude.com/docs/en/mobile.md). Enter, Esc ou `q` fecham. Sem UI: notificação com QR + link. Falha do overlay: aviso e notificação.
- QR em meios-blocos (00 espaço, 10 ▀, 01 ▄, 11 █), 17 linhas x 33 colunas, quiet zone de 4 módulos preservada, preto sobre branco (`ESC[30;47m`). Largura < 33: o painel não corta o QR; mostra aviso e o link em linhas que cabem.
- `/stickers`: informa que todos os pacotes de stickers já foram resgatados (changelog v2.1.323, https://code.claude.com/docs/en/changelog.md). Sem navegador.
- `/upgrade`: abre `https://claude.ai/upgrade` (base citada no changelog oficial 0.2.96 e nos links de https://claude.com/pricing). Comando fixo sem shell (`xdg-open`, `open`, `rundll32 url.dll,FileProtocolHandler`), timeout 5 s, uma tentativa só. Falha ou resposta ambígua (timeout) imprime a URL e não repete. Sem UI só imprime a URL. Nenhuma compra, login ou leitura de token.
- Qualquer argumento é recusado (`/<nome> não aceita argumentos.`); nenhuma chamada de modelo.

## Origem do QR
- Gerado por https://api.qrserver.com/v1/create-qr-code/?data=https%3A%2F%2Fclaude.ai%2Fmobile&format=svg&size=250x250&ecc=M&qzone=4 (API: https://goqr.me/api/doc/create-qr-code/), baixado pelo orquestrador em `/tmp/pi-claude-parity-assets/mobile.svg`, 8894 bytes, SHA-256 `47c49b53132ccfe9a027bec26d38d4102ff0716686415897bcfae534e50a7c7a`.
- O SVG foi tratado só como dado: viewBox 33x33, 344 células pretas `M x,y l 1,0 0,1 -1,0 z` copiadas como 33 linhas binárias em `MOBILE_ROWS`. Nenhum SVG nem rede em runtime.

## Verificação independente
`services/test/qr-decode.ts` (só teste) decodifica o perfil fixo QR v2-M sem usar o gerador: recorta a quiet zone, reserva padrões de função, lê as duas cópias da informação de formato (XOR 0x5412, BCH 0x537, nível M, máscara), desfaz a máscara, lê 359 bits em colunas duplas, confere as 16 síndromes Reed-Solomon (GF(256) 0x11d, raízes α^0..α^15) e decodifica o modo byte UTF-8. Resultado observado: `https://claude.ai/mobile`. Testes de mutação cobrem forma, quiet zone, formato, nível EC, BCH, paridade e payload, e o texto renderizado em meios-blocos é decodificado de volta.

Limite: **não** houve decodificação por ZXing externo (GET 411 e POST 400 falharam) nem por outro decodificador instalado; a prova é o decodificador de teste acima.

## Testes
`node --experimental-strip-types --test extensions/claude-compat/services/test/mobile-qr.test.ts extensions/claude-compat/services/test/public.test.ts` (UI e opener falsos; sem rede, navegador ou credenciais). Rodado uma vez ao final do trabalho no arquivo próprio: 20 passam. Cobertura e gate completo ficam com o runner final.
