-- KiroDjib — rental listings marketplace for Djibouti
-- Tables are prefixed kiro_ so the schema can share a Supabase project with other apps.

-- ---------- Profiles ----------
create table if not exists public.kiro_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  phone text not null default '',
  whatsapp text not null default '',
  account_type text not null default 'owner' check (account_type in ('owner','agency')),
  plan text not null default 'free' check (plan in ('free','pro')),
  plan_until date,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create or replace function public.kiro_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.kiro_profiles where id = auth.uid()), false);
$$;

create or replace function public.kiro_is_pro(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select plan = 'pro' and plan_until >= current_date from public.kiro_profiles where id = uid), false);
$$;

-- ---------- Listings ----------
create table if not exists public.kiro_listings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.kiro_profiles(id) on delete cascade,
  title text not null check (char_length(title) between 5 and 120),
  description text not null default '',
  property_type text not null check (property_type in ('apartment','villa','studio','room','office','shop','land')),
  furnished boolean not null default false,
  bedrooms int not null default 0 check (bedrooms between 0 and 20),
  bathrooms int not null default 0 check (bathrooms between 0 and 20),
  price_djf int not null check (price_djf > 0),
  price_period text not null default 'month' check (price_period in ('month','day')),
  district text not null,
  features text[] not null default '{}',
  photos text[] not null default '{}',
  status text not null default 'pending' check (status in ('pending','active','rented','rejected')),
  is_featured boolean not null default false,
  featured_until timestamptz,
  views int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists kiro_listings_status_idx on public.kiro_listings(status, is_featured, created_at desc);
create index if not exists kiro_listings_owner_idx on public.kiro_listings(owner_id);

-- Non-admins cannot change moderation / paid columns; free accounts are limited to 2 live listings.
create or replace function public.kiro_listing_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare live_count int;
begin
  if not public.kiro_is_admin() then
    if tg_op = 'INSERT' then
      new.status := 'pending';
      new.is_featured := false;
      new.featured_until := null;
      new.views := 0;
      if not public.kiro_is_pro(new.owner_id) then
        select count(*) into live_count from public.kiro_listings
          where owner_id = new.owner_id and status in ('pending','active');
        if live_count >= 2 then
          raise exception 'FREE_LIMIT: les comptes gratuits sont limités à 2 annonces actives. Passez Pro.';
        end if;
      end if;
    else
      new.is_featured := old.is_featured;
      new.featured_until := old.featured_until;
      new.views := old.views;
      new.owner_id := old.owner_id;
      -- owners may only mark a listing as rented, or re-submit it (back to pending)
      if new.status <> old.status and new.status not in ('rented','pending') then
        new.status := old.status;
      end if;
      -- any content edit on an active listing goes back to moderation
      if old.status = 'active' and new.status = 'active' and
         (new.title, new.description, new.price_djf, new.photos) is distinct from (old.title, old.description, old.price_djf, old.photos) then
        new.status := 'pending';
      end if;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists kiro_listing_guard on public.kiro_listings;
create trigger kiro_listing_guard before insert or update on public.kiro_listings
for each row execute function public.kiro_listing_guard();

-- ---------- Inquiries (visitor -> owner) ----------
create table if not exists public.kiro_inquiries (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.kiro_listings(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  phone text not null check (char_length(phone) between 6 and 20),
  message text not null default '' check (char_length(message) <= 1000),
  created_at timestamptz not null default now()
);

-- ---------- Payments (manual mobile-money confirmation) ----------
create table if not exists public.kiro_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.kiro_profiles(id) on delete cascade,
  listing_id uuid references public.kiro_listings(id) on delete set null,
  product text not null check (product in ('featured_7d','featured_30d','pro_month')),
  amount_djf int not null,
  method text not null check (method in ('dmoney','waafi','cac_pay','cash')),
  reference text not null check (char_length(reference) between 3 and 60),
  status text not null default 'pending' check (status in ('pending','confirmed','rejected')),
  created_at timestamptz not null default now()
);

create or replace function public.kiro_price_of(p text)
returns int language sql immutable as $$
  select case p when 'featured_7d' then 3000 when 'featured_30d' then 9000 when 'pro_month' then 15000 end;
$$;

create or replace function public.kiro_payment_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if not public.kiro_is_admin() then
      new.status := 'pending';
      new.user_id := auth.uid();
    end if;
    new.amount_djf := public.kiro_price_of(new.product);
    if new.product like 'featured%' and new.listing_id is null then
      raise exception 'listing_id required for featured products';
    end if;
    return new;
  end if;
  -- UPDATE: only admins (enforced by RLS). Apply benefits once on confirmation.
  if new.status = 'confirmed' and old.status <> 'confirmed' then
    if new.product = 'pro_month' then
      update public.kiro_profiles
        set plan = 'pro', plan_until = greatest(coalesce(plan_until, current_date), current_date) + 30
        where id = new.user_id;
    elsif new.product in ('featured_7d','featured_30d') then
      update public.kiro_listings
        set is_featured = true,
            featured_until = greatest(coalesce(featured_until, now()), now())
              + case new.product when 'featured_7d' then interval '7 days' else interval '30 days' end
        where id = new.listing_id;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists kiro_payment_guard on public.kiro_payments;
create trigger kiro_payment_guard before insert or update on public.kiro_payments
for each row execute function public.kiro_payment_guard();

-- Profile column guard: users can't make themselves admin or pro.
create or replace function public.kiro_profile_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.kiro_is_admin() then
    if tg_op = 'INSERT' then
      new.is_admin := false; new.plan := 'free'; new.plan_until := null;
    else
      new.is_admin := old.is_admin; new.plan := old.plan; new.plan_until := old.plan_until;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists kiro_profile_guard on public.kiro_profiles;
create trigger kiro_profile_guard before insert or update on public.kiro_profiles
for each row execute function public.kiro_profile_guard();

-- Public view counter
create or replace function public.kiro_add_view(p_listing uuid)
returns void language sql security definer set search_path = public as $$
  update public.kiro_listings set views = views + 1 where id = p_listing and status = 'active';
$$;

-- Featured listings expire automatically when read
create or replace view public.kiro_public_listings with (security_invoker = true) as
  select l.*, (l.is_featured and l.featured_until > now()) as featured_now,
         p.full_name as owner_name, p.whatsapp as owner_whatsapp, p.phone as owner_phone,
         p.account_type as owner_type
  from public.kiro_listings l join public.kiro_profiles p on p.id = l.owner_id
  where l.status = 'active';

-- ---------- RLS ----------
alter table public.kiro_profiles enable row level security;
alter table public.kiro_listings enable row level security;
alter table public.kiro_inquiries enable row level security;
alter table public.kiro_payments enable row level security;

-- profiles: contact info of owners with active listings is public (needed for WhatsApp button)
drop policy if exists kiro_profiles_read on public.kiro_profiles;
create policy kiro_profiles_read on public.kiro_profiles for select using (
  id = (select auth.uid()) or public.kiro_is_admin()
  or exists (select 1 from public.kiro_listings l where l.owner_id = kiro_profiles.id and l.status = 'active')
);
drop policy if exists kiro_profiles_insert on public.kiro_profiles;
create policy kiro_profiles_insert on public.kiro_profiles for insert with check (id = (select auth.uid()));
drop policy if exists kiro_profiles_update on public.kiro_profiles;
create policy kiro_profiles_update on public.kiro_profiles for update using (id = (select auth.uid()) or public.kiro_is_admin());

drop policy if exists kiro_listings_read on public.kiro_listings;
create policy kiro_listings_read on public.kiro_listings for select using (
  status = 'active' or owner_id = (select auth.uid()) or public.kiro_is_admin()
);
drop policy if exists kiro_listings_insert on public.kiro_listings;
create policy kiro_listings_insert on public.kiro_listings for insert with check (owner_id = (select auth.uid()));
drop policy if exists kiro_listings_update on public.kiro_listings;
create policy kiro_listings_update on public.kiro_listings for update using (owner_id = (select auth.uid()) or public.kiro_is_admin());
drop policy if exists kiro_listings_delete on public.kiro_listings;
create policy kiro_listings_delete on public.kiro_listings for delete using (owner_id = (select auth.uid()) or public.kiro_is_admin());

drop policy if exists kiro_inquiries_insert on public.kiro_inquiries;
create policy kiro_inquiries_insert on public.kiro_inquiries for insert with check (
  exists (select 1 from public.kiro_listings l where l.id = listing_id and l.status = 'active')
);
drop policy if exists kiro_inquiries_read on public.kiro_inquiries;
create policy kiro_inquiries_read on public.kiro_inquiries for select using (
  public.kiro_is_admin() or exists (select 1 from public.kiro_listings l where l.id = listing_id and l.owner_id = (select auth.uid()))
);

drop policy if exists kiro_payments_read on public.kiro_payments;
create policy kiro_payments_read on public.kiro_payments for select using (user_id = (select auth.uid()) or public.kiro_is_admin());
drop policy if exists kiro_payments_insert on public.kiro_payments;
create policy kiro_payments_insert on public.kiro_payments for insert with check ((select auth.uid()) is not null);
drop policy if exists kiro_payments_update on public.kiro_payments;
create policy kiro_payments_update on public.kiro_payments for update using (public.kiro_is_admin());

grant select on public.kiro_public_listings to anon, authenticated;

-- ---------- Storage for photos ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('kiro-photos', 'kiro-photos', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

drop policy if exists kiro_photos_upload on storage.objects;
create policy kiro_photos_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'kiro-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists kiro_photos_delete on storage.objects;
create policy kiro_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'kiro-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
