// Shared helpers: Supabase client, router, auth, UI utilities.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { CONFIG } from './config.js';

export const sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function e(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export const djf = n => (n == null ? '—' : new Intl.NumberFormat('fr-FR').format(n) + ' FDJ');
export const fmtDate = d => (d ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
export const waLink = (num, text = '') => {
  let n = String(num || '').replace(/\D/g, '');
  if (n.length === 8) n = '253' + n; // Djibouti local numbers
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
};

export function toast(msg, type = 'ok') {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4200);
}
export function errMsg(err) {
  const m = err?.message || String(err);
  return m.replace(/^[A-Z_]+: /, '');
}

// ---------- auth ----------
export const state = { user: null, profile: null };
export async function loadSession(profileTable) {
  const { data } = await sb.auth.getSession();
  state.user = data.session?.user ?? null;
  state.profile = null;
  if (state.user) {
    const { data: p } = await sb.from(profileTable).select('*').eq('id', state.user.id).maybeSingle();
    state.profile = p;
  }
  return state;
}
export async function ensureProfile(profileTable, fields) {
  const { data, error } = await sb.from(profileTable).upsert({ id: state.user.id, ...fields }).select().single();
  if (error) throw error;
  state.profile = data;
  return data;
}

// ---------- router ----------
const routes = [];
export function route(pattern, handler) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
  routes.push({ re, keys, handler });
}
export function go(path) { location.hash = '#' + path; }
export async function render() {
  const [path, qs] = (location.hash.slice(1) || '/').split('?');
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  const view = $('#app');
  for (const r of routes) {
    const m = path.match(r.re);
    if (m) {
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      view.innerHTML = '<div class="loading">Chargement…</div>';
      try { await r.handler(view, params, query); }
      catch (err) { console.error(err); view.innerHTML = `<div class="card error">Erreur : ${e(errMsg(err))}</div>`; }
      window.scrollTo(0, 0);
      return;
    }
  }
  view.innerHTML = '<div class="card">Page introuvable. <a href="#/">Accueil</a></div>';
}
export function startRouter(onChange) {
  window.addEventListener('hashchange', async () => { onChange && onChange(); await render(); });
  onChange && onChange();
  render();
}

// ---------- forms ----------
export function formData(form) {
  const fd = new FormData(form);
  const out = {};
  for (const [k, v] of fd.entries()) {
    if (out[k] !== undefined) out[k] = [].concat(out[k], v);
    else out[k] = v;
  }
  return out;
}
export function busy(btn, on) {
  if (!btn) return;
  btn.disabled = on;
  if (on) { btn.dataset.label = btn.textContent; btn.textContent = '…'; }
  else if (btn.dataset.label) btn.textContent = btn.dataset.label;
}

// Resize an image client-side before upload (saves data for mobile users).
export async function compressImage(file, maxSide = 1600, quality = 0.8) {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * scale);
  c.height = Math.round(img.height * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return new Promise(res => c.toBlob(res, 'image/webp', quality));
}
export async function uploadPhoto(bucket, file) {
  const blob = await compressImage(file);
  const path = `${state.user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.webp`;
  const { error } = await sb.storage.from(bucket).upload(path, blob, { contentType: 'image/webp', upsert: false });
  if (error) throw error;
  return sb.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

// ---------- shared auth page ----------
export function authPage(view, { title, extraSignup = '', onDone }) {
  view.innerHTML = `
  <div class="card narrow">
    <h2>${e(title)}</h2>
    <div class="tabs"><button class="tab active" data-t="in">Connexion</button><button class="tab" data-t="up">Créer un compte</button></div>
    <form id="authForm">
      <div class="signup-only hidden">
        <label>Nom complet<input name="full_name" autocomplete="name"></label>
        <label>Téléphone<input name="phone" type="tel" placeholder="77 12 34 56"></label>
        ${extraSignup}
      </div>
      <label>Email<input name="email" type="email" required autocomplete="email"></label>
      <label>Mot de passe<input name="password" type="password" required minlength="6" autocomplete="current-password"></label>
      <button class="btn primary" type="submit">Se connecter</button>
      <p class="muted small"><a href="#" id="forgot">Mot de passe oublié ?</a></p>
    </form>
  </div>`;
  let mode = 'in';
  $$('.tab', view).forEach(b => b.onclick = () => {
    mode = b.dataset.t;
    $$('.tab', view).forEach(x => x.classList.toggle('active', x === b));
    $('.signup-only', view).classList.toggle('hidden', mode === 'in');
    $('button[type=submit]', view).textContent = mode === 'in' ? 'Se connecter' : 'Créer mon compte';
  });
  $('#forgot', view).onclick = async ev => {
    ev.preventDefault();
    const email = $('input[name=email]', view).value;
    if (!email) return toast('Entrez votre email d\'abord', 'warn');
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    toast(error ? errMsg(error) : 'Email de réinitialisation envoyé', error ? 'err' : 'ok');
  };
  $('#authForm', view).onsubmit = async ev => {
    ev.preventDefault();
    const btn = $('button[type=submit]', view); busy(btn, true);
    const f = formData(ev.target);
    try {
      if (mode === 'in') {
        const { error } = await sb.auth.signInWithPassword({ email: f.email, password: f.password });
        if (error) throw error;
      } else {
        const { data, error } = await sb.auth.signUp({
          email: f.email, password: f.password,
          options: { data: f, emailRedirectTo: location.origin + location.pathname }
        });
        if (error) throw error;
        if (!data.session) { toast('Compte créé. Vérifiez votre email pour confirmer.', 'ok'); busy(btn, false); return; }
      }
      await onDone(f);
    } catch (err) { toast(errMsg(err), 'err'); }
    busy(btn, false);
  };
}

// ---------- shared payment page ----------
export const METHODS = { dmoney: 'D-Money', waafi: 'Waafi', cac_pay: 'CAC Pay', cash: 'Espèces (en main propre)' };
export function paymentPage(view, { table, product, label, amount, extra = {}, back }) {
  const p = CONFIG.PAYMENT;
  view.innerHTML = `
  <div class="card narrow">
    <h2>Paiement — ${e(label)}</h2>
    <p class="price-big">${djf(amount)}</p>
    <ol class="steps">
      <li>Envoyez <b>${djf(amount)}</b> par mobile money :
        <ul>
          <li><b>D-Money</b> : ${e(p.dmoney)}</li>
          <li><b>Waafi</b> : ${e(p.waafi)}</li>
          <li><b>CAC Pay</b> : ${e(p.cac_pay)}</li>
        </ul>
        Nom du bénéficiaire : <b>${e(p.beneficiary)}</b>
      </li>
      <li>Copiez la <b>référence de transaction</b> reçue par SMS.</li>
      <li>Collez-la ci-dessous. Nous activons votre achat sous 2 h (8 h – 20 h).</li>
    </ol>
    <form id="payForm">
      <label>Moyen de paiement<select name="method">${Object.entries(METHODS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
      <label>Référence de transaction<input name="reference" required minlength="3" maxlength="60" placeholder="ex. TX8F3K29"></label>
      <button class="btn primary" type="submit">J'ai payé — envoyer</button>
      <a class="btn ghost" href="${e(back)}">Annuler</a>
    </form>
    <p class="muted small">Besoin d'aide ? <a target="_blank" rel="noopener" href="${waLink(p.whatsapp, 'Bonjour, question sur un paiement ' + label)}">WhatsApp</a></p>
  </div>`;
  $('#payForm', view).onsubmit = async ev => {
    ev.preventDefault();
    const btn = $('button[type=submit]', view); busy(btn, true);
    const f = formData(ev.target);
    const { error } = await sb.from(table).insert({ user_id: state.user.id, product, amount_djf: amount, method: f.method, reference: f.reference.trim(), ...extra });
    busy(btn, false);
    if (error) return toast(errMsg(error), 'err');
    toast('Paiement envoyé. Activation après vérification.');
    location.hash = back;
  };
}

// Admin: generic pending-payments table
export async function adminPayments(el, table, productLabels) {
  const { data, error } = await sb.from(table).select('*').order('created_at', { ascending: false }).limit(100);
  if (error) throw error;
  el.innerHTML = `
    <table class="tbl"><thead><tr><th>Date</th><th>Produit</th><th>Montant</th><th>Moyen</th><th>Réf.</th><th>Statut</th><th></th></tr></thead>
    <tbody>${data.map(p => `<tr>
      <td>${fmtDate(p.created_at)}</td><td>${e(productLabels[p.product] || p.product)}</td><td>${djf(p.amount_djf)}</td>
      <td>${e(METHODS[p.method])}</td><td><code>${e(p.reference)}</code></td><td><span class="badge ${p.status}">${p.status}</span></td>
      <td>${p.status === 'pending' ? `<button class="btn sm primary" data-pay="${p.id}" data-s="confirmed">Confirmer</button>
          <button class="btn sm ghost" data-pay="${p.id}" data-s="rejected">Rejeter</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">Aucun paiement</td></tr>'}
    </tbody></table>`;
  $$('[data-pay]', el).forEach(b => b.onclick = async () => {
    if (b.dataset.s === 'confirmed' && !confirm('Avez-vous vérifié la réception de cet argent sur votre compte ?')) return;
    const { error } = await sb.from(table).update({ status: b.dataset.s }).eq('id', b.dataset.pay);
    if (error) return toast(errMsg(error), 'err');
    toast('Mis à jour'); adminPayments(el, table, productLabels);
  });
}
