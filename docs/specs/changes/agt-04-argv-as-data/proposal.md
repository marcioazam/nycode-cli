# Proposta — AGT-04 argv-as-data

Issue filha com `Parent: #70`. Waiver ADR-0038.

## Por que

`bash -c` + texto do modelo falha FR-30. Os refs permitidos ainda usam
string de shell no spawn.

## O que não muda

Confinamento (ADR-0005/0017), AGT-01/03, default `Approver::Never`.

## Rollback

Reverter o schema e `wrap` para `command` + `bash -c`.

## Fora de escopo

Rename para `exec`. Pipelines/globs nesta tool. AGT-05–08.
