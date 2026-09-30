Anexei o arquivo `INTEGRACAO-040.md`. Ele documenta uma API nossa, a **ESPN Tennis API**, que entrega dados do **tênis profissional (ATP + WTA)** já normalizados e com cache: jogos ao vivo e do dia, calendário e chaves de torneios, ranking top 150, notícias, perfil e temporada de jogadores, e o filtro `country=BRA` para brasileiros no circuito.

Contexto:
- A API é um projeto separado, em `D:\Projetos\2026\younner\espn-tennis-api\espn-tennis-api` (Node + Fastify). Em dev ela roda em `http://localhost:3333`, com Swagger em `/docs`.
- O contrato de tipos oficial é o `src/domain/types.ts` desse repositório.
- Esses são dados do circuito **profissional**. Não têm relação com o ranking de atividade do 0-40 e não podem se misturar com ele.

O que eu quero agora:
1. Leia o `INTEGRACAO-040.md` inteiro e o código do 0-40 que for relevante: estrutura de `lib/` e `hooks/`, como o React Query está configurado, i18n, design system e as telas da home e do perfil.
2. Me devolva um **plano**, sem código ainda, com:
   - onde essa API faz sentido no produto, usando as ideias da seção 6 do documento como ponto de partida e mais o que você enxergar com o contexto do app (docs em `zeroquarenta-memo`);
   - quais telas e componentes mudam ou são criados, e quais endpoints cada um usa;
   - como encaixar no padrão do repo: client, hooks, tipos copiados de `types.ts`, env `EXPO_PUBLIC_PRO_TENNIS_API_URL`, tradução PT/EN/ES dos rótulos que a API devolve em inglês;
   - se precisa guardar algo no Supabase (ex.: `favorite_pro_player_id`) e qual seria a migration;
   - riscos e limitações (seção 7 do documento: sem placar 15/30/40, sem estatísticas, headshot pode dar 404, termos de uso da ESPN, necessidade de hospedar a API).
3. Não implemente nada antes de eu aprovar o plano.
