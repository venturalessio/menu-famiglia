-- Mark "Tienimi d'occhio": sorveglianze che la sentinella controlla da sola
create table if not exists public.mark_sorveglianze (
  id bigint generated always as identity primary key,
  tipo text not null check (tipo in ('sito', 'pagina', 'dominio')),
  cosa text not null,
  indirizzo text not null,
  condizione text not null default '',
  ogni_minuti integer not null default 60,
  attiva boolean not null default true,
  stato jsonb not null default '{}'::jsonb,
  ultimo_controllo timestamptz,
  creato timestamptz not null default now()
);
alter table public.mark_sorveglianze enable row level security;
comment on table public.mark_sorveglianze is 'Sorveglianze di Mark (siti, pagine, domini): le controlla la sentinella. Solo service role.';
