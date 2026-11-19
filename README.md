# Vistoria Digital

App estático (HTML + JS) para vistoria de veículos: a retirada é registrada, o carro fica "Em Andamento" até a entrega, e a vistoria finalizada gera o PDF.

Funciona de dois jeitos:
- **Nuvem:** as vistorias ficam salvas online (Supabase) e aparecem em qualquer aparelho. Login é opcional.
- **Local:** sem configurar nada, as vistorias ficam só no navegador do aparelho.

## Fluxo
1. **Nova Retirada**: dados do veículo, cliente e local, checklist (Tem / Falta / N/A), avarias pré-existentes, fotos, observações e assinaturas do responsável e do motorista.
2. **Em Andamento**: retiradas aguardando entrega. Ao tocar em uma, registra-se o local, as fotos, a observação e a assinatura de quem recebe o carro.
3. **Finalizada**: vistorias concluídas. Daqui você baixa ou compartilha o PDF completo (retirada + entrega).

## Publicar na Netlify
O site é estático (sem build). Qualquer um destes caminhos funciona:
- **Arrastar e soltar:** em app.netlify.com/drop, arraste a pasta `gm-auto-center` (já descompactada). Para atualizar depois, abra o site no painel → **Deploys** → arraste a pasta de novo.
- **Pelo GitHub:** suba a pasta para um repositório, em **Add new site → Import an existing project** escolha o repositório (build command vazio, publish directory `.`). Cada commit publica sozinho.
O `netlify.toml` já aplica os headers de segurança. (O `vercel.json` só vale se um dia você usar o Vercel.)

## Ligar o banco (Supabase, plano gratuito)
Faça uma vez só:
1. Crie um projeto em supabase.com (**New project**).
2. Abra **SQL Editor → New query**, cole o conteúdo de `supabase/schema.sql` e clique em **Run**.
3. Em **Project Settings → API**, copie a **Project URL** e a chave **anon / publishable**.
4. Cole as duas no `config.js` (`supabaseUrl` e `supabaseKey`) e publique de novo na Netlify.

Pronto: todos os aparelhos que abrirem o link enxergam as mesmas vistorias. **Nunca** coloque no app a chave `service_role` / `secret`.

### Sem login (padrão) e o risco disso
Com `exigirLogin: false`, o app abre direto. Como a chave do Supabase fica no código do site, **qualquer pessoa que abrir o código-fonte do site consegue ler, alterar e apagar as vistorias** (que têm RG, telefone, assinaturas e fotos). Quem não conhece o link do site não chega lá, mas o link não é um segredo forte. Para uso real com dados de clientes, o recomendado é exigir login:
1. No SQL Editor, rode as linhas comentadas "PARA EXIGIR LOGIN" no `schema.sql`.
2. Em **Authentication**, desligue o cadastro público e crie o login de cada pessoa (e-mail + senha).
3. No `config.js`, troque para `exigirLogin: true` e publique de novo.

## Personalizar
- `config.js`: nome, CNPJ, telefone, endereço, logo, cor do cabeçalho do PDF, chaves do banco e `exigirLogin`.
- `assets/logo.jpg`: troque pela logo da empresa.
- Itens do checklist: lista `ITENS` na seção de checklist de `app.js`.
- Tipos de avaria: opções do `<select id="tipoAvaria">` em `index.html`.
- Numeração: na nuvem, o número é gerado pelo banco ao salvar. Para começar de outro número, use a última linha (comentada) do `schema.sql`.

## Onde os dados ficam
- **Modo nuvem:** textos, assinaturas e fotos ficam no banco do seu projeto Supabase. Sem login, o acesso é aberto a quem tem a chave do site (veja o aviso acima). As fotos são reduzidas pelo app antes do envio.
- **Modo local:** ficam no IndexedDB do navegador (e se ele não existir, só na memória da aba). Nada sai do aparelho.
- Com login ligado, a sessão fica guardada no aparelho até você tocar em **Sair**.
- Conexão: no modo nuvem é preciso internet para salvar e abrir vistorias. Se a conexão cair no meio de um envio, o app avisa e mantém os dados na tela para tentar de novo; nenhuma retirada fica salva pela metade.

## Segurança aplicada
- CSP restrita (só `self` e o domínio do Supabase), X-Frame-Options, HSTS, nosniff, Referrer-Policy, Permissions-Policy.
- Banco com Row Level Security ligado. No modo sem login a regra é aberta (veja o aviso); com login, só usuário autenticado acessa.
- Todo texto do usuário entra via `textContent`/`value` (sem `innerHTML`), com limite de tamanho e remoção de caracteres de controle.
- Fotos: checagem de tipo por magic bytes, limite de 30 MB e 12 fotos por etapa, recompressão no canvas (remove metadados EXIF).
- Assinaturas só são salvas depois de confirmadas.
- jsPDF empacotado localmente (`vendor/`), sem CDN externo; a nuvem é chamada direto por `fetch`, sem biblioteca de terceiros.
- Consentimento (LGPD) obrigatório antes de salvar a retirada; o texto muda conforme os dados fiquem no aparelho ou na nuvem.

## Limitações
- Todos que acessam enxergam e podem apagar todas as vistorias (não há perfis diferentes).
- O número da vistoria pode pular quando um envio falha e é refeito.
- O plano gratuito do Supabase tem limite de espaço (500 MB) e pode pausar o projeto depois de um período sem uso; as fotos são o que mais ocupa. Para uso contínuo, confira os limites atuais no site do Supabase.
- Sem QR code/link público de conferência.
- Vistorias que já estavam salvas só no aparelho (modo local) não são enviadas para a nuvem automaticamente.
