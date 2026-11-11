import { sb, $, $$, e, djf, fmtDate, waLink, toast, errMsg, state, loadSession, ensureProfile,
  route, go, render, startRouter, formData, busy, uploadPhoto, authPage, paymentPage, adminPayments } from './lib.js';

const DISTRICTS = ['Plateau du Serpent', 'Héron', 'Haramous', 'Centre-ville', 'Gabode', 'Salines Ouest', 'Cité Hodan',
  'Einguela', 'Arhiba', 'Ambouli', 'Cité Djebel', 'Balbala', 'PK12', 'Doraleh', 'Arta', 'Tadjourah', 'Obock', 'Ali Sabieh', 'Dikhil'];
const TYPES = { apartment: 'Appartement', villa: 'Villa', studio: 'Studio', room: 'Chambre', office: 'Bureau', shop: 'Local commercial', land: 'Terrain' };
const FEATURES = ['Climatisation', 'Groupe électrogène', 'Citerne d\'eau', 'Gardiennage', 'Parking', 'Piscine', 'Vue mer', 'Internet', 'Cuisine équipée', 'Balcon'];
const PRODUCTS = {
  featured_7d: { label: 'Annonce à la une — 7 jours', price: 3000 },
  featured_30d: { label: 'Annonce à la une — 30 jours', price: 9000 },
  pro_month: { label: 'Abonnement Pro Agence — 30 jours', price: 15000 }
};

async function refresh() { await loadSession('kiro_profiles'); paintNav(); }
function paintNav() {
  const p = state.profile;
  $('#nav').innerHTML = `
    <a href="#/">Annonces</a>
    <a href="#/tarifs">Tarifs</a>
    ${state.user ? `<a href="#/dash">Mon espace</a>${p?.is_admin ? '<a href="#/admin">Admin</a>' : ''}<a href="#" id="logout">Sortir</a>`
                 : '<a href="#/login">Connexion</a>'}
    <a class="cta" href="#/new">+ Publier</a>`;
  const lo = $('#logout'); if (lo) lo.onclick = async ev => { ev.preventDefault(); await sb.auth.signOut(); await refresh(); go('/'); };
}
function requireLogin(view) {
  if (!state.user) { go('/login'); return false; }
  if (!state.profile) { go('/profil'); return false; }
  return true;
}

function card(l) {
  const photo = l.photos?.[0];
  return `<a class="lcard" href="#/l/${l.id}">
    <div class="ph" style="${photo ? `background-image:url('${e(photo)}')` : ''}">${photo ? '' : '<span>🏠</span>'}
      ${l.featured_now ? '<span class="badge featured">★ À la une</span>' : ''}</div>
    <div class="body">
      <div class="price">${djf(l.price_djf)}<small>/${l.price_period === 'day' ? 'jour' : 'mois'}</small></div>
      <div class="ttl">${e(l.title)}</div>
      <div class="meta">${e(TYPES[l.property_type])} · ${e(l.district)}${l.bedrooms ? ` · ${l.bedrooms} ch.` : ''}${l.furnished ? ' · Meublé' : ''}</div>
    </div></a>`;
}

// ---------- Home / search ----------
route('/', async (view, _, q) => {
  view.innerHTML = `
  <section class="hero">
    <h1>Trouvez votre logement à Djibouti</h1>
    <p>Appartements, villas et bureaux vérifiés — contact direct avec le propriétaire sur WhatsApp.</p>
    <form id="search" class="row searchbar">
      <label>Quartier<select name="district"><option value="">Tous</option>${DISTRICTS.map(d => `<option ${q.district === d ? 'selected' : ''}>${e(d)}</option>`).join('')}</select></label>
      <label>Type<select name="type"><option value="">Tous</option>${Object.entries(TYPES).map(([k, v]) => `<option value="${k}" ${q.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label>Budget max (FDJ)<input name="max" type="number" min="0" step="5000" value="${e(q.max || '')}" placeholder="ex. 250000"></label>
      <label>Meublé<select name="furnished"><option value="">Peu importe</option><option value="1" ${q.furnished === '1' ? 'selected' : ''}>Oui</option><option value="0" ${q.furnished === '0' ? 'selected' : ''}>Non</option></select></label>
      <button class="btn accent" type="submit">Rechercher</button>
    </form>
  </section>
  <div id="results"><div class="loading">Chargement…</div></div>`;
  $('#search').onsubmit = ev => {
    ev.preventDefault();
    const f = formData(ev.target);
    go('/?' + new URLSearchParams(Object.entries(f).filter(([, v]) => v !== '')).toString());
  };
  let query = sb.from('kiro_public_listings').select('*')
    .order('featured_now', { ascending: false }).order('created_at', { ascending: false }).limit(60);
  if (q.district) query = query.eq('district', q.district);
  if (q.type) query = query.eq('property_type', q.type);
  if (q.max) query = query.lte('price_djf', Number(q.max));
  if (q.furnished) query = query.eq('furnished', q.furnished === '1');
  const { data, error } = await query;
  if (error) throw error;
  $('#results').innerHTML = data.length
    ? `<p class="muted">${data.length} annonce(s)</p><div class="grid">${data.map(card).join('')}</div>`
    : `<div class="card empty">Aucune annonce ne correspond. <a href="#/">Voir tout</a></div>`;
});

// ---------- Listing detail ----------
route('/l/:id', async (view, { id }) => {
  const { data: l, error } = await sb.from('kiro_public_listings').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!l) { view.innerHTML = '<div class="card">Annonce introuvable ou déjà louée.</div>'; return; }
  sb.rpc('kiro_add_view', { p_listing: id }).then(() => {}); // query builders are lazy: .then() sends it
  const msg = `Bonjour, je suis intéressé(e) par votre annonce KiroDjib : "${l.title}" (${location.href})`;
  view.innerHTML = `
  <a href="#/" class="muted">← Retour</a>
  <div class="split" style="margin-top:.6rem">
    <div>
      <div class="gallery">${(l.photos.length ? l.photos : ['']).map(p => p ? `<img src="${e(p)}" alt="" loading="lazy">` : '<div class="ph big"><span>🏠</span></div>').join('')}</div>
      <div class="card">
        ${l.featured_now ? '<span class="badge featured">★ À la une</span>' : ''}
        <h2>${e(l.title)}</h2>
        <p class="price-big">${djf(l.price_djf)} <small class="muted">/ ${l.price_period === 'day' ? 'jour' : 'mois'}</small></p>
        <p>${e(TYPES[l.property_type])} · ${e(l.district)} · ${l.bedrooms} chambre(s) · ${l.bathrooms} salle(s) de bain · ${l.furnished ? 'Meublé' : 'Non meublé'}</p>
        ${l.features.length ? `<div class="checks">${l.features.map(f => `<label>✓ ${e(f)}</label>`).join('')}</div>` : ''}
        <p style="white-space:pre-line">${e(l.description)}</p>
        <p class="muted small">Publiée le ${fmtDate(l.created_at)} · ${l.views} vues</p>
      </div>
    </div>
    <aside>
      <div class="card">
        <h3>Contacter ${l.owner_type === 'agency' ? 'l\'agence' : 'le propriétaire'}</h3>
        <p><b>${e(l.owner_name)}</b></p>
        ${l.owner_whatsapp ? `<a class="btn wa" style="width:100%" target="_blank" rel="noopener" href="${waLink(l.owner_whatsapp, msg)}">WhatsApp</a>` : ''}
        ${l.owner_phone ? `<a class="btn ghost" style="width:100%;margin:.5rem 0 0" href="tel:${e(l.owner_phone)}">Appeler ${e(l.owner_phone)}</a>` : ''}
        <hr style="border:0;border-top:1px solid var(--line);margin:1rem 0">
        <h4>Ou laissez vos coordonnées</h4>
        <form id="inq">
          <label>Votre nom<input name="name" required minlength="2"></label>
          <label>Téléphone<input name="phone" type="tel" required minlength="6"></label>
          <label>Message<textarea name="message" maxlength="1000" placeholder="Date d'entrée souhaitée, durée…"></textarea></label>
          <button class="btn primary" type="submit">Envoyer</button>
        </form>
      </div>
      <div class="card small muted">⚠️ Ne payez jamais de caution avant d'avoir visité le bien et rencontré le propriétaire.</div>
    </aside>
  </div>`;
  $('#inq').onsubmit = async ev => {
    ev.preventDefault();
    const btn = $('#inq button'); busy(btn, true);
    const { error } = await sb.from('kiro_inquiries').insert({ listing_id: id, ...formData(ev.target) });
    busy(btn, false);
    if (error) return toast(errMsg(error), 'err');
    ev.target.reset(); toast('Message envoyé au propriétaire ✔');
  };
});

// ---------- Auth & profile ----------
route('/login', async view => {
  if (state.user) return go('/dash');
  authPage(view, {
    title: 'Espace propriétaires & agences',
    extraSignup: `<label>Type de compte<select name="account_type"><option value="owner">Propriétaire particulier</option><option value="agency">Agence immobilière</option></select></label>`,
    onDone: async f => {
      await refresh();
      if (!state.profile) await ensureProfile('kiro_profiles', { full_name: f.full_name || '', phone: f.phone || '', whatsapp: f.phone || '', account_type: f.account_type || 'owner' });
      await refresh(); go('/dash');
    }
  });
});

route('/profil', async view => {
  if (!state.user) return go('/login');
  const p = state.profile || { full_name: state.user.user_metadata?.full_name || '', phone: state.user.user_metadata?.phone || '', whatsapp: state.user.user_metadata?.phone || '', account_type: state.user.user_metadata?.account_type || 'owner' };
  view.innerHTML = `<div class="card narrow"><h2>Mon profil</h2>
    <form id="pf">
      <label>Nom affiché<input name="full_name" required value="${e(p.full_name)}"></label>
      <label>Téléphone<input name="phone" required value="${e(p.phone)}"></label>
      <label>WhatsApp<input name="whatsapp" value="${e(p.whatsapp)}" placeholder="77 12 34 56"></label>
      <label>Type<select name="account_type"><option value="owner" ${p.account_type === 'owner' ? 'selected' : ''}>Propriétaire</option><option value="agency" ${p.account_type === 'agency' ? 'selected' : ''}>Agence</option></select></label>
      <button class="btn primary">Enregistrer</button>
    </form></div>`;
  $('#pf').onsubmit = async ev => {
    ev.preventDefault();
    try { await ensureProfile('kiro_profiles', formData(ev.target)); await refresh(); toast('Profil enregistré'); go('/dash'); }
    catch (err) { toast(errMsg(err), 'err'); }
  };
});

// ---------- Dashboard ----------
route('/dash', async view => {
  if (!requireLogin(view)) return;
  const p = state.profile;
  const isPro = p.plan === 'pro' && p.plan_until >= new Date().toISOString().slice(0, 10);
  const [{ data: listings }, { data: inquiries }, { data: pays }] = await Promise.all([
    sb.from('kiro_listings').select('*').eq('owner_id', p.id).order('created_at', { ascending: false }),
    sb.from('kiro_inquiries').select('*, kiro_listings!inner(title, owner_id)').eq('kiro_listings.owner_id', p.id).order('created_at', { ascending: false }).limit(50),
    sb.from('kiro_payments').select('*').eq('user_id', p.id).order('created_at', { ascending: false }).limit(20)
  ]);
  const now = new Date();
  view.innerHTML = `
  <div class="card">
    <div class="row" style="align-items:center">
      <div><h2 style="margin:0">Bonjour ${e(p.full_name)}</h2>
        <span class="muted">${isPro ? `<span class="badge pro">PRO</span> jusqu'au ${fmtDate(p.plan_until)}` : 'Compte gratuit — 2 annonces actives max.'}</span></div>
      <div style="text-align:right">
        <a class="btn primary" href="#/new">+ Nouvelle annonce</a>
        ${isPro ? '' : '<a class="btn accent" href="#/pay?product=pro_month">Passer Pro</a>'}
        <a class="btn ghost" href="#/profil">Profil</a>
      </div>
    </div>
    <div class="stats" style="margin-top:1rem">
      <div class="stat"><b>${listings.filter(l => l.status === 'active').length}</b>en ligne</div>
      <div class="stat"><b>${listings.reduce((s, l) => s + l.views, 0)}</b>vues</div>
      <div class="stat"><b>${inquiries.length}</b>demandes</div>
    </div>
  </div>
  <div class="card"><h3>Mes annonces</h3><div class="tbl-wrap"><table class="tbl">
    <thead><tr><th>Annonce</th><th>Prix</th><th>Statut</th><th>Vues</th><th></th></tr></thead>
    <tbody>${listings.map(l => {
      const feat = l.is_featured && new Date(l.featured_until) > now;
      return `<tr><td><a href="#/l/${l.id}">${e(l.title)}</a><br><span class="muted small">${e(l.district)}</span></td>
        <td>${djf(l.price_djf)}</td>
        <td><span class="badge ${l.status}">${l.status}</span> ${feat ? `<span class="badge featured">★ jusqu'au ${fmtDate(l.featured_until)}</span>` : ''}</td>
        <td>${l.views}</td>
        <td style="white-space:nowrap">
          <a class="btn sm ghost" href="#/edit/${l.id}">Modifier</a>
          ${l.status === 'active' ? `<a class="btn sm accent" href="#/pay?product=featured_7d&listing=${l.id}">★ Booster</a>
            <button class="btn sm ghost" data-rented="${l.id}">Louée</button>` : ''}
          <button class="btn sm ghost" data-del="${l.id}">✕</button></td></tr>`;
    }).join('') || '<tr><td colspan="5" class="empty">Aucune annonce. <a href="#/new">Publiez la première</a> — c\'est gratuit.</td></tr>'}</tbody></table></div>
    <p class="muted small">Les nouvelles annonces et les modifications sont vérifiées sous 24 h avant publication.</p>
  </div>
  <div class="card"><h3>Demandes reçues</h3>${inquiries.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Annonce</th><th>Nom</th><th>Téléphone</th><th>Message</th></tr></thead><tbody>
    ${inquiries.map(i => `<tr><td>${fmtDate(i.created_at)}</td><td>${e(i.kiro_listings.title)}</td><td>${e(i.name)}</td>
      <td><a href="${waLink(i.phone, 'Bonjour ' + i.name + ', suite à votre demande sur KiroDjib…')}" target="_blank" rel="noopener">${e(i.phone)}</a></td><td>${e(i.message)}</td></tr>`).join('')}
    </tbody></table></div>` : '<p class="muted">Pas encore de demandes.</p>'}</div>
  <div class="card"><h3>Mes paiements</h3>${pays.length ? `<table class="tbl"><tbody>${pays.map(x => `<tr><td>${fmtDate(x.created_at)}</td><td>${e(PRODUCTS[x.product].label)}</td><td>${djf(x.amount_djf)}</td><td><span class="badge ${x.status}">${x.status}</span></td></tr>`).join('')}</tbody></table>` : '<p class="muted">Aucun paiement.</p>'}</div>`;
  $$('[data-rented]').forEach(b => b.onclick = async () => {
    const { error } = await sb.from('kiro_listings').update({ status: 'rented' }).eq('id', b.dataset.rented);
    error ? toast(errMsg(error), 'err') : (toast('Marquée comme louée'), render());
  });
  $$('[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('Supprimer définitivement cette annonce ?')) return;
    const { error } = await sb.from('kiro_listings').delete().eq('id', b.dataset.del);
    error ? toast(errMsg(error), 'err') : (toast('Supprimée'), render());
  });
});

// ---------- Create / edit listing ----------
async function listingForm(view, existing) {
  if (!requireLogin(view)) return;
  const l = existing || { title: '', description: '', property_type: 'apartment', furnished: false, bedrooms: 2, bathrooms: 1, price_djf: '', price_period: 'month', district: '', features: [], photos: [] };
  let photos = [...l.photos];
  view.innerHTML = `<div class="card" style="max-width:760px;margin:auto">
    <h2>${existing ? 'Modifier l\'annonce' : 'Publier une annonce'}</h2>
    <form id="lf">
      <label>Titre<input name="title" required minlength="5" maxlength="120" value="${e(l.title)}" placeholder="ex. F3 meublé climatisé à Haramous"></label>
      <div class="row">
        <label>Type<select name="property_type">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}" ${l.property_type === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label>Quartier<select name="district" required><option value="">—</option>${DISTRICTS.map(d => `<option ${l.district === d ? 'selected' : ''}>${e(d)}</option>`).join('')}</select></label>
      </div>
      <div class="row">
        <label>Loyer (FDJ)<input name="price_djf" type="number" required min="1" value="${e(l.price_djf)}"></label>
        <label>Par<select name="price_period"><option value="month" ${l.price_period === 'month' ? 'selected' : ''}>mois</option><option value="day" ${l.price_period === 'day' ? 'selected' : ''}>jour</option></select></label>
        <label>Chambres<input name="bedrooms" type="number" min="0" max="20" value="${e(l.bedrooms)}"></label>
        <label>Salles de bain<input name="bathrooms" type="number" min="0" max="20" value="${e(l.bathrooms)}"></label>
      </div>
      <label><input type="checkbox" name="furnished" ${l.furnished ? 'checked' : ''} style="width:auto"> Meublé</label>
      <label>Équipements</label>
      <div class="checks">${FEATURES.map(f => `<label><input type="checkbox" name="features" value="${e(f)}" ${l.features.includes(f) ? 'checked' : ''}> ${e(f)}</label>`).join('')}</div>
      <label>Description<textarea name="description" maxlength="3000">${e(l.description)}</textarea></label>
      <label>Photos (max. 8)<input type="file" id="files" accept="image/*" multiple></label>
      <div id="thumbs" class="thumbs"></div>
      <button class="btn primary" type="submit">${existing ? 'Enregistrer' : 'Publier'}</button>
      <a class="btn ghost" href="#/dash">Annuler</a>
    </form></div>`;
  const paintThumbs = () => {
    $('#thumbs').innerHTML = photos.map((p, i) => `<div><img src="${e(p)}" alt=""><button type="button" data-rm="${i}">✕</button></div>`).join('');
    $$('[data-rm]').forEach(b => b.onclick = () => { photos.splice(+b.dataset.rm, 1); paintThumbs(); });
  };
  paintThumbs();
  $('#files').onchange = async ev => {
    const files = [...ev.target.files].slice(0, 8 - photos.length);
    for (const f of files) {
      try { toast('Envoi de la photo…'); photos.push(await uploadPhoto('kiro-photos', f)); paintThumbs(); }
      catch (err) { toast(errMsg(err), 'err'); }
    }
    ev.target.value = '';
  };
  $('#lf').onsubmit = async ev => {
    ev.preventDefault();
    const btn = $('#lf button[type=submit]'); busy(btn, true);
    const f = formData(ev.target);
    const row = {
      title: f.title, description: f.description, property_type: f.property_type, district: f.district,
      price_djf: Number(f.price_djf), price_period: f.price_period, bedrooms: Number(f.bedrooms || 0), bathrooms: Number(f.bathrooms || 0),
      furnished: !!f.furnished, features: [].concat(f.features || []), photos
    };
    const q = existing
      ? sb.from('kiro_listings').update({ ...row, status: existing.status === 'rejected' ? 'pending' : existing.status }).eq('id', existing.id)
      : sb.from('kiro_listings').insert({ ...row, owner_id: state.user.id });
    const { error } = await q;
    busy(btn, false);
    if (error) {
      if (error.message.includes('FREE_LIMIT')) { toast(errMsg(error), 'warn'); return go('/tarifs'); }
      return toast(errMsg(error), 'err');
    }
    toast(existing ? 'Modifications envoyées pour vérification' : 'Annonce envoyée ! Elle sera en ligne après vérification.');
    go('/dash');
  };
}
route('/new', view => listingForm(view));
route('/edit/:id', async (view, { id }) => {
  const { data, error } = await sb.from('kiro_listings').select('*').eq('id', id).single();
  if (error) throw error;
  return listingForm(view, data);
});

// ---------- Pricing & payments ----------
route('/tarifs', async view => {
  view.innerHTML = `<div class="card"><h2>Tarifs</h2>
  <div class="plans">
    <div class="plan"><h3>Gratuit</h3><p class="price-big">0 FDJ</p><ul><li>2 annonces actives</li><li>Contact WhatsApp direct</li><li>Statistiques de vues</li></ul><a class="btn ghost" href="#/new">Publier</a></div>
    <div class="plan"><h3>À la une</h3><p class="price-big">3 000 FDJ <small class="muted">/ 7 j</small></p><ul><li>En tête des résultats</li><li>Badge ★ doré</li><li>9 000 FDJ pour 30 jours</li></ul><a class="btn accent" href="#/dash">Booster une annonce</a></div>
    <div class="plan best"><h3>Pro Agence</h3><p class="price-big">15 000 FDJ <small class="muted">/ mois</small></p><ul><li>Annonces illimitées</li><li>Badge agence</li><li>Tableau des demandes</li></ul><a class="btn primary" href="#/pay?product=pro_month">Devenir Pro</a></div>
  </div></div>`;
});
route('/pay', async (view, _, q) => {
  if (!requireLogin(view)) return;
  const prod = PRODUCTS[q.product];
  if (!prod) return go('/tarifs');
  if (q.product.startsWith('featured') && !q.listing) return go('/dash');
  let product = q.product;
  paymentPage(view, { table: 'kiro_payments', product, label: prod.label, amount: prod.price, extra: q.listing ? { listing_id: q.listing } : {}, back: '#/dash' });
  if (q.listing) {
    const sel = document.createElement('label');
    sel.innerHTML = `Durée<select id="dur"><option value="featured_7d">7 jours — 3 000 FDJ</option><option value="featured_30d" ${product === 'featured_30d' ? 'selected' : ''}>30 jours — 9 000 FDJ</option></select>`;
    $('#payForm').prepend(sel);
    $('#dur').onchange = ev => go(`/pay?product=${ev.target.value}&listing=${q.listing}`);
  }
});

// ---------- Admin ----------
route('/admin', async view => {
  if (!state.profile?.is_admin) { view.innerHTML = '<div class="card">Accès réservé.</div>'; return; }
  view.innerHTML = `<div class="card"><h2>Administration</h2>
    <div class="tabs"><button class="tab active" data-t="mod">Modération</button><button class="tab" data-t="pay">Paiements</button></div>
    <div id="adm"></div></div>`;
  const show = async t => {
    $$('.tab', view).forEach(b => b.classList.toggle('active', b.dataset.t === t));
    const el = $('#adm');
    if (t === 'pay') return adminPayments(el, 'kiro_payments', Object.fromEntries(Object.entries(PRODUCTS).map(([k, v]) => [k, v.label])));
    const { data, error } = await sb.from('kiro_listings').select('*, kiro_profiles(full_name, phone)').eq('status', 'pending').order('created_at');
    if (error) throw error;
    el.innerHTML = data.length ? data.map(l => `<div class="card" style="box-shadow:none;border:1px solid var(--line)">
      <div class="row"><div style="flex:3"><b>${e(l.title)}</b> — ${djf(l.price_djf)} · ${e(l.district)}<br>
      <span class="muted small">${e(l.kiro_profiles?.full_name)} · ${e(l.kiro_profiles?.phone)} · ${fmtDate(l.created_at)}</span>
      <p class="small">${e(l.description).slice(0, 400)}</p>
      <div class="thumbs">${l.photos.map(p => `<div><img src="${e(p)}" alt=""></div>`).join('')}</div></div>
      <div style="flex:1;text-align:right"><button class="btn sm primary" data-mod="${l.id}" data-s="active">Approuver</button>
      <button class="btn sm ghost" data-mod="${l.id}" data-s="rejected">Rejeter</button></div></div></div>`).join('')
      : '<p class="empty">Rien à modérer 🎉</p>';
    $$('[data-mod]', el).forEach(b => b.onclick = async () => {
      const { error } = await sb.from('kiro_listings').update({ status: b.dataset.s }).eq('id', b.dataset.mod);
      error ? toast(errMsg(error), 'err') : (toast('OK'), show('mod'));
    });
  };
  $$('.tab', view).forEach(b => b.onclick = () => show(b.dataset.t));
  show('mod');
});

sb.auth.onAuthStateChange(async (ev) => { if (ev === 'SIGNED_IN' || ev === 'SIGNED_OUT') { await refresh(); } });
await refresh();
startRouter();
