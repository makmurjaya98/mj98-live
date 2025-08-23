// js/kartu-tagihan.js — Halaman Kartu Tagihan (Link, Cabang, Mitra)
// Selaras dengan laporan.js:
// - Range waktu: [from >=, to <) (akhir hari eksklusif)
// - Sumber sales: audit_sales_mj98 (pend_*_calc) -> fallback sales (pendapatan_*)
// - Tagihan: Link   = total_jual - pend_link
//            Cabang = total_jual - (pend_link + pend_cabang)
//            Mitra  = total_jual - (pend_link + pend_cabang + pend_mitra)
// - Setoran Link: hanya untuk link yang muncul di SALES pada periode + filter aktif
// - Setoran Cabang/Mitra: by cabang_id / mitracabang_id (tanpa filter status/role)

'use strict';

import { supabase, getProfile, orgIdOf, explainSupabaseError } from './supabase-init.js';

/* ===== Utilities ===== */
const $  = (s, el=document) => el.querySelector(s);
const $$ = (s, el=document) => Array.from(el.querySelectorAll(s));
const toRp = (n) => "Rp " + Number(n || 0).toLocaleString("id-ID");
const esc = (x)=> String(x ?? '').replace(/[&<>"']/g,m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
const pad=(n)=>String(n).padStart(2,'0');
const ymd=(d)=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const sum=(arr,p=(x)=>x)=> (arr||[]).reduce((a,b)=>a+Number(p(b)||0),0);

function toRangeISO(fromYMD, toYMD){
  // Asia/Makassar (+08). Batas atas eksklusif (akhir hari + 1 ms)
  const start = new Date(`${fromYMD}T00:00:00.000+08:00`);
  const end   = new Date(`${toYMD}T23:59:59.999+08:00`);
  return { fromISO: start.toISOString(), toISO: new Date(end.getTime()+1).toISOString() };
}
function show(el){ el && el.classList.remove('hidden'); }
function hide(el){ el && el.classList.add('hidden'); }
function paint(cardId, { tagihan, setoran, sisa }){
  const card = $(`#${cardId}`); if(!card) return;
  const elTagihan = card.querySelector('[id$="tagihan"]');
  const elSetoran = card.querySelector('[id$="setoran"]');
  const elSisa    = card.querySelector('[id$="sisa"]');
  const pillId = cardId.replace('card-','')+'-pill';
  const pill = document.getElementById(pillId) || card.querySelector('.pill');
  if (elTagihan) elTagihan.textContent = toRp(tagihan);
  if (elSetoran) elSetoran.textContent = toRp(setoran);
  if (elSisa)    elSisa.textContent    = toRp(sisa);
  const need = Number(sisa||0) > 0.000001;
  if (pill) pill.classList.toggle('hidden', !need);
  card.classList.toggle('alert', need);
}
const isMitraRole = (r)=> r==='mitra-cabang' || r==='mitracabang';

/* ===== Global state ===== */
let gProf=null, gOwner=null;
let gRange={ fromISO:null, toISO:null };

/* ===== INIT ===== */
window.addEventListener('DOMContentLoaded', init);

async function init(){
  try{
    gProf = await getProfile('id, role, owner_id, mitracabang_id, cabang_id, username');
    if (!gProf){ location.href='index.html'; return; }
    gOwner = orgIdOf(gProf);

    // default 7 hari terakhir
    const dTo = new Date();
    const dFrom = new Date(); dFrom.setDate(dTo.getDate()-7);
    $('#from')?.setAttribute('value', ymd(dFrom));
    $('#to')  ?.setAttribute('value', ymd(dTo));

    await setupHierarchyFilters();

    $('#print') ?.addEventListener('click', ()=>window.print());
    $('#logout')?.addEventListener('click', ()=> import('./supabase-init.js').then(m=>m.signOutAndRedirect?.()));

    $('#filterForm')?.addEventListener('submit', (e)=>{ e.preventDefault(); refresh(); });
    ['#from','#to','#fltMitra','#fltCabang','#fltLink'].forEach(sel=>{
      const el = $(sel); el && el.addEventListener('change', refresh);
    });

    await refresh();
  }catch(e){
    console.error(e);
    alert(explainSupabaseError(e) || e.message || 'Init gagal');
  }
}

/* ===== Dropdowns (role-aware) ===== */
async function setupHierarchyFilters(){
  const role = String(gProf.role||'').toLowerCase();

  ['#wrapMitra','#wrapCabang','#wrapLink'].forEach(id=>{ const el=$(id); if (el) el.style.display='none'; });

  if (role==='owner' || role==='admin'){
    await populateMitraOptions();
    await populateCabangOptions();
    await populateLinkOptions();
    ['#wrapMitra','#wrapCabang','#wrapLink'].forEach(id=>{ const el=$(id); if (el) el.style.display=''; });
    return;
  }

  if (isMitraRole(role)){
    const selM = $('#fltMitra');
    if (selM){ selM.innerHTML = `<option value="${gProf.mitracabang_id || gProf.id}">${esc(gProf.username)} (Mitra)</option>`; selM.disabled = true; }
    await populateCabangOptions(gProf.mitracabang_id || gProf.id);
    await populateLinkOptions();
    ['#wrapCabang','#wrapLink'].forEach(id=>{ const el=$(id); if (el) el.style.display=''; });
    return;
  }

  if (role==='cabang'){
    const selM = $('#fltMitra'); const selC = $('#fltCabang');
    if (selM){
      const { data:m } = await supabase.from('profiles').select('id,username').eq('id', gProf.mitracabang_id).maybeSingle();
      selM.innerHTML = `<option value="${esc(gProf.mitracabang_id || '')}">${esc(m?.username || '(Mitra)')}</option>`;
      selM.disabled = true;
    }
    if (selC){ selC.innerHTML = `<option value="${gProf.cabang_id || gProf.id}">${esc(gProf.username)} (Cabang)</option>`; selC.disabled = true; }
    await populateLinkOptions();
    $('#wrapLink').style.display='';
    return;
  }

  if (role==='link'){
    const selL = $('#fltLink');
    if (selL){ selL.innerHTML = `<option value="${gProf.id}">${esc(gProf.username)} (Link)</option>`; selL.disabled = true; }
  }
}

async function populateMitraOptions(){
  const sel=$('#fltMitra'); if(!sel) return;
  const { data, error } = await supabase.from('profiles')
    .select('id,username').eq('owner_id', gOwner)
    .in('role',['mitra-cabang','mitracabang'])
    .order('username',{ascending:true});
  if (error){ sel.innerHTML = `<option value="">(Semua Mitra)</option>`; return; }
  sel.innerHTML = [`<option value="">(Semua Mitra)</option>`]
    .concat((data||[]).map(x=>`<option value="${x.id}">${esc(x.username)}</option>`)).join('');
}
async function populateCabangOptions(fixedMitraId){
  const sel=$('#fltCabang'); if(!sel) return;
  let q = supabase.from('profiles')
    .select('id,username,mitracabang_id,owner_id')
    .eq('role','cabang').eq('owner_id', gOwner).order('username',{ascending:true});
  const mid = fixedMitraId ?? ($('#fltMitra')?.value || null);
  if (mid) q=q.eq('mitracabang_id', mid);
  const { data, error } = await q;
  if (error){ sel.innerHTML = `<option value="">(Semua Cabang)</option>`; return; }
  sel.innerHTML = [`<option value="">(Semua Cabang)</option>`]
    .concat((data||[]).map(x=>`<option value="${x.id}">${esc(x.username)}</option>`)).join('');
}
async function populateLinkOptions(){
  const sel=$('#fltLink'); if(!sel) return;
  let q = supabase.from('profiles')
    .select('id,username,owner_id,mitracabang_id,cabang_id')
    .eq('role','link').eq('owner_id', gOwner).order('username',{ascending:true});
  const mid = $('#fltMitra')?.value || null;
  const cid = $('#fltCabang')?.value || null;
  if (mid) q=q.eq('mitracabang_id', mid);
  if (cid) q=q.eq('cabang_id', cid);
  const { data, error } = await q;
  if (error){ sel.innerHTML = `<option value="">(Semua Link)</option>`; return; }
  sel.innerHTML = [`<option value="">(Semua Link)</option>`]
    .concat((data||[]).map(x=>`<option value="${x.id}">${esc(x.username)}</option>`)).join('');
}

/* ===== Data helpers ===== */

// Ambil agregat sales + daftar link_id dari transaksi (untuk filter setoran LINK)
async function fetchSalesAggAndLinks(where, fromISO, toISO){
  // 1) view audit (selaras laporan.js)
  try{
    let qa = supabase.from('audit_sales_mj98').select(`
      link_id, total_jual, pend_link_calc, pend_cabang_calc, pend_mitra_calc, created_at
    `).gte('created_at', fromISO).lt('created_at', toISO);
    for (const [k,v] of Object.entries(where)) if (v!=null) qa=qa.eq(k,v);
    const { data, error } = await qa;
    if (!error && data){
      const linkIds = [...new Set(data.map(r=>r.link_id).filter(Boolean))];
      return {
        total_jual: sum(data, r=>r.total_jual),
        p_link:     sum(data, r=>r.pend_link_calc),
        p_cabang:   sum(data, r=>r.pend_cabang_calc),
        p_mitra:    sum(data, r=>r.pend_mitra_calc),
        linkIds
      };
    }
  }catch(_e){/* fallback */ }

  // 2) fallback ke tabel sales
  let qs = supabase.from('sales')
    .select('link_id,total_jual,pendapatan_link,pendapatan_cabang,pendapatan_mitracabang,created_at')
    .gte('created_at', fromISO).lt('created_at', toISO);
  for (const [k,v] of Object.entries(where)) if (v!=null) qs=qs.eq(k,v);
  const { data, error } = await qs;
  if (error){ console.error('fetchSalesAggAndLinks', error); return { total_jual:0, p_link:0, p_cabang:0, p_mitra:0, linkIds:[] }; }
  const linkIds = [...new Set((data||[]).map(r=>r.link_id).filter(Boolean))];
  return {
    total_jual: sum(data, r=>r.total_jual),
    p_link:     sum(data, r=>r.pendapatan_link),
    p_cabang:   sum(data, r=>r.pendapatan_cabang),
    p_mitra:    sum(data, r=>r.pendapatan_mitracabang),
    linkIds
  };
}

/** Ambil setoran untuk periode saat ini.
 *  - Tidak menyaring 'status' / 'depositor_role' (disamakan dengan laporan.js).
 *  - Tanggal: pakai 'tanggal_setor' kalau ada; jika tidak, 'created_at'.
 *  - Bisa filter: owner_id / mitracabang_id / cabang_id / link_id atau link_ids (array).
 */
async function fetchDepositSumSmart(where, fromISO, toISO){
  // builder aman terhadap kolom opsional
  const build = (cols) => {
    let q = supabase.from('deposits').select(cols);
    if (where.owner_id != null)       q = q.eq('owner_id', where.owner_id);
    if (where.mitracabang_id != null) q = q.eq('mitracabang_id', where.mitracabang_id);
    if (where.cabang_id != null)      q = q.eq('cabang_id', where.cabang_id);
    if (Array.isArray(where.link_ids) && where.link_ids.length){
      q = q.in('link_id', where.link_ids);
    } else if (where.link_id != null){
      q = q.eq('link_id', where.link_id);
    }
    return q;
  };

  let data, error;
  // coba kolom lengkap
  ({ data, error } = await build('amount,tanggal_setor,created_at,owner_id,mitracabang_id,cabang_id,link_id'));
  if (error){
    ({ data, error } = await build('amount,created_at,owner_id,mitracabang_id,cabang_id,link_id'));
    if (error){ console.warn('fetchDepositSumSmart fallback error', error); return 0; }
  }

  const hasTanggal = !!(data?.[0] && Object.prototype.hasOwnProperty.call(data[0],'tanggal_setor'));
  const lo = new Date(fromISO).getTime();
  const hi = new Date(toISO).getTime(); // eksklusif

  return sum(
    (data||[]).filter(d=>{
      const t = hasTanggal && d.tanggal_setor ? Date.parse(d.tanggal_setor)
               : (d.created_at ? Date.parse(d.created_at) : NaN);
      return Number.isFinite(t) && t>=lo && t<hi;
    }),
    d=>d.amount
  );
}

/* ===== Compute each card ===== */
async function computeLinkCard(){
  const role = String(gProf.role||'').toLowerCase();
  const linkId = (role==='link') ? gProf.id : ($('#fltLink')?.value || null);
  const card = $('#card-link'); if (!card) return; show(card);

  const whereSales = { owner_id: gOwner };
  // kalau pilih link -> langsung eq link, kalau tidak: hormati filter cabang/mitra
  if (linkId) whereSales.link_id = linkId;
  else {
    const cid = $('#fltCabang')?.value || null;
    const mid = $('#fltMitra')?.value || null;
    if (cid) whereSales.cabang_id = cid;
    if (mid) whereSales.mitracabang_id = mid;
  }

  const sales = await fetchSalesAggAndLinks(whereSales, gRange.fromISO, gRange.toISO);
  const tagihan = Number(sales.total_jual||0) - Number(sales.p_link||0);

  // SETORAN LINK: ikut link yang benar-benar ada di SALES periode ini
  const depWhere = { owner_id:gOwner };
  if (linkId) depWhere.link_id = linkId;
  else depWhere.link_ids = sales.linkIds; // penting: hanya link yang ada transaksinya
  const setoran = sales.linkIds.length || linkId ? await fetchDepositSumSmart(depWhere, gRange.fromISO, gRange.toISO) : 0;

  const sisa = Math.max(0, tagihan - setoran);
  paint('card-link', { tagihan, setoran, sisa });
}

async function computeCabangCard(){
  const role = String(gProf.role||'').toLowerCase();
  const cabangId = (role==='cabang') ? (gProf.cabang_id || gProf.id) : ($('#fltCabang')?.value || null);
  const card = $('#card-cabang'); if (!card) return;

  if (!cabangId && !(isMitraRole(role) || role==='owner' || role==='admin')){ hide(card); return; }
  show(card);

  const whereSales = { owner_id:gOwner, ...(cabangId ? {cabang_id:cabangId} : {}) };
  if (!cabangId){
    const mid = $('#fltMitra')?.value || null;
    if (mid) whereSales.mitracabang_id = mid;
  }

  const sales = await fetchSalesAggAndLinks(whereSales, gRange.fromISO, gRange.toISO);
  const tagihan = Number(sales.total_jual||0) - (Number(sales.p_link||0)+Number(sales.p_cabang||0));

  // SETORAN CABANG -> sum by cabang_id (tanpa role/status)
  const depWhere = { owner_id:gOwner, ...(cabangId ? {cabang_id:cabangId} : {}) };
  if (!cabangId){
    const mid = $('#fltMitra')?.value || null;
    if (mid) depWhere.mitracabang_id = mid;
  }
  const setoran = await fetchDepositSumSmart(depWhere, gRange.fromISO, gRange.toISO);

  const sisa = Math.max(0, tagihan - setoran);
  paint('card-cabang', { tagihan, setoran, sisa });
}

async function computeMitraCard(){
  const role = String(gProf.role||'').toLowerCase();
  const mitraId = isMitraRole(role) ? (gProf.mitracabang_id || gProf.id) : ($('#fltMitra')?.value || null);
  const card = $('#card-mitra'); if (!card) return;

  const allowed = isMitraRole(role) || role==='owner' || role==='admin';
  if (!allowed){ hide(card); return; }
  if (!mitraId && (role==='owner'||role==='admin')){ hide(card); return; }
  show(card);

  const whereSales = { owner_id:gOwner, mitracabang_id: mitraId };
  const sales = await fetchSalesAggAndLinks(whereSales, gRange.fromISO, gRange.toISO);
  const tagihan = Number(sales.total_jual||0) - (Number(sales.p_link||0)+Number(sales.p_cabang||0)+Number(sales.p_mitra||0));

  // SETORAN MITRA -> sum by mitracabang_id (tanpa role/status)
  const setoran = await fetchDepositSumSmart({ owner_id:gOwner, mitracabang_id: mitraId }, gRange.fromISO, gRange.toISO);

  const sisa = Math.max(0, tagihan - setoran);
  paint('card-mitra', { tagihan, setoran, sisa });
}

/* ===== Refresh ===== */
async function refresh(){
  const f = $('#from')?.value, t = $('#to')?.value;
  const fromYMD = f || ymd(new Date(Date.now()-6*86400000));
  const toYMD   = t || ymd(new Date());
  gRange = toRangeISO(fromYMD, toYMD);

  await Promise.allSettled([
    computeLinkCard(),
    computeCabangCard(),
    computeMitraCard(),
  ]);
}
