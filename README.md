# KiroDjib: rental listings marketplace for Djibouti

Apartments, villas, studios and offices for rent. Tenants (expats, NGO and embassy staff, base contractors, families) search by district, type and budget, then contact the owner directly on WhatsApp.

**Features**
- Search by district, type, budget and furnished
- Listing pages with photo gallery, WhatsApp button and enquiry form
- Owner/agency dashboard: listings, views, enquiries received, payments
- Photo upload, compressed in the browser (saves mobile data)
- Moderation: every new or edited listing is reviewed by the admin before it goes live
- Admin panel: approve or reject listings, confirm payments

**Revenue built in**

| Product | Price | Effect |
|---|---|---|
| Featured listing, 7 days | 3,000 FDJ | Top of results + gold ★ badge |
| Featured listing, 30 days | 9,000 FDJ | Same |
| Pro Agency, per month | 15,000 FDJ | Unlimited listings (free accounts get 2) |

## Run it

The site is plain HTML/JS with no build step, so it runs on any static host.

```bash
# local preview
python3 -m http.server 8080   # then open http://localhost:8080
```

**Free hosting:** GitHub repo → Settings → Pages → Deploy from branch `main` / root. Netlify or Cloudflare Pages also work (drag and drop the folder).

## Backend (Supabase)

The backend is already live in the Supabase project **djib-ventures** (`xqqgmxtzbuprdjillpof`, Paris region), which `config.js` points to. To recreate it elsewhere, run the files in `supabase/migrations/` in order in the SQL editor of a new project and update `config.js`.

The browser only gets the publishable key. Every rule lives in Postgres: Row Level Security policies, plus triggers that stop users from approving their own content, giving themselves paid features or editing prices.

## Before launch

1. **Payment numbers:** put your real D-Money / Waafi / CAC Pay merchant numbers and WhatsApp in `config.js`.
2. **Make yourself admin:** sign up on the site, then run this in the Supabase SQL editor:
   ```sql
   set session_replication_role = replica;  -- skip the guard trigger for this one admin change
   update public.kiro_profiles set is_admin = true
   where id = (select id from auth.users where email = 'you@example.com');
   set session_replication_role = origin;
   ```
   An **Admin** link appears in the menu after you log in again.
3. **Auth emails:** Supabase → Authentication → URL Configuration: set the Site URL to your live domain. For more than a few sign-ups an hour, add your own SMTP server (Brevo and Resend have free plans).
4. **Domain:** buy a `.dj` domain or a cheap `.com` and point it at GitHub Pages.

## How payments work (v1)

The customer sends mobile money, then pastes the transaction reference. You check it on your phone and click **Confirm** in Admin, and the database applies the purchase automatically. This works on day one with no merchant API contract. Once volume justifies it, replace this step with the D-Money or Waafi merchant API.

