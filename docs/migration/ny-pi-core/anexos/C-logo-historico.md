<!-- Anexo C: levantamento bruto de 2026-11-20 do logo do nycode no histórico git. -->
# Logo do nycode no histórico git

Repo: /home/marcio/source/nycode-cli. Remoção: c410d670e (2026-11-20). Pai: **9ea437bf7**.

## (a) Assets (únicos nycode; nenhum PNG jamais existiu)
| caminho | último commit | bytes | dimensões | sha256 do blob |
|---|---|---|---|---|
| docs/assets/nycode-pixel.svg | 9ea437bf7 | 7000 | viewBox 0 0 168 52, width 1344 height 416, sem fundo preto | 7269f242f8f7c6dca765f8a780cf72f3a0d471a40e41e2524fc7f705328a9dd2 |
| docs/assets/nycode-wordmark-ansi.txt | 9ea437bf7 | 53176 | texto ANSI truecolor (meio-bloco), p/ terminal | 22201bcbda73ca8176350bc818ebea4fc70400f3572c507383decf19e836613f |

Histórico do SVG: 6ac81de56/7fd0b5979 (14/08, add, 7044 B, blob 96908d15..., com retângulo preto); 37ec21742 / c98e9a0dd / 19d7039e0 (15/08, remove fundo preto, 7000 B, blob 95594d45...). ANSI: 7d5045607/117bc081c (#29).
logo/pi_logo_*.png/svg e packages/chord/.../logo.svg são do projeto pi/chord, NÃO do nycode.

## (b) README
Em 9ea437bf7 (topo):
```html
<p align="center">
  <img src="docs/assets/nycode-pixel.svg" alt="nycode" width="480">
</p>
```
Branch origin/docs/readme-transparent-png-wordmark (tip 37ec21742): mesmo bloco <img> do SVG + comentário HTML apontando para nycode-wordmark-ansi.txt. Apesar do nome, NÃO tem PNG. merge-base com main = 117bc081c; diff --stat: 1 arquivo, docs/assets/nycode-pixel.svg, 1 deleção (o retângulo de fundo).

## (c) Versão final
SVG transparente (sem retângulo preto), blob 95594d45..., idêntico no tip da branch e em 9ea437bf7. A branch não é ancestral de main por SHA (is-ancestor falso), mas o conteúdo entrou via squash #30 (c98e9a0dd/19d7039e0). Fonte final: SVG + ANSI txt.

## (d) Restauração
```
git -C /home/marcio/source/nycode-cli show 9ea437bf7:docs/assets/nycode-pixel.svg > DEST/nycode-pixel.svg
git -C /home/marcio/source/nycode-cli show 9ea437bf7:docs/assets/nycode-wordmark-ansi.txt > DEST/nycode-wordmark-ansi.txt
```
sha256: pixel.svg 7269f242f8f7c6dca765f8a780cf72f3a0d471a40e41e2524fc7f705328a9dd2; ansi 22201bcbda73ca8176350bc818ebea4fc70400f3572c507383decf19e836613f
Versão antiga com fundo preto: git show 6ac81de56:docs/assets/nycode-pixel.svg (sha256 596a1b1a5991ff83be3e12e7ccd5e91d835339cf8efedd34c48f42cf4352c55f  -)
