-- Biblioteca di Mark: video e pagine che Alessio gli fa studiare (coda per il server + schede)
create table if not exists public.mark_biblioteca (
  id bigint generated always as identity primary key,
  url text not null,
  perche text not null default '',
  canale text not null default '',
  stato text not null default 'in_coda' check (stato in ('in_coda', 'in_lavoro', 'pronta', 'errore')),
  tentativi integer not null default 0,
  preso timestamptz,
  tipo text,
  titolo text,
  autore text,
  pubblicato text,
  temi text,
  riassunto text,
  punti text,
  utile text,
  affidabilita text,
  trascrizione text,
  fonte_testo text,
  notion_url text,
  errore text,
  creato timestamptz not null default now(),
  finito timestamptz,
  ricerca tsvector generated always as (
    to_tsvector('italian'::regconfig,
      coalesce(titolo, '') || ' ' || coalesce(autore, '') || ' ' || coalesce(temi, '') || ' ' ||
      coalesce(riassunto, '') || ' ' || coalesce(punti, '') || ' ' || coalesce(trascrizione, ''))
  ) stored
);
create index if not exists mark_biblioteca_ricerca on public.mark_biblioteca using gin (ricerca);
create index if not exists mark_biblioteca_stato on public.mark_biblioteca (stato, creato);
alter table public.mark_biblioteca enable row level security;
comment on table public.mark_biblioteca is 'Biblioteca di Mark: video e pagine che Alessio gli fa studiare (coda per il server + schede). Solo service role.';
