-- Menù di famiglia: schema iniziale

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'La mia famiglia',
  invite_code text not null unique default upper(substr(md5(random()::text), 1, 6)),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (household_id, user_id)
);
create index household_members_user_idx on public.household_members(user_id);

create table public.weeks (
  household_id uuid not null references public.households(id) on delete cascade,
  week_start date not null,
  attendance jsonb not null default '{}'::jsonb,
  plan jsonb,
  updated_at timestamptz not null default now(),
  primary key (household_id, week_start)
);

create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  title text not null,
  data jsonb not null default '{}'::jsonb,
  favorite boolean not null default false,
  last_used date,
  created_at timestamptz not null default now(),
  unique (household_id, title)
);
create index recipes_household_idx on public.recipes(household_id);

create table public.shopping_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  qty text,
  aisle text not null default 'Altro',
  source text not null default 'manuale',
  checked boolean not null default false,
  created_at timestamptz not null default now()
);
create index shopping_items_household_idx on public.shopping_items(household_id);

-- Appartenenza: funzione usata dalle policy (evita ricorsione sulle RLS)
create or replace function public.is_member(h uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = h and m.user_id = (select auth.uid())
  );
$$;

-- Crea una famiglia e ne diventa membro
create or replace function public.create_household(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare h uuid;
begin
  if auth.uid() is null then raise exception 'non autenticato'; end if;
  insert into public.households(name) values (coalesce(nullif(p_name, ''), 'La mia famiglia')) returning id into h;
  insert into public.household_members(household_id, user_id) values (h, auth.uid());
  return h;
end;
$$;

-- Entra in una famiglia con il codice invito
create or replace function public.join_household(p_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare h uuid;
begin
  if auth.uid() is null then raise exception 'non autenticato'; end if;
  select id into h from public.households where invite_code = upper(trim(p_code));
  if h is null then raise exception 'codice non valido'; end if;
  insert into public.household_members(household_id, user_id) values (h, auth.uid())
  on conflict do nothing;
  return h;
end;
$$;

revoke execute on function public.is_member(uuid) from anon;
revoke execute on function public.create_household(text) from anon;
revoke execute on function public.join_household(text) from anon;

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.weeks enable row level security;
alter table public.recipes enable row level security;
alter table public.shopping_items enable row level security;

create policy "membri leggono la famiglia" on public.households
  for select to authenticated using (public.is_member(id));
create policy "membri aggiornano la famiglia" on public.households
  for update to authenticated using (public.is_member(id)) with check (public.is_member(id));

create policy "membri vedono i membri" on public.household_members
  for select to authenticated using (public.is_member(household_id));

create policy "membri gestiscono le settimane" on public.weeks
  for all to authenticated using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy "membri gestiscono le ricette" on public.recipes
  for all to authenticated using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy "membri gestiscono la spesa" on public.shopping_items
  for all to authenticated using (public.is_member(household_id)) with check (public.is_member(household_id));

-- Aggiornamenti in tempo reale
alter publication supabase_realtime add table public.shopping_items;
alter publication supabase_realtime add table public.weeks;
alter publication supabase_realtime add table public.households;
