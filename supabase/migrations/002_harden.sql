-- Trigger functions and internal helpers must not be callable through the REST API.
revoke execute on function public.kiro_listing_guard(), public.kiro_payment_guard(), public.kiro_profile_guard(),
  public.kiro_is_pro(uuid) from public, anon, authenticated;
alter function public.kiro_price_of(text) set search_path = public;
