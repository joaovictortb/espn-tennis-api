# ESPN Tennis API — Guia de integração para o 0-40

> **Para quem é:** o agente (Claude) e os devs que trabalham no app **0-40** (`zeroQuarentaProd`: Expo + expo-router + React Query + Supabase).
> **O que é:** uma API própria (Node/Fastify) que consome endpoints **não documentados da ESPN** e devolve dados de **tênis profissional (ATP + WTA)** em formato limpo, estável e cacheado.
> **Repositório da API:** `D:\Projetos\2026\younner\espn-tennis-api\espn-tennis-api`
> **Contrato de tipos (fonte da verdade):** `src/domain/types.ts` do repositório da API. Copie esse arquivo para o 0-40 (ex.: `lib/pro-tennis/types.ts`) em vez de reescrever os tipos.
> **Versão:** 2.0.0 · validada contra a ESPN real em 2026-09-30.

---

## 1. Resumo em 30 segundos

- Dados **do circuito profissional** (não dos usuários do 0-40): placares ao vivo, jogos do dia, calendário e chaves de torneios, ranking ATP/WTA (top 150), notícias, perfil e temporada de jogadores.
- Toda resposta `/v1` = `{ data, meta }`. Todo erro = `{ error: { code, message } }`.
- A API já faz cache (15 s a 24 h conforme o recurso) e manda `Cache-Control`. O app **não** deve chamar a ESPN diretamente — sempre passar por esta API.
- Filtro `country=BRA` pronto para "brasileiros no circuito" (o 0-40 lança no Sul do Brasil).
- **Não existe**: placar do game (15/30/40), estatísticas da partida (aces, 1º saque…), H2H, ranking de duplas, ranking além do top 150. Ver §7.

---

## 2. Rodando e URL base

```bash
cd D:\Projetos\2026\younner\espn-tennis-api\espn-tennis-api
npm install
npm run dev     # http://localhost:3333   (Swagger em http://localhost:3333/docs)
```

- **Emulador Android:** `http://10.0.2.2:3333` · **iOS simulator:** `http://localhost:3333` · **aparelho físico:** IP da máquina na rede (`http://192.168.x.x:3333`).
- **Produção:** a API precisa ser hospedada (Render, Railway, Fly.io, VPS…) com `NODE_ENV=production`. Não dá para usar `localhost` no app publicado.
- No 0-40, ler de uma env pública do Expo: `EXPO_PUBLIC_PRO_TENNIS_API_URL`.

Variáveis da API (ver `.env.example`): `PORT`, `DEFAULT_TZ` (padrão `America/Sao_Paulo`), `CORS_ORIGINS`, `ESPN_TIMEOUT_MS`, `ESPN_RETRIES`, `CACHE_MAX_ENTRIES`, `ENABLE_RAW`.

---

## 3. Endpoints

| Endpoint | Para quê | Cache da API |
|---|---|---|
| `GET /v1/matches/live` | Jogos acontecendo agora | 20 s |
| `GET /v1/matches` | Jogos de um dia (padrão: hoje no fuso `tz`) | 30 s (hoje) / 1 h (passado) |
| `GET /v1/matches/:id` | Um jogo | 20 s |
| `GET /v1/tournaments/current` | Torneios rolando agora (sem jogos) | 20 s |
| `GET /v1/tournaments` | Calendário da temporada (sem jogos) | 15 min (ano atual) / 24 h |
| `GET /v1/tournaments/:id` | Torneio + chave completa | 20 s (em andamento) / 15 min |
| `GET /v1/rankings` | Ranking de simples ATP ou WTA (top 150) | 1 h |
| `GET /v1/news` | Notícias ESPN (geral ou de um jogador) | 5 min |
| `GET /v1/players/search?q=` | Buscar jogador pelo nome | 10 min |
| `GET /v1/players/:id` | Perfil + ranking atual + números de carreira | 1–6 h |
| `GET /v1/players/:id/matches` | Jogos da temporada + campanha (V/D, títulos) | 15 min |
| `GET /health` | Status da API | — |
| `GET /v1/raw?url=` | JSON cru da ESPN (só dev, para explorar) | 1 min |

### Parâmetros

| Parâmetro | Onde | Valores |
|---|---|---|
| `tour` | quase todos | `atp`, `wta`, `all` (padrão `all`; rankings: padrão `atp`, sem `all`; players: opcional, detectado automaticamente) |
| `date` | `/matches` | `YYYY-MM-DD` |
| `tz` | `/matches` | fuso IANA, ex. `America/Sao_Paulo` (define a que dia o jogo pertence) |
| `status` | `/matches`, `/tournaments/:id`, `/players/:id/matches` | lista separada por vírgula: `scheduled,live,finished,canceled,postponed,suspended` |
| `category` | `/matches`, `/matches/live`, `/tournaments/:id` | `mens-singles`, `womens-singles`, `mens-doubles`, `womens-doubles`, `mixed-doubles` |
| `country` | `/matches`, `/matches/live`, `/rankings` | código ESPN de 3 letras estilo COI: `BRA`, `ARG`, `GER`, `SUI`… |
| `tournamentId` | `/matches` | id do evento, ex. `959-2026` |
| `playerId` | `/matches`, `/news` | id ESPN do jogador, ex. `3782` |
| `round` | `/tournaments/:id` | nome da rodada: `Round 1`, `Quarterfinal`, `Semifinal`, `Final`… |
| `year` | `/tournaments`, `/players/:id/matches` | ex. `2025` (padrão ano atual) |
| `state` | `/tournaments` | `upcoming`, `in_progress`, `completed` |
| `grandSlam` | `/tournaments` | `true` / `false` |
| `limit` | rankings (≤500), news (≤50), search (≤25), player matches (≤500) | inteiro |

### IDs importantes

- **Jogador:** numérico (`"3623"` = Sinner, `"3782"` = Alcaraz, `"11745"` = João Fonseca). Vem em `competitors[].players[].id`, `rankings.entries[].player.id`, busca.
- **Torneio (evento):** `"<tournamentId>-<ano>"`, ex. `"959-2026"` (China Open 2026), `"154-2026"` (Australian Open 2026).
- **Jogo:** numérico (`"186244"`).
- **Dupla (competitor):** `"id1-id2"`; os jogadores estão em `players[]`.

---

## 4. Formato das respostas (tipos)

Envelope:

```ts
type Ok<T>  = { data: T; meta: { count?: number; cached: boolean; generatedAt: string; tour?: string; date?: string; tz?: string } };
type Err    = { error: { code: "BAD_REQUEST" | "NOT_FOUND" | "UPSTREAM_ERROR" | "UPSTREAM_TIMEOUT" | "INTERNAL_ERROR"; message: string } };
// HTTP: 400 parâmetro inválido · 404 não existe · 502 ESPN falhou · 504 ESPN demorou
```

Tipos principais (resumo de `src/domain/types.ts`):

```ts
type Tour = "atp" | "wta";

interface Country { code: string | null; name: string | null; flagUrl: string | null } // code estilo COI (BRA, SUI, GER)

interface Player {
  id: string; name: string; shortName: string | null;
  country: Country;
  headshotUrl: string | null;   // pode dar 404 em jogador pouco conhecido → usar placeholder
  profileUrl: string | null;    // página na ESPN
}

type MatchState = "scheduled" | "live" | "finished" | "canceled" | "postponed" | "suspended";

interface Match {
  id: string;
  tour: Tour | null;                      // mens-* = atp, womens-* = wta, mixed = null
  tournament: { id: string; name: string };
  category: string; categoryName: string; // "mens-singles" / "Men's Singles"
  round: { id: string | null; name: string | null }; // "Round 1", "Quarterfinal", "Final"...
  startTime: string | null;               // ISO UTC
  timeConfirmed: boolean;                 // false = horário ainda não definido
  status: {
    state: MatchState;
    code: string;                         // STATUS_IN_PROGRESS, STATUS_FINAL, STATUS_RETIRED, STATUS_WALKOVER...
    detail: string | null;                // "2nd Set", "Final", "Retired", "9/30 - 11:00 PM EDT" (inglês)
    currentSet: number | null;
    endedBy: "retired" | "walkover" | null;
  };
  bestOf: number | null;                  // 3 ou 5
  court: string | null; location: string | null;
  summary: string | null;                 // "(1) Carlos Alcaraz (ESP) bt (4) Novak Djokovic (SER) 2-6 6-2 6-3 7-5"
  competitors: Competitor[];              // sempre 2
  winnerId: string | null;
  broadcasts: string[];
}

interface Competitor {
  id: string; kind: "player" | "team";
  name: string; shortName: string | null;
  players: Player[];                      // 1 (simples) ou 2 (duplas)
  seed: number | null;                    // cabeça de chave
  winner: boolean | null;
  serving: boolean | null;                // só com jogo ao vivo
  sets: { set: number; games: number; tiebreak: number | null; won: boolean | null }[]; // won=null = set em andamento
}

interface TournamentSummary {
  id: string; tournamentId: string; name: string; shortName: string | null;
  tours: Tour[]; isGrandSlam: boolean;
  startDate: string | null; endDate: string | null; location: string | null;
  state: "upcoming" | "in_progress" | "completed";
  categories: { slug: string; name: string; matchCount: number }[];
  previousWinners: { category: string; name: string; playerIds: string[] }[]; // campeões da edição anterior
  bracketUrl: string | null;
}
interface TournamentDetail extends TournamentSummary { matches: Match[] }

interface Rankings {
  tour: Tour; name: string; updatedAt: string | null;
  entries: {
    rank: number; previousRank: number | null;
    movement: number | null;              // positivo = subiu
    points: number | null;
    player: Player & { firstName: string | null; lastName: string | null; age: number | null; birthPlace: string | null };
  }[];
}

interface NewsArticle {
  id: string; headline: string; description: string | null;
  publishedAt: string | null; updatedAt: string | null;
  url: string | null;                     // abrir no navegador (conteúdo é da ESPN, em inglês)
  image: { url: string; alt: string | null; width: number | null; height: number | null; credit: string | null } | null;
  byline: string | null; premium: boolean;
  tours: Tour[]; players: { id: string; name: string }[];
}

interface PlayerSearchResult { id: string; name: string; tour: Tour | null; headshotUrl: string | null; profileUrl: string | null }

interface PlayerProfile extends Player {
  firstName: string | null; lastName: string | null; tour: Tour;
  birthDate: string | null; age: number | null; birthPlace: string | null;
  heightCm: number | null; heightDisplay: string | null;   // display vem em pés/polegadas
  weightKg: number | null; weightDisplay: string | null;   // display vem em lbs
  hand: "right" | "left" | null; turnedPro: number | null; active: boolean | null;
  ranking: { rank: number; points: number | null; previousRank: number | null; updatedAt: string | null } | null; // null se fora do top 150
  career: { singlesWon: number | null; singlesLost: number | null; singlesTitles: number | null; doublesTitles: number | null; prizeMoneyUsd: number | null };
}

interface PlayerSeason {
  playerId: string; tour: Tour; year: number;
  record: { singles: { wins: number; losses: number; titles: number }; doubles: { wins: number; losses: number; titles: number } };
  matches: Match[];                       // mais recente primeiro
}
```

---

## 5. Exemplos reais (2026-09-30)

**Jogo ao vivo** — `GET /v1/matches/live` → `data[0]` (resumido):

```json
{
  "id": "184163", "tour": "wta",
  "tournament": { "id": "1028-2026", "name": "Jingshan Tennis Open" },
  "category": "womens-doubles", "categoryName": "Women's Doubles",
  "round": { "id": "1", "name": "Round 1" },
  "startTime": "2026-09-30T10:55:00.000Z", "timeConfirmed": true,
  "status": { "state": "live", "code": "STATUS_IN_PROGRESS", "detail": "2nd Set", "currentSet": 2, "endedBy": null },
  "bestOf": 3, "court": "Court 3", "location": "Jingshan, China PR",
  "summary": "(3) Eri Hozumi (JPN) & Sara Sorribes Tormo (ESP) leads Yujia Huang (CHN) & Natsumi Kawaguchi (JPN) 6-4 4-1",
  "competitors": [
    {
      "id": "2050-2929", "kind": "team", "name": "Eri Hozumi / Sara Sorribes Tormo", "seed": 3,
      "winner": null, "serving": true,
      "players": [{ "id": "2050", "name": "Eri Hozumi", "country": { "code": "JPN", "name": "Japan", "flagUrl": "https://a.espncdn.com/i/teamlogos/countries/500/jpn.png" }, "headshotUrl": "https://a.espncdn.com/i/headshots/tennis/players/full/2050.png" }],
      "sets": [{ "set": 1, "games": 6, "tiebreak": null, "won": true }, { "set": 2, "games": 4, "tiebreak": null, "won": null }]
    },
    { "id": "17165-13531", "kind": "team", "name": "Yujia Huang / Natsumi Kawaguchi", "serving": false, "sets": [{ "set": 1, "games": 4, "won": false }, { "set": 2, "games": 1, "won": null }] }
  ],
  "winnerId": null, "broadcasts": []
}
```

**Ranking** — `GET /v1/rankings?tour=atp&country=BRA`:

```json
{ "data": { "tour": "atp", "name": "ATP", "updatedAt": "2026-09-24T07:00:00.000Z", "entries": [
  { "rank": 29, "previousRank": 28, "movement": -1, "points": 1750,
    "player": { "id": "11745", "name": "Joao Fonseca", "country": { "code": "BRA", "name": "Brazil" }, "age": 20, "birthPlace": "Rio de janeiro",
                "headshotUrl": "https://a.espncdn.com/i/headshots/tennis/players/full/11745.png" } },
  { "rank": 122, "player": { "id": "10064", "name": "Gustavo Heide" } },
  { "rank": 136, "player": { "id": "3345", "name": "Thiago Seyboth Wild" } }
] } }
```

**Perfil** — `GET /v1/players/3623`:

```json
{ "id": "3623", "name": "Jannik Sinner", "tour": "atp",
  "country": { "code": "ITA", "name": "Italy", "flagUrl": "https://a.espncdn.com/i/teamlogos/countries/500/ita.png" },
  "birthDate": "2001-08-16", "age": 25, "birthPlace": "San Candido, Italy",
  "heightCm": 190.5, "weightKg": 77.1, "hand": "right", "turnedPro": 2018, "active": true,
  "ranking": { "rank": 1, "points": 11000, "previousRank": 1, "updatedAt": "2026-09-24T07:00:00.000Z" },
  "career": { "singlesWon": 365, "singlesLost": 89, "singlesTitles": 30, "doublesTitles": 1, "prizeMoneyUsd": 69542463 } }
```

**Temporada** — `GET /v1/players/3782/matches?limit=3` → `record`: `{ "singles": { "wins": 26, "losses": 4, "titles": 2 }, "doubles": { "wins": 1, "losses": 1, "titles": 0 } }` + `matches[]` (mesmo formato de `Match`).

**Torneio** — `GET /v1/tournaments?grandSlam=true` → 4 Slams com `tours: ["atp","wta"]`, `categories` (simples, duplas, mistas) e `previousWinners`.

---

## 6. O que dá para construir no 0-40

O 0-40 é social/amador (jogar, grupos, quadras, professores, ranking de **atividade**). Dados do circuito profissional entram como **conteúdo de engajamento** — nunca misturar com o ranking interno do app.

| Ideia | Endpoint(s) | Observação |
|---|---|---|
| Aba/Card **"Circuito ao vivo"** na home | `/v1/matches/live` | Polling 20–30 s só com a tela em foco |
| **"Brasileiros hoje"** (Fonseca & cia.) | `/v1/matches?country=BRA`, `/v1/matches/live?country=BRA` | Gancho forte para o público do Sul do Brasil |
| **Widget de ranking** ATP/WTA + "brasileiros no top 150" | `/v1/rankings?tour=atp&limit=10`, `?country=BRA` | Seta ↑↓ com `movement` |
| **Agenda de torneios / Grand Slams** | `/v1/tournaments?state=upcoming`, `?grandSlam=true` | Ex.: banner "Faltam X dias para Roland Garros" |
| **Tela de torneio** com chave por rodada | `/v1/tournaments/:id?category=mens-singles` | Agrupar `matches` por `round.name` |
| **Card do jogador pro** (ídolo) | `/v1/players/:id`, `/v1/players/:id/matches` | Ex.: no perfil do usuário, "Meu ídolo: Alcaraz" com ranking e últimos resultados |
| **Feed de notícias** | `/v1/news?limit=10`, `/v1/news?playerId=...` | Conteúdo em inglês; abrir `url` com `expo-web-browser` |
| **Busca de ídolo** no onboarding/perfil | `/v1/players/search?q=` | Guardar só o `id` ESPN no Supabase |
| **Notificação "seu ídolo entra em quadra"** | `/v1/matches?playerId=...` | Fazer no backend (Edge Function/cron), não no app |

Sugestões de produto (validar com o time antes):
- Salvar `favorite_pro_player_id` (id ESPN) no perfil do usuário no Supabase — a API resolve o resto.
- Mostrar o placar do jogo pro no mesmo componente visual do placar amador do 0-40 (sets/games), reaproveitando o design system.

---

## 7. Limitações (importante)

1. **Sem placar do game** (0/15/30/40/AD). Só games por set, tie-break, quem saca e o número do set atual.
2. **Sem estatísticas da partida** (aces, duplas faltas, % de saque, break points). A ESPN não expõe para tênis.
3. **Sem H2H**, sem ranking de duplas, sem ranking além do top 150 (quem estiver fora tem `ranking: null`).
4. **Textos da ESPN em inglês**: `status.detail`, `categoryName`, `round.name`, `summary`, notícias. Para PT/ES, traduzir no app usando os campos estruturados (`status.state`, `category`, `round.name` como chave de tradução).
5. **Código de país estilo COI**, não ISO: `SUI` (Suíça), `GER` (Alemanha), `SER` (Sérvia), `ROM` (Romênia), `TPO` (Taipé). Usar `flagUrl` para a bandeira em vez de mapear código.
6. **`headshotUrl`** pode dar 404 para jogadores de ranking baixo → `expo-image` com `placeholder`.
7. **Recorde da temporada** (`record`) é calculado pela API a partir dos jogos que a ESPN lista (W.O. não conta). Pode divergir levemente do site oficial ATP/WTA.
8. **Sem tempo real por push**: é polling. A API segura carga com cache, mas não faça polling < 15 s.
9. **Fonte não oficial**: endpoints internos da ESPN podem mudar sem aviso. `npm run smoke` na API detecta quebra. Uso comercial/redistribuição dos dados exige checar os termos da ESPN — decisão do time (André/Nico) antes de ir para produção.

---

## 8. Como consumir no 0-40 (React Query)

Ponto de partida sugerido — adaptar às convenções do repo (`lib/`, hooks existentes, i18n):

```ts
// lib/pro-tennis/client.ts
import type { Match, Rankings, PlayerProfile, NewsArticle, TournamentSummary, TournamentDetail, PlayerSeason } from "./types"; // copiado de src/domain/types.ts

const BASE = process.env.EXPO_PUBLIC_PRO_TENNIS_API_URL!;

export class ProTennisError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

async function get<T>(path: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<T> {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  const res = await fetch(`${BASE}${path}${qs ? `?${qs}` : ""}`);
  const body = await res.json();
  if (!res.ok) throw new ProTennisError(res.status, body?.error?.code ?? "UNKNOWN", body?.error?.message ?? res.statusText);
  return body.data as T;
}

export const proTennis = {
  live: (p?: { tour?: "atp" | "wta" | "all"; country?: string }) => get<Match[]>("/v1/matches/live", p),
  matchesOfDay: (p?: { date?: string; tz?: string; tour?: string; status?: string; country?: string; playerId?: string }) => get<Match[]>("/v1/matches", p),
  match: (id: string) => get<Match>(`/v1/matches/${id}`),
  currentTournaments: (tour = "all") => get<TournamentSummary[]>("/v1/tournaments/current", { tour }),
  season: (p?: { tour?: string; year?: number; state?: string; grandSlam?: boolean }) => get<TournamentSummary[]>("/v1/tournaments", p),
  tournament: (id: string, p?: { category?: string; round?: string }) => get<TournamentDetail>(`/v1/tournaments/${id}`, p),
  rankings: (tour: "atp" | "wta", p?: { limit?: number; country?: string }) => get<Rankings>("/v1/rankings", { tour, ...p }),
  news: (p?: { tour?: string; limit?: number; playerId?: string }) => get<NewsArticle[]>("/v1/news", p),
  searchPlayers: (q: string) => get<{ id: string; name: string; tour: "atp" | "wta" | null; headshotUrl: string | null }[]>("/v1/players/search", { q }),
  player: (id: string) => get<PlayerProfile>(`/v1/players/${id}`),
  playerSeason: (id: string, p?: { year?: number; limit?: number }) => get<PlayerSeason>(`/v1/players/${id}/matches`, p),
};
```

```ts
// hooks/useProTennis.ts
import { useQuery } from "@tanstack/react-query";
import { proTennis } from "@/lib/pro-tennis/client";

export const useLiveProMatches = (country?: string) =>
  useQuery({ queryKey: ["pro", "live", country], queryFn: () => proTennis.live({ country }), refetchInterval: 30_000, staleTime: 15_000 });

export const useProRankings = (tour: "atp" | "wta", country?: string) =>
  useQuery({ queryKey: ["pro", "rankings", tour, country], queryFn: () => proTennis.rankings(tour, { limit: 20, country }), staleTime: 60 * 60_000 });

export const useProPlayer = (id?: string) =>
  useQuery({ queryKey: ["pro", "player", id], queryFn: () => proTennis.player(id!), enabled: !!id, staleTime: 60 * 60_000 });
```

`staleTime` recomendado (alinhado ao cache da API): ao vivo 15 s · jogos do dia 30 s · torneios 5 min · ranking 1 h · notícias 5 min · perfil 1 h. Pausar `refetchInterval` quando a tela perde foco (`useFocusEffect` / `AppState`).

Renderização de placar:

```ts
// "6-4 4-1" a partir de um competitor
const score = (c: Competitor) => c.sets.map((s) => (s.tiebreak !== null ? `${s.games}(${s.tiebreak})` : `${s.games}`)).join(" ");
// Badge: status.state === "live" → "AO VIVO • Set {currentSet}"; endedBy === "retired" → "Desistência"; "walkover" → "W.O."
```

---

## 9. Checklist para o agente do 0-40

- [ ] Copiar `src/domain/types.ts` da API para o 0-40; não redefinir tipos à mão.
- [ ] Criar `EXPO_PUBLIC_PRO_TENNIS_API_URL` e o client acima.
- [ ] Nunca chamar `*.espn.com` direto do app.
- [ ] Tratar `ProTennisError` (404 → "não encontrado"; 502/504 → "dados do circuito indisponíveis", com retry).
- [ ] Traduzir labels via campos estruturados (`status.state`, `category`, `round.name`) nos 3 idiomas do app.
- [ ] Placeholder para `headshotUrl`.
- [ ] Deixar claro na UI que é conteúdo do circuito profissional (fonte: ESPN) e separado do ranking de atividade do 0-40.
- [ ] Antes de produção: hospedar a API e validar com o time a questão de termos de uso da ESPN.
