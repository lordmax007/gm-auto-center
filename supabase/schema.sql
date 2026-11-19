-- Vistoria Digital: tabelas para salvar as vistorias na nuvem (Supabase).
-- Cole este arquivo inteiro no Supabase: SQL Editor > New query > Run.

create table if not exists public.vistorias (
  id            text primary key,
  numero        bigint generated always as identity (start with 1),
  status        text not null default 'andamento' check (status in ('andamento', 'finalizada')),
  criado_em     timestamptz not null default now(),
  finalizado_em timestamptz,
  placa         text,
  veiculo       text,
  cliente       text,
  doc           jsonb not null default '{}'::jsonb   -- dados, checklist, avarias e assinaturas (as fotos ficam na tabela abaixo)
);
create index if not exists vistorias_status_criado_idx on public.vistorias (status, criado_em desc);

create table if not exists public.vistoria_fotos (
  id          bigint generated always as identity primary key,
  vistoria_id text not null references public.vistorias (id) on delete cascade,
  etapa       text not null check (etapa in ('retirada', 'entrega')),
  ordem       int  not null,
  w           int  not null,
  h           int  not null,
  data        text not null                          -- foto em base64 (JPEG já reduzido pelo app)
);
create index if not exists vistoria_fotos_idx on public.vistoria_fotos (vistoria_id, etapa, ordem);

-- Segurança (RLS ligado). Por padrão o app NÃO usa login, então o acesso é aberto para quem tem a chave do site.
-- Isso significa que quem abrir o código do site consegue ler e apagar as vistorias. Para exigir login, veja o bloco no final.
alter table public.vistorias      enable row level security;
alter table public.vistoria_fotos enable row level security;

grant select, insert, update, delete on public.vistorias      to anon, authenticated;
grant select, insert, update, delete on public.vistoria_fotos to anon, authenticated;

drop policy if exists "acesso aberto" on public.vistorias;
create policy "acesso aberto" on public.vistorias
  for all to anon, authenticated using (true) with check (true);

drop policy if exists "acesso aberto" on public.vistoria_fotos;
create policy "acesso aberto" on public.vistoria_fotos
  for all to anon, authenticated using (true) with check (true);

-- PARA EXIGIR LOGIN (exigirLogin: true no config.js): rode as linhas abaixo e crie os usuários em Authentication.
-- drop policy if exists "acesso aberto" on public.vistorias;
-- drop policy if exists "acesso aberto" on public.vistoria_fotos;
-- revoke all on public.vistorias, public.vistoria_fotos from anon;
-- create policy "equipe autenticada" on public.vistorias      for all to authenticated using (true) with check (true);
-- create policy "equipe autenticada" on public.vistoria_fotos for all to authenticated using (true) with check (true);

-- Opcional: começar a numeração em outro número (ex.: 100). Remova os "--" da linha abaixo e rode.
-- alter table public.vistorias alter column numero restart with 100;
