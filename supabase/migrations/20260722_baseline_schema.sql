-- Supabase remote schema snapshot for project ndxjjzuczrdctgfmesuv.
-- Captured and verified against the live PostgreSQL catalog on 2026-07-15.
-- Full catalog evidence: supabase-remote-schema-catalog-2026-07-15.json

create extension if not exists pgcrypto;

create table if not exists public.campers (
  id uuid primary key default gen_random_uuid(),
  camper_id text not null unique,
  barcode_value text unique,
  full_name text not null,
  cabin text,
  balance_cents integer not null default 0 check (balance_cents >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.store_items (
  id uuid primary key default gen_random_uuid(),
  item_name text not null,
  barcode_value text not null unique,
  price_cents integer not null check (price_cents > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  camper_id uuid not null references public.campers(id) on delete restrict,
  store_item_id uuid references public.store_items(id) on delete set null,
  transaction_type text not null check (transaction_type in ('charge', 'deposit', 'void')),
  amount_cents integer not null check (amount_cents > 0),
  note text,
  performed_by uuid not null references auth.users(id) on delete restrict,
  voided_at timestamptz,
  voided_transaction_id uuid references public.transactions(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.campers enable row level security;
alter table public.store_items enable row level security;
alter table public.transactions enable row level security;

revoke all on table public.campers from anon, authenticated;
revoke all on table public.store_items from anon, authenticated;
revoke all on table public.transactions from anon, authenticated;

grant select, insert, update on table public.campers to authenticated;
grant select, insert, update on table public.store_items to authenticated;
grant select on table public.transactions to authenticated;

create policy "authenticated users can read campers"
on public.campers
for select to authenticated
using (auth.uid() is not null);

create policy "authenticated users can insert campers"
on public.campers
for insert to authenticated
with check (auth.uid() is not null);

create policy "authenticated users can update campers"
on public.campers
for update to authenticated
using (auth.uid() is not null)
with check (auth.uid() is not null);

create policy "authenticated users can read store items"
on public.store_items
for select to authenticated
using (auth.uid() is not null);

create policy "authenticated users can insert store items"
on public.store_items
for insert to authenticated
with check (auth.uid() is not null);

create policy "authenticated users can update store items"
on public.store_items
for update to authenticated
using (auth.uid() is not null)
with check (auth.uid() is not null);

create policy "authenticated users can read transactions"
on public.transactions
for select to authenticated
using (auth.uid() is not null);

create or replace function public.apply_camper_transaction(
  p_camper_id uuid,
  p_transaction_type text,
  p_amount_cents integer,
  p_note text default null,
  p_item_id uuid default null
)
returns table (
  success boolean,
  message text,
  new_balance_cents integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_balance integer;
  v_new_balance integer;
begin
  if auth.uid() is null then
    return query select false, 'Not signed in.', null::integer;
    return;
  end if;

  if p_transaction_type not in ('charge', 'deposit') then
    return query select false, 'Invalid transaction type.', null::integer;
    return;
  end if;

  if p_amount_cents is null or p_amount_cents <= 0 then
    return query select false, 'Amount must be greater than 0.', null::integer;
    return;
  end if;

  if p_item_id is not null and p_transaction_type <> 'charge' then
    return query select false, 'Items can only be attached to charges.', null::integer;
    return;
  end if;

  select balance_cents
  into v_current_balance
  from public.campers
  where id = p_camper_id
  for update;

  if not found then
    return query select false, 'Camper not found.', null::integer;
    return;
  end if;

  if p_transaction_type = 'charge' then
    if v_current_balance < p_amount_cents then
      return query select false, 'Insufficient funds.', v_current_balance;
      return;
    end if;
    v_new_balance := v_current_balance - p_amount_cents;
  else
    v_new_balance := v_current_balance + p_amount_cents;
  end if;

  update public.campers
  set balance_cents = v_new_balance
  where id = p_camper_id;

  insert into public.transactions (
    camper_id,
    store_item_id,
    transaction_type,
    amount_cents,
    note,
    performed_by
  )
  values (
    p_camper_id,
    p_item_id,
    p_transaction_type,
    p_amount_cents,
    nullif(trim(p_note), ''),
    auth.uid()
  );

  return query select true, initcap(p_transaction_type) || ' saved.', v_new_balance;
end;
$$;

revoke all on function public.apply_camper_transaction(uuid, text, integer, text, uuid) from public;
grant execute on function public.apply_camper_transaction(uuid, text, integer, text, uuid) to authenticated;

create or replace function public.void_charge_transaction(
  p_transaction_id uuid
)
returns table (
  success boolean,
  message text,
  new_balance_cents integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_original public.transactions%rowtype;
  v_current_balance integer;
  v_new_balance integer;
begin
  if auth.uid() is null then
    return query select false, 'Not signed in.', null::integer;
    return;
  end if;

  select *
  into v_original
  from public.transactions
  where id = p_transaction_id
  for update;

  if not found then
    return query select false, 'Transaction not found.', null::integer;
    return;
  end if;

  if v_original.transaction_type <> 'charge' then
    return query select false, 'Only charge transactions can be voided.', null::integer;
    return;
  end if;

  if v_original.voided_at is not null then
    return query select false, 'That transaction has already been voided.', null::integer;
    return;
  end if;

  select balance_cents
  into v_current_balance
  from public.campers
  where id = v_original.camper_id
  for update;

  if not found then
    return query select false, 'Camper account not found.', null::integer;
    return;
  end if;

  v_new_balance := v_current_balance + v_original.amount_cents;

  update public.campers
  set balance_cents = v_new_balance
  where id = v_original.camper_id;

  insert into public.transactions (
    camper_id,
    store_item_id,
    transaction_type,
    amount_cents,
    note,
    performed_by,
    voided_transaction_id
  )
  values (
    v_original.camper_id,
    v_original.store_item_id,
    'void',
    v_original.amount_cents,
    'Void for transaction ' || v_original.id,
    auth.uid(),
    v_original.id
  );

  update public.transactions
  set voided_at = now()
  where id = v_original.id;

  return query select true, 'Charge voided.', v_new_balance;
end;
$$;

revoke all on function public.void_charge_transaction(uuid) from public;
grant execute on function public.void_charge_transaction(uuid) to authenticated;

alter table public.transactions
  drop constraint if exists transactions_transaction_type_check;

alter table public.transactions
  add constraint transactions_transaction_type_check
  check (transaction_type in ('charge', 'deposit', 'void'));

alter table public.transactions
  add column if not exists voided_at timestamptz;

alter table public.transactions
  add column if not exists voided_transaction_id uuid references public.transactions(id) on delete set null;

insert into public.campers (camper_id, barcode_value, full_name, cabin, balance_cents)
values
  ('A101', 'A101', 'Emma Carter', 'Pine', 3250),
  ('A102', 'A102', 'Noah Bennett', 'Oak', 1875),
  ('A103', 'A103', 'Olivia Brooks', 'Cedar', 4100),
  ('A104', 'A104', 'Liam Foster', 'Maple', 950),
  ('A105', 'A105', 'Sophia Reed', 'Birch', 2425)
on conflict (camper_id) do update
set barcode_value = excluded.barcode_value;

insert into public.store_items (item_name, barcode_value, price_cents)
values
  ('Soda', 'ITEM1001', 200),
  ('Candy Bar', 'ITEM1002', 150),
  ('Bracelet Kit', 'ITEM2001', 500),
  ('Postcard', 'ITEM2002', 100)
on conflict (barcode_value) do nothing;


create unique index if not exists campers_camper_id_key on public.campers (camper_id);
create unique index if not exists store_items_barcode_value_key on public.store_items (barcode_value);

-- Live columns added after the repository schema was uploaded.
alter table public.store_items
  add column if not exists location text;

alter table public.store_items
  add column if not exists main_category text;
