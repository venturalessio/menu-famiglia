-- Memoria breve delle conversazioni di Mark con Siri.
-- La legge e la scrive solo la funzione "mark" (chiave service role): nessuna policy per anon o utenti.
create table if not exists public.mark_siri (
  id bigint generated always as identity primary key,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);
alter table public.mark_siri enable row level security;
revoke all on public.mark_siri from anon, authenticated;
create index if not exists mark_siri_created_at on public.mark_siri (created_at desc);
