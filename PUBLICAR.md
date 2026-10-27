# Publicar a app DS100 (GitHub + Railway)

## 1. GitHub
1. Entra em github.com e clica em **New repository** (nome: `ds100-app`, **Private**). Não marques "Add README".
2. Na página do repositório vazio, clica em **uploading an existing file**.
3. Descompacta o zip `ds100-app-web (v88).zip` e arrasta **todo o conteúdo** da pasta (não a pasta) para a página. Clica **Commit changes**.
   (A pasta `node_modules` não vem no zip; é o que queremos.)

## 2. Railway
1. Entra em railway.com (podes usar "Login with GitHub").
2. **New Project → Deploy from GitHub repo** → escolhe `ds100-app`.
3. No projeto, clica **+ New → Database → Add PostgreSQL**.
4. Clica no serviço da app → **Variables** → **New Variable** → `DATABASE_URL` com o valor `${{Postgres.DATABASE_URL}}` (referência ao Postgres).
   **Obrigatório em produção:** `PIN_SUPERVISORA` = a palavra-passe da supervisão (não usar a de teste) e `SEM_CARGA_INICIAL` = `1` (não carregar dados de teste).
5. **Settings → Networking → Generate Domain**. Abre o endereço no telemóvel.
6. As tabelas criam-se sozinhas no primeiro arranque.

## 3. Guardar os dados (histórico)
- Todos os movimentos (provas, colocações, MISU, contadeira, levantamentos, edições da supervisora, limpezas) ficam gravados na tabela `movimentos` do PostgreSQL do Railway. Nunca são apagados, nem pelo botão de limpar dados de teste.
- Para os descarregar: Logística → Editar · supervisora → **Descarregar movimentos (CSV)** (abre no Excel).
- No Railway, abre o serviço **Postgres → Backups** e ativa cópias de segurança regulares. O Postgres já guarda os dados num volume que sobrevive a novos deploys.

## 4. Depois
- Cada alteração que carregares no GitHub publica-se sozinha no Railway.
- Para repor dados: Menu Supervisão → **Restaurar versão anterior**. Limpar dados de teste: ver `docs/BOAS_PRATICAS.md` (secção C).
- No telemóvel: abrir o endereço → menu do browser → "Adicionar ao ecrã principal".
