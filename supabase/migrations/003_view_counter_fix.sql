-- The listing guard reverted view increments made by kiro_add_view; let that function bypass it.
create or replace function public.kiro_add_view(p_listing uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('kiro.bypass', 'on', true);
  update public.kiro_listings set views = views + 1 where id = p_listing and status = 'active';
  perform set_config('kiro.bypass', 'off', true);
end $$;

create or replace function public.kiro_listing_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare live_count int;
begin
  if current_setting('kiro.bypass', true) = 'on' then return new; end if;
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
      if new.status <> old.status and new.status not in ('rented','pending') then
        new.status := old.status;
      end if;
      if old.status = 'active' and new.status = 'active' and
         (new.title, new.description, new.price_djf, new.photos) is distinct from (old.title, old.description, old.price_djf, old.photos) then
        new.status := 'pending';
      end if;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke execute on function public.kiro_listing_guard() from public, anon, authenticated;
