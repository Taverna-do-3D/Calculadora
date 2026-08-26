-- Genesis 3D v13 - banco persistente por usuário
-- Execute uma vez no SQL Editor do seu projeto Supabase.

create table if not exists public.genesis_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.genesis_state enable row level security;

drop policy if exists "genesis_select_own" on public.genesis_state;
create policy "genesis_select_own"
on public.genesis_state for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "genesis_insert_own" on public.genesis_state;
create policy "genesis_insert_own"
on public.genesis_state for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "genesis_update_own" on public.genesis_state;
create policy "genesis_update_own"
on public.genesis_state for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

grant select, insert, update on public.genesis_state to authenticated;
