-- Sogno di Mark: ogni mattina rilegge le conversazioni di ieri e propone ad Alessio fatti da ricordare o regole nuove.
-- Le proposte diventano vere solo dopo il suo sì (stato accettata).
create table if not exists public.mark_proposte (
  id bigserial primary key,
  creato timestamptz not null default now(),
  tipo text not null check (tipo in ('fatto', 'regola')),
  testo text not null check (char_length(testo) between 1 and 400),
  motivo text,
  stato text not null default 'in_attesa' check (stato in ('in_attesa', 'accettata', 'rifiutata', 'scaduta')),
  deciso timestamptz
);
create index if not exists mark_proposte_stato on public.mark_proposte (stato, tipo);
alter table public.mark_proposte enable row level security;
