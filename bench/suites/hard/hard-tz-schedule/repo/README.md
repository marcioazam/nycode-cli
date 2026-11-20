# tzsched

Agendador de séries recorrentes (somente biblioteca padrão, `zoneinfo`) com relatório semanal no fuso de
quem visualiza.

- `tzsched/model`: séries, ocorrências, calendário, participantes.
- `tzsched/tz`: fusos, normalização de horário local → UTC, janelas de semana.
- `tzsched/recur`: expansão de recorrências e limites (contagem, data final).
- `tzsched/report`: relatório semanal, conflitos, totais e texto.
- `tzsched/io`: leitura de registros.

As regras estão em `docs/SPEC.md`. Testes: `python3 -m pytest -q tests`.
