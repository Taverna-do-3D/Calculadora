-- =========================================================================
-- BANCO DE DADOS TAVERNA DO 3D — SUPABASE SCHEMA
-- Execute este script no SQL Editor do seu projeto Supabase (supabase.com)
-- =========================================================================

-- 1. Tabela Principal de Sincronização do App (Estado Geral)
create table if not exists public.taverna_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Ativar segurança em nível de linha (RLS)
alter table public.taverna_state enable row level security;

-- Políticas de acesso: somente o próprio usuário logado pode ler e alterar seus dados
drop policy if exists "taverna_select_own" on public.taverna_state;
create policy "taverna_select_own"
on public.taverna_state for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "taverna_insert_own" on public.taverna_state;
create policy "taverna_insert_own"
on public.taverna_state for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "taverna_update_own" on public.taverna_state;
create policy "taverna_update_own"
on public.taverna_state for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

grant select, insert, update on public.taverna_state to authenticated;

-- =========================================================================
-- 2. Tabela Opcional Preparada para Webhook/API da Shopee & TikTok Shop
-- Permite receber pedidos externos diretamente via API/Webhook no futuro
-- =========================================================================
create table if not exists public.taverna_external_orders (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade,
  channel text not null check (channel in ('shopee', 'tiktok', 'whatsapp', 'direto', 'outro')),
  external_order_id text,
  customer_name text,
  customer_phone text,
  product_name text not null,
  quantity int default 1,
  total_amount numeric(10,2) not null,
  status text not null default 'novo',
  raw_payload jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.taverna_external_orders enable row level security;

drop policy if exists "taverna_ext_orders_own" on public.taverna_external_orders;
create policy "taverna_ext_orders_own"
on public.taverna_external_orders for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

grant all on public.taverna_external_orders to authenticated;
