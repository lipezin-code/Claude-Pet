# Claude Pet

Pet flutuante para Windows 11 que acompanha o **Claude Code** em tempo real: pensando, usando ferramenta, pedindo aprovação, concluído, erro. Projeto independente, não afiliado à Anthropic.

Stack: Electron 45 · React 19 · TypeScript · electron-vite · electron-builder (NSIS). CSS próprio e animações SVG/CSS (sem Tailwind/Framer: o mascote é pixel-art vetorial, não justificava as dependências). Persistência em JSON atômico (sem SQLite nativo: evita compilar módulo nativo no Windows).

## Instalar e usar

**Instalador:** baixe `Claude Pet Setup <versão>.exe` em **[Releases](../../releases/latest)** (ou gere com `npm run dist`, sai em `release/`). Instala por usuário (sem admin), cria atalho no menu Iniciar e na área de trabalho, pergunta (só no modo interativo) se deve integrar com o Claude Code e se deve iniciar com o Windows. Desinstalar remove atalhos e **remove só os hooks do Claude Pet** do `settings.json`. **Atualizar** (instalar uma versão nova por cima) não remove hooks, ponte da status line nem o início automático (a partir da 1.1.0; o desinstalador da 1.0.0 removia, então ao sair da 1.0.0 reinstale a integração em Configurações › Claude Code).

> **SmartScreen:** o instalador não tem assinatura digital, então o Windows pode mostrar "O Windows protegeu o computador". Clique em *Mais informações → Executar assim mesmo*. Assinar exige um certificado de code signing pago.

**Primeiro uso**
1. Abra o Claude Pet (o mascote aparece no canto inferior direito; ícone na bandeja).
2. Clique com o botão direito → **Configurações → Claude Code → Instalar integração** (se não aceitou no instalador).
3. **Reinicie as sessões do Claude Code já abertas**: o Claude Code lê os hooks ao iniciar. Sessões abertas antes disso aparecem como "Aguardando eventos" (`?` sobre o mascote), sem inventar atividade.

**Controles:** clique = abre/fecha o mini chat · arrastar = move · botão direito = menu · duplo clique = ação configurável (padrão: abrir Claude Code) · clicar fora do chat o fecha.

**Desenvolvimento:** `npm i` · `node node_modules/electron/install.js` (se o binário do Electron não baixar) · `npm run dev` · `npm test` · `npm run typecheck` · `node scripts/make-icons.mjs` (regenera ícones).

## Mascote: comportamento visual

| Situação | O que o pet faz |
|---|---|
| IDLE | Olha para frente/esquerda/direita em intervalos aleatórios de 1,5 a 4 s. A cada 45 a 120 s (nunca duas demos em menos de 45 s) pega o notebook, digita ~3 s, mostra "?" ~3 s, guarda e volta a olhar ao redor |
| THINKING / WORKING / ferramenta | Vira 3/4 para a esquerda e digita continuamente no notebook, que fica de perfil ao seu lado (engrenagem quando há ferramenta). **Entre ferramentas (PostToolUse) continua digitando, sem "?"** |
| Stop (COMPLETED) | Para de digitar, comemora e mostra um **"!" verde** por 3 s. Só aparece quando a sessão exibida entra em COMPLETED; se outra sessão ainda trabalha, a política mantém o pet digitando |
| WAITING_PERMISSION | **Placa âmbar** com "!" balançando (forma e cor diferentes do "!" verde de conclusão) |
| UNKNOWN | Olha ao redor e alterna "?" (3 s) e digitar (3 s) |
| ERROR / DISCONNECTED | Como antes |
| IDLE por 5 min | Dorme (sem timers decorativos) |
| Hover / arraste | Como antes; cancelam a demo na hora |

Pose com notebook (pegar, digitar, segurar, guardar): grade própria `BODY_SIDE` em `src/shared/sprites.ts` (face frontal + face lateral na cor de sombra; como de frente, os braços somem e as duas mãos alternam subindo e descendo no teclado). Notebook de perfil à frente (à esquerda) do pet, exatamente no desenho de referência do usuário (10×6 pixels): tampa de 3 tons (borda escura, face clara, tela ciano) em diagonal até a dobradiça e teclado de 2 linhas (topo claro, base escura) que termina onde o corpo começa. Para caber inteiro, a janela do pet tem 5 colunas extras à esquerda (`LAPTOP_PAD`; 126×120 a 100%); essa faixa é transparente a cliques, e a posição salva continua sendo a do quadro do pet; sem notebook o pet é o de frente de sempre. Tudo isso é decorativo e vive só no renderer (`src/renderer/mascot/`): o controlador puro não gasta IPC nem altera estado real. Tempos em **um arquivo**: `src/renderer/mascot/timings.ts`. "Reduzir movimento"/animações desligadas: sem olhares, sem demo; trabalhando vira notebook estático. Sem respiração contínua (CPU ~0 em IDLE; só o piscar). A janela do pet usa múltiplos de 1/6 (50, 67, 83, 100... 200 %) para o pixel ficar nítido.

QA visual sem tocar no desktop: `npm run preview:ui` e abrir `http://localhost:5199/#preview` (todos os estados em 50/100/200 %) ou `/?w=chat|sessions|settings|menu&theme=light#preview-ui` (janelas com `window.pet` simulado).

## Skins do mascote

9 skins: **Clássico** (idêntico ao mascote original, pixel a pixel), **Azul** (a antiga "Gotinha": quem a usava migra sozinho), Roxo, Verde, Rosa, Dark, Branco, Dourado e Vermelho (substituiu o Arco-Íris; quem o usava migra sozinho). Escolha em **Configurações > Aparência** (galeria; setas do teclado também trocam) ou no menu de contexto **Alterar mascote**. A escolha fica em `skinId` no `settings.json`; valor inválido ou adulterado volta ao Clássico (com log, sem o valor).

**Como funciona.** O mascote é SVG pixelado (um `<rect>` por pixel da grade em `src/shared/sprites.ts`). Uma skin **não tem imagens**: é só uma paleta aplicada aos mesmos pixels, então a forma é sempre a mesma e trocar de skin é instantâneo, sem piscar e sem reiniciar as animações. Os manifestos ficam em `skins/<id>/skin.json`, vão para `resources/skins` no instalador, e são validados no processo principal como não confiáveis (schema estrito, id = nome da pasta, até 8 KB, até 32 skins). Skin inválida é ignorada com log; o Clássico também está embutido no código, então o app abre mesmo sem a pasta. O renderer só recebe cores e flags, nunca caminhos.

```json
{
  "schemaVersion": 1, "id": "azul", "name": "Azul",
  "palette": { "body": "#7c9cff", "shade": "#5570c9", "eye": "#10142a", "cheek": "#ffb4d1", "accent": "#ffd166" },
  "bodyRows": ["…13 cores, opcional: degradê por linha da grade…"],
  "flags": { "outline": false, "eyeGlow": false, "animatedColor": false }
}
```

`body` corpo · `shade` faixa de sombra · `eye` olhos/boca/sobrancelhas · `cheek` bochechas (hover) · `accent` brilhos e engrenagem. Flags: `outline` = contorno 1px semitransparente fora do corpo (Branco, p/ não sumir em fundo claro); `eyeGlow` = brilho nos olhos (Dark); `animatedColor` = ciclo de matiz no corpo. "?", "!" e placa de permissão são iguais em todas as skins, sem contorno.

**Adicionar uma skin**
1. Acrescente uma linha em `SKINS` em `scripts/generate-skins.mjs` (id `^[a-z0-9-]{1,32}$`, nome, cor base; opcionalmente `eye`, `cheek`, `rows`, `flags`) e, se quiser posição fixa na galeria, o id em `ORDER` (`src/shared/skins.ts`).
2. `npm run gen:skins`: deriva sombra/olho/bochecha mantendo a mesma relação de luminosidade (OKLCH) que o Clássico tem entre seus tons e atualiza `docs/skins-contrast.md` (relatório informativo de contraste).
3. `npm test` (valida manifestos, forma idêntica em 3240 poses, contraste) e `npm run preview:skins` → confira `docs/skins-preview.png` (todas as skins nos estados-chave, fundo escuro e claro).
4. O teste "todas válidas" lista os ids esperados: inclua o novo id lá.

**Limitações.** Sem skins de terceiros nem importação de pasta do usuário (só as que vêm no app). Sem acessórios ainda (`schemaVersion` existe para uma v2 com camadas). A cor de destaque da UI não muda com a skin. O contorno de `outline` na ponta dos braços cai fora da janela de 16 colunas e fica cortado. O ciclo de matiz (`animatedColor`) foi medido em ~2× o CPU do pet parado (6,4–7,0 vs ~3,0 s de CPU por minuto, e liga o processo de GPU), então nenhuma skin o usa. Elementos fixos ("?", "!", Zs) ficam pálidos sobre fundo de área de trabalho claro, como já era no mascote original; em skins de cor parecida (Verde, Dourado) o "?"/"!" se destaca menos do corpo durante o pulinho. O Dark não tem contorno: pode sumir em fundo muito escuro.

Teste de instância isolada (não toca no pet real, nos hooks nem em `%APPDATA%\ClaudePet`): defina `CLAUDE_PET_DATA_DIR=<pasta temporária>` antes de abrir o app.

## UI

Tokens em `src/renderer/tokens.css` (acento = laranja do mascote, cores de estado, raios, sombras, tema claro), componentes em `src/renderer/ui/`, fonte Inter empacotada localmente (sem CDN). O menu de contexto agora é uma janela própria no mesmo estilo; se ela não responder em 2,5 s, cai no menu nativo. Fundo das janelas é sólido: `backdrop-filter` **não borra o que está atrás** em janela Electron transparente (testado), então não é usado.

## Como funciona o monitoramento

```
Claude Code ──hook (async, exit 0)──► claude-pet-hook.cjs ──HTTP 127.0.0.1:<porta aleatória> + Bearer──► app
                                                                                   │
~/.claude/sessions/<pid>.json (somente leitura) ──► descoberta de sessões abertas ─┤
                                                                                   ▼
                                                      SessionManager → máquina de estados → pet/chat/notificações
```

- **Hooks:** 14 eventos (SessionStart/End, UserPromptSubmit, Pre/PostToolUse, PostToolUseFailure, PermissionRequest, Notification, Stop, StopFailure, SubagentStart/Stop, TaskCreated/Completed), `async: true`, timeout 5 s, o script **sempre sai com 0 e não imprime nada**: se o pet estiver fechado, o Claude Code não é afetado.
- **Privacidade:** o script só envia tipo do evento, session_id, pasta, nome da ferramenta, tipo/mensagem curta de Notification, código de erro e assunto de tarefa. **Nunca** prompt, `tool_input`, transcrição ou conteúdo de arquivo.
- **Instalação segura:** merge no `~/.claude/settings.json` (ou `CLAUDE_CONFIG_DIR`), backup em `~/.claude/backups/`, idempotente, entradas de terceiros intactas, remoção exata. Recusa-se a alterar se o JSON for inválido. Tolera BOM.
- **Estados:** `IDLE · THINKING · WORKING · WAITING_PERMISSION · COMPLETED · ERROR · DISCONNECTED · UNKNOWN`. `Stop` ≠ fim de sessão (só `SessionEnd`). `Notification` só vira permissão se `notification_type = permission_prompt`. `PostToolUse` volta a THINKING (a resposta não terminou). Sem eventos por 2 min em THINKING/WORKING → `UNKNOWN` ("Aguardando eventos"); COMPLETED volta a IDLE após 6 s; IDLE por 90 s → mascote dorme.
- **Várias sessões:** política "atenção" (permissão > erro > trabalhando > pensando > concluída > ocioso) ou "mais recente"; sessão observada manualmente ou fixada vence. Sessão ≠ processo: o pet cruza eventos com `~/.claude/sessions/*.json` + PID vivo para marcar *ativa / desconhecida / encerrada*.
- **Reinício do pet:** sessões salvas voltam como "desconhecida" e são reconciliadas pela descoberta (processo vivo) e por novos eventos.

## Faixa de uso (Contexto, 5 horas, Semana, Cache)

Card entre as abas (Chat | Sessões) e a conversa, nas duas abas. Recolhido: 4 anéis. Expandido (seta): 2x2 com "212k / 1M", "Reinicia 23:20", "Reinicia qua 17:10", "Lidos 2,14M" e "Sessão X · atualizado há N s". Laranja por padrão, âmbar a partir de 80% e vermelho a partir de 95% (só Contexto, 5 horas e Semana; **Cache nunca alerta**, alto é bom). Liga/desliga e "texto mínimo" em **Configurações › Claude Code › Faixa de uso**.

**Instalar:** Configurações › Claude Code › **Instalar faixa de uso** (nunca automático). Altera **só o campo `statusLine`** do `~/.claude/settings.json`: backup datado em `~/.claude/backups`, aborta se o JSON for inválido, escrita atômica. Se você já tinha status line, o comando original fica guardado em `%APPDATA%\ClaudePet\statusline.json` (não no settings.json) e a ponte o executa com a mesma entrada, no mesmo shell (Git Bash), imprimindo exatamente a saída dele, mesmo com o pet fechado. Sem status line anterior, a ponte não imprime nada (o terminal não muda). Status: "Instalada", "Não instalada", "Status line existente encadeada" ou "alterada depois da instalação".

**Remover:** mesmo lugar, **Remover**. Se o settings.json não mudou desde a instalação, volta byte a byte ao original (ou deixa de existir, se não existia). Se outras chaves mudaram, só o campo `statusLine` volta ao original. Se a `statusLine` foi trocada depois da instalação, nada é escrito: o pet pergunta se deve só esquecer a instalação. Desinstalar o app também remove a ponte (mesmas regras).

**De onde vem cada número**

| Medidor | Fonte | Escopo |
|---|---|---|
| Contexto | `context_window.used_percentage`, `context_window_size` e `current_usage` (entrada + cache) do JSON da status line | sessão exibida pelo pet |
| 5 horas / Semana | `rate_limits.five_hour` / `seven_day` (`used_percentage`, `resets_at`) | **conta**: vale o dado mais recente de qualquer sessão; persistido só como números + horário (`usage.json`) |
| Cache | leitura de cache ÷ (leitura + criação + entrada nova), somado por resposta única na transcrição; "Lidos" = soma da leitura de cache | sessão exibida |

**O que lê:** o JSON que o Claude Code entrega à status line (a ponte extrai uma lista fixa de números + `session_id` e descarta o resto, sem gravar nada) e, na transcrição `~/.claude/projects/<pasta>/<session_id>.jsonl`, **só** os números de `message.usage` das respostas. A leitura é incremental (deslocamento em memória, 1 MB por leitura), com dedupe por `message.id` (a mesma resposta aparece em várias linhas) e confinada a `~/.claude/projects` via `realpath` (links para fora são recusados).
**O que NÃO lê:** credenciais (`.credentials.json`, tokens OAuth, cookies), APIs de uso não documentadas, texto de prompts/respostas, caminhos enviados pela status line. A rota `/usage` do serviço local usa o mesmo token loopback dos hooks e aceita só números validados (porcentagem 0–100, tokens inteiros ≤ 1e9, `resets_at` plausível); o resto é rejeitado com log só dos nomes dos campos.

**Estados:** sem dado = "—" e anel vazio (nunca 0% por falta de dado). Sem `rate_limits` = somem 5 horas e Semana. `resets_at` já passou = "—" até chegar dado novo. Dado com mais de 5 min (`USAGE_STALE_MS` em `src/shared/usage.ts`) = esmaecido.

**Limitações:** funciona nas sessões do Claude Code em que a status line roda (terminal interativo; `claude -p` não tem status line); **não confirmado** no Claude Desktop nem em outras interfaces. Os dados só atualizam quando o Claude Code redesenha a status line (nova mensagem, troca de modo etc.), por isso sessões paradas ficam "atualizado há X". Os limites só existem em planos com assinatura (Pro/Max) e só chegam depois da 1ª resposta da sessão. Uma `statusLine` em settings de projeto/local/gerenciado sobrescreve a do usuário: o Diagnóstico avisa, e o pet não altera esses arquivos. Transcrições de subagentes (arquivos separados) não entram no Cache. A ponte custa uma inicialização do node (~50–60 ms medidos neste PC) por redesenho. Preview visual: `npm run preview:ui` → `/?w=chat&usage=full|hot|norl|stale|none&band=open#preview-ui`.

## Mini chat: autenticação e custos

Dois motores (Configurações → Chat):
- **CLI (padrão):** roda o seu `claude -p --output-format stream-json` com o **seu login** (assinatura ou chave). O Claude Pet não lê nem guarda credenciais. Retoma conversa com `--resume`.
- **Agent SDK:** exige **chave de API** (cobrança por uso, separada da assinatura). A documentação oficial diz que apps de terceiros não podem oferecer login claude.ai. Guardada com `safeStorage` (DPAPI).

Nos dois motores o chat é **só conversa** (igual ao Claude Desktop): sobe com `--tools "" --strict-mcp-config` (SDK: `tools: []`), então não lê, edita nem apaga arquivos, não roda comandos e não pede permissão.

O chat **não injeta mensagens** em sessões abertas num terminal (não existe API oficial para isso). "Abrir Claude Code" abre uma **nova** sessão no Windows Terminal (`wt -d <pasta> claude`, exec-form, sem shell) ou **retoma** pelo ID (`claude --resume`), apenas para sessões que não estão ativas em outro terminal.

## Projetos (mini chat e "Abrir Claude Code")

Configurações → Claude Code → **Projetos**. A aba Sessões não depende disto: ela continua mostrando tudo que os hooks enviam.
- **Lista de projetos:** **Manual** (padrão) = só **Fixados** e **Recentes** (até 5, `MAX_RECENT` em `src/main/projects.ts`) que você escolheu. **Automática** = o comportamento antigo (pastas das sessões e conversas), já filtrado.
- **Escolher pasta…** abre o seletor nativo do Windows no processo principal. O renderer nunca manda caminhos, só ids. Cada pasta é validada (existe, é pasta, `realpath`) e comparada sem diferenciar maiúsculas, então `PROJETOS` e `Projetos` viram uma só.
- **Pastas sensíveis** (pasta de usuário, raiz de disco, `~/.claude` e subpastas, AppData, Temp) pedem confirmação, com **Cancelar** como padrão. Elas valem só até fechar o pet: nunca entram em Recentes nem na lista automática, e não podem ser fixadas nem virar projeto padrão. Pasta de rede (UNC) pede confirmação.
- **Sem projeto padrão**, "Abrir Claude Code" e a primeira mensagem do chat pedem a pasta. A pasta de usuário nunca é usada como padrão.
- **Clique duplo no pet** abre o Claude Code direto na pasta do usuário (escolha explícita). O **botão laranja** do chat sempre pede a pasta.
- **Migração:** na 1ª execução da versão nova, o `settings.json` ganha backup (`settings.backup-<data>.json`) e a lista antiga vira Recentes (só pastas que existem e não são sensíveis; nada é fixado). Dados em `%APPDATA%\ClaudePet\projects.json`.

## Ambiente limpo ao abrir o Claude Code

O Claude Code marca os processos que ele mesmo cria (`CLAUDECODE`, `CLAUDE_CODE_CHILD_SESSION`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_PID` e outros). Se o pet foi iniciado de dentro de uma sessão (por exemplo, instalado ou testado por ela), ele herda essas marcas. O `claude` que ele abrir passa a se achar uma "sessão filha": aparece o aviso *"Transcript saving is off"*, a sessão some do `--resume` e o anel de Cache fica sem dado.

O pet agora remove **só esses marcadores** (`CLAUDE_MARKERS` em `src/main/claudeCli.ts`) em todo processo do Claude Code que ele cria: terminal, retomar sessão, chat CLI/SDK e `claude --version`. Variáveis de configuração suas (`ANTHROPIC_*`, `CLAUDE_CODE_USE_*`, `CLAUDE_EFFORT`, proxy) ficam. O Windows Terminal repassa à nova aba o ambiente de quem o chamou (testado com janela nova e com aba em janela já aberta), então basta limpar na chamada.

O Diagnóstico mostra **Ambiente: Limpo/Contaminado**, só com os nomes dos marcadores, nunca os valores. A exportação leva só `envClean: true/false`. Se aparecer "Contaminado", feche o pet e abra pelo menu Iniciar.

## Equipes

Botão de pessoas no cabeçalho do chat (ou menu do pet / bandeja). Duas abas, e o **?** no topo explica cada uma.

**Agent Teams** (recurso experimental do Claude Code)
- **Abrir Claude em modo equipe** pede a pasta e abre o Claude Code com `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` só naquela janela. O `settings.json` não muda.
- O pet lê `~/.claude/teams/*/config.json` **só para leitura** e liga a equipe ao líder pelo `leadSessionId`. Usa só nome, tipo, cor e entrada de cada membro; o `prompt` dos membros nunca é lido. Cada membro vira um card com skin própria.
- Estados vêm dos eventos da sessão do líder (`agent_type` = nome do membro), de `TeammateIdle` e de `TaskCreated`/`TaskCompleted`. Membro com nome igual a um tipo de subagente fica "Desconhecido".
- Subagentes comuns não são membros: aparecem só como contador no card de quem os chamou. Equipes antigas podem ser removidas do pet sem tocar na pasta do Claude Code.

**Equipe manual** (você leva as mensagens entre as sessões)
- **Montar equipe:** Líder fixo e de 1 a 7 agentes, com função da lista ou personalizada e modelos rápidos. Cada função tem um nome livre e um identificador (slug validado) usado na branch, na pasta e no arquivo. A skin pertence à posição do card.
- **Preparar projeto:** escolhe a pasta do líder e detecta a branch atual. Propõe as regras da equipe no `CLAUDE.md` e `.equipe/` no `.gitignore`, mostrando a diferença e gravando só depois da sua confirmação. **Copiar comandos de worktree** gera os comandos para o PowerShell; o pet não executa nada.
- **Fluxo:** o líder escreve as tarefas em `.equipe/tarefas/<slug>.md` (o card mostra e copia). Cada agente termina com um commit `ENTREGA: ...` (só o assunto conta) e o card avisa. O líder grava `aprovado <hash>` ou `ajustes <hash>: ...` em `.equipe/revisoes/<slug>.md`, e o veredito só vale para a entrega mais recente. Com todos aprovados o líder mostra "Pronto para integrar".
- **Regras:** o pet só lê do git (argumentos separados, sem travas, `core.fsmonitor=false`) e de `.equipe/` (caminho só com slug, sem links). Só escreve no `CLAUDE.md` e no `.gitignore`, após confirmação, e nunca digita em terminal.

**Hooks:** a instalação pelas Configurações mostra a diferença no `settings.json` e só grava ao confirmar. Da ferramenta `Agent` o hook envia só o `name`; prompt, `description` e `task_description` nunca saem.

## Segurança

`contextIsolation`, `sandbox`, sem `nodeIntegration`, CSP restrita, preload com superfície mínima, IPC validado (zod/clamps), navegação e `window.open` bloqueados. Serviço local só em `127.0.0.1`, porta aleatória, token por execução (comparação em tempo constante), corpo ≤ 64 KB, `session_id` validado por regex. Pastas com `; & | < > ^ % " `` ` são recusadas ao abrir terminal. Logs com segredos mascarados; exportação de diagnóstico sem chave nem caminhos pessoais.

## O que foi validado (e como)

| Item | Evidência |
|---|---|
| Máquina de estados, política multi-sessão, timeouts | 8 testes vitest |
| Merge/remoção de hooks preservando terceiros; idempotência | 4 testes vitest + teste no app instalado (BOM, backup, restauração idêntica) |
| Servidor de eventos: auth, validação, tamanho, loopback | 5 testes vitest |
| Descoberta de sessões, simultâneas, reinício/reconciliação, processo morto | 6 testes vitest |
| Chat: mapeamento de stream, processo CLI falso (stdin/streaming/erro), validação de pasta, redact | 10 testes vitest + parse de saída **real** do `claude -p` 2.1.308 |
| **Hooks → pet com sessão real do Claude Code** | `claude -p --settings <temp>` → log do app: SessionStart → UserPromptSubmit → PreToolUse(Read) → PostToolUse → Stop → SessionEnd |
| Janela transparente sobre outros apps, mascote, "?" para sessão sem eventos | captura de tela real |
| Mini chat abre colado ao pet; janela de Configurações | capturas de tela reais |
| Persistência da posição | `petPos` gravado em `settings.json` após o pet ser movido |
| Instalador: instalar, atalhos, executar, desinstalar limpo, `settings.json` global intocado | execução real (silenciosa) |
| `tsc` sem erros; `electron-vite build` | executados |
| Estados ao vivo no app (digitando, entre ferramentas sem "?", "!" no Stop, placa de permissão) | eventos reais enviados ao serviço local + capturas de tela |
| Pixel-art nítida em 50/100/200 %; chat/Configurações/Sessões/menu, escuro e claro | capturas (Chrome headless + Electron) |
| Chat a 150 % de escala (flag do Electron) | captura: nada cortado |
| Faixa de uso: campos que chegam no plano Pro (`context_window.*`, `rate_limits.five_hour/seven_day`, nome da transcrição = `<session_id>.jsonl`) | sonda temporária numa sessão real (só nomes/tipos/números registrados; removida) |
| Projetos: canonização/duplicatas (maiúsculas, barras, espaço final, espaços, acentos), pastas sensíveis (home, raiz, .claude, AppData, Temp, UNC), recentes ≤ 5, fixar/remover/limpar, migração, modos Manual/Automática, IPC só por id | 14 testes vitest (`tests/projects`) |
| Ambiente limpo: remove só os marcadores, preserva o resto, não expõe valores; filho do chat não recebe marcadores | 4 testes (`tests/env`) + 1 em `tests/chat` + teste real: aba do Windows Terminal aberta com o ambiente limpo, zero marcadores (só nomes conferidos) |
| Chat sem ferramentas | `claude -p --tools "" --strict-mcp-config` real: `tools: []`, zero `tool_use`, arquivo-isca intacto |
| Faixa de uso: validador, cache com duplicatas/leitura incremental/linha gigante, caminhos (`../`, symlink, junction), instalador (sem/com statusLine, JSON inválido, restauração byte a byte, alteração externa), ponte (offline, timeout, encadeada cmd e Git Bash, exit code, tempo), UI (sem dado, sem limites, velho, limiares, reset passado) | 59 testes vitest (`tests/usage`, `transcript`, `statusline`, `usageBand`) + capturas do preview escuro/claro |

**Total: 58 testes automatizados passando** (33 originais + 18 do controlador visual com fake timers + 4 de sanitização do Markdown + 3 do modelo de menu).

## O que NÃO foi validado / limitações

- **Não verificado (UI nova):** clique real nos itens do menu customizado (só o modelo, a renderização e a abertura foram testados), DPI real do Windows em 125 %/150 % (testei só o flag de escala do Electron a 150 %), múltiplos monitores, e o pet com sessões reais simultâneas.
- **Não verificado por mim de forma controlada:** arrastar vs. clicar vs. botão direito, duplo clique, hover, múltiplos monitores, DPI > 100 %, bandeja (restaurar/sair), toasts e sons do Windows, "iniciar com o Windows", e as animações de cada estado vistas ao vivo (a lógica de estados está testada; a aparência de cada pose foi escrita mas só o IDLE e `?` foram vistos). Use o checklist abaixo.
- **Motor SDK** (chave de API): implementado conforme os tipos do SDK instalado, **não executado** (sem chave). O motor CLI foi validado só até o formato do stream real; a ida-e-volta completa pela UI do chat não foi exercitada.
- **Ocultar em tela cheia/jogos:** não implementado (sem API confiável).
- **WSL:** sessões dentro do WSL usam outro `~/.claude`; não são vistas.
- **Sessões remotas/SSH/nuvem:** não suportadas.
- **Claude Desktop:** só eventos se ele usar os hooks compartilhados; não confirmado. O botão apenas abre o app se achar `%LOCALAPPDATA%\AnthropicClaude\claude.exe`.
- **Sessões abertas antes dos hooks:** aparecem (via arquivos de sessão), mas sem estado em tempo real até reiniciadas. O formato de `~/.claude/sessions` não é documentado; pode mudar.
- **Hook exige `node` no PATH** (o instalador grava o caminho absoluto encontrado).
- Menu de contexto usa o menu nativo do Windows (não tematizado). Mascotes personalizados: ainda não.
- Sem lint configurado.

## Checklist manual (5 minutos)

1. Abrir o app → mascote visível, sem caixa ao redor, sobre outras janelas.
2. Arrastar (move, não abre o chat) → soltar → reiniciar → posição mantida.
3. Clique simples → chat abre perto do pet; clicar fora → fecha.
4. Botão direito → menu; testar tamanho, mascote, silêncio.
5. Configurações → Claude Code → Instalar integração; Diagnóstico → **Testar conexão** deve dar ✔.
6. Reiniciar uma sessão `claude`, mandar um prompt com ferramenta → mascote: pensando → trabalhando → comemora; toast "Tarefa concluída".
7. Pedir uma ação que exija aprovação → placa de atenção + toast + som.
8. Duas sessões em paralelo → aba Sessões lista as duas; "Observar" fixa o pet em uma.
9. Fechar o app → `claude` continua normal, sem erro de hook.
10. Bandeja: ocultar pet, clique no ícone, Sair.
11. Desinstalar → `settings.json` volta sem hooks do Claude Pet.

## Solução de problemas

- **Pet mostra `?` / "Aguardando eventos":** hooks não instalados ou sessão iniciada antes. Instale e reinicie o `claude`.
- **Diagnóstico → Testar conexão falha:** app fechado, hook não instalado, ou antivírus bloqueando loopback.
- **Nada acontece com os hooks:** confira `node --version` no PATH e `~/.claude/settings.json` (entradas com `claude-pet-hook`).
- **Chat: "claude não encontrado":** `where claude` no PowerShell; reabra o app após instalar.
- **Log:** `%APPDATA%\ClaudePet\claude-pet.log` · dados: `%APPDATA%\ClaudePet\` (settings, conversas, sessões).
