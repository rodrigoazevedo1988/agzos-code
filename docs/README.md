# Documentação — Agzos Code

| Pasta | Conteúdo |
|---|---|
| [`produto/`](produto/) | [PRD](produto/PRD.md): visão, escopo do MVP, features, métricas |
| [`decisoes/`](decisoes/) | ADRs (Architecture Decision Records). [ADR-0001](decisoes/ADR-0001-base-do-editor.md): base do editor |
| [`tecnico/`](tecnico/) | [Arquitetura](tecnico/arquitetura.md) e [Troubleshooting](tecnico/troubleshooting.md) |
| [`plano/`](plano/) | [Roadmap](plano/ROADMAP.md) com fases, checklists e critérios de saída |

Identidade visual (logos SVG/PNG/PDF) fica em [`../logos/`](../logos/).

## Convenções

- Novo ADR: `decisoes/ADR-NNNN-titulo-curto.md`, com Status, Contexto, Opções, Decisão e Consequências.
- Bug com causa não óbvia: registrar sintoma, causa e correção em `tecnico/troubleshooting.md`.
- Ao concluir item do roadmap: marcar `[x]` no `plano/ROADMAP.md` no mesmo PR.
