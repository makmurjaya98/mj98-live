// js/global-alert.js — MJ98
'use strict';

/* =========================================================
 * Supabase client
 * =======================================================*/
import { supabase as __supabase } from './supabase-init.js';
const supabase = globalThis.__mj98Supabase || __supabase;

/* =========================================================
 * Util
 * =======================================================*/
const fmtRp = (n)=> 'Rp ' + Number(n||0).toLocaleString('id-ID');
const esc   = (s='') => String(s).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;' }[m]));
const fmtTime = (d) => d ? new Date(d).toLocaleString('id-ID') : '';
function el(html){ const d=document.createElement('div'); d.innerHTML=html.trim(); return d.firstElementChild; }

// Local Y-M-D (hindari mundur 1 hari karena UTC)
const todayYMD = () => {
  const dt=new Date();
  dt.setMinutes(dt.getMinutes()-dt.getTimezoneOffset());
  return dt.toISOString().slice(0,10);
};

/* =========================================================
 * Auth & role helpers
 * =======================================================*/
async function getMe(){
  try{
    const { data:{ session } } = await supabase.auth.getSession();
    if (!session) return null;
    const { data, error } = await supabase
      .from('profiles')
      .select('id, username, role, owner_id, mitracabang_id, cabang_id')
      .eq('id', session.user.id)
      .maybeSingle();
    if (error) return null;
    return data || null;
  }catch{ return null; }
}
const roleLower   = (r)=> String(r||'').toLowerCase();
const isMitraRole = (r)=> ['mitra-cabang','mitracabang'].includes(roleLower(r));

/** Halaman login/register/publik? (jangan tampilkan alert apapun di sini) */
function isAuthLikePage(){
  const p = (location.pathname||'').toLowerCase();
  const t = (document.title||'').toLowerCase();
  const cls = document.body?.className || '';
  return (
    /(^|\/)(index|login|register)\.html$/.test(p) ||
    t.includes('login') || t.includes('daftar') || t.includes('register') ||
    /\bpage-login\b/.test(cls) || /\bpage-register\b/.test(cls) ||
    !!document.querySelector('#regForm, #registerForm, form[action*="login"]')
  );
}

function scopeFilter(me){
  const role = roleLower(me?.role);
  if (role==='owner' || role==='admin') return { owner_id: me.id || me.owner_id };
  if (isMitraRole(role))                return { mitracabang_id: me.id };
  if (role==='cabang')                  return { cabang_id: me.id };
  if (role==='link')                    return { link_id: me.id };
  return {};
}

/* =========================================================
 * A) ALERT SISA SETORAN
 * =======================================================*/
async function getLinksInScope(me){
  const f = scopeFilter(me);
  let q = supabase
    .from('profiles')
    .select('id, username, owner_id, mitracabang_id, cabang_id')
    .eq('role','link')
    .limit(2000);
  for (const k of Object.keys(f)) q = q.eq(k, f[k]);
  const { data, error } = await q;
  if (error) return [];
  return data||[];
}

async function sumSalesTagihanByLink(linkIds){
  if (!linkIds.length) return new Map();
  const { data, error } = await supabase
    .from('sales')
    .select('link_id,total_jual,pendapatan_link')
    .in('link_id', linkIds)
    .limit(50000);
  if (error) return new Map();
  const map = new Map();
  for (const r of (data||[])){
    const k = r.link_id; if (!k) continue;
    const tagih = Number(r.total_jual||0) - Number(r.pendapatan_link||0);
    map.set(k, (map.get(k)||0)+tagih);
  }
  return map;
}

async function sumDepositsByLink(linkIds){
  if (!linkIds.length) return new Map();
  const { data, error } = await supabase
    .from('deposits')
    .select('link_id, amount')
    .in('link_id', linkIds)
    .limit(50000);
  if (error) return new Map();
  const map = new Map();
  for (const r of (data||[])){
    const k = r.link_id; if (!k) continue;
    map.set(k, (map.get(k)||0) + Number(r.amount||0));
  }
  return map;
}

async function buildDebtAllTime(me){
  const links = await getLinksInScope(me);
  const linkIds = links.map(l=>l.id);
  const [tagihanMap, setorMap] = await Promise.all([
    sumSalesTagihanByLink(linkIds),
    sumDepositsByLink(linkIds)
  ]);
  const out = [];
  for (const l of links){
    const tagihan = Number(tagihanMap.get(l.id)||0);
    const disetor = Number(setorMap.get(l.id)||0);
    const sisa = Math.max(tagihan - disetor, 0);
    if (sisa>0) out.push({ link_id:l.id, username:l.username, sisa_setoran:sisa });
  }
  out.sort((a,b)=> b.sisa_setoran - a.sisa_setoran);
  return out;
}

/** Tempel KARTU sisa setoran di atas konten, lebarnya sama seperti .container */
function mountSetoranContainer(){
  // cari container utama konten
  const inner = document.querySelector('.content .container') || document.querySelector('main .container');
  const parent = inner?.parentElement || document.querySelector('main') || document.body;
  if (!parent) return null;

  // sudah ada?
  const existing = document.getElementById('mj98-setoran-wrap');
  if (existing) return existing;

  // bungkus pakai .container agar width seragam
  const wrap = el(`<div id="mj98-setoran-wrap" class="container" style="margin-top:14px"></div>`);
  const card = el(`
    <section id="mj98-setoran-alert" class="card"
      style="background:#fff4dc;border-color:#f7c66b">
      <div style="display:flex;align-items:center;gap:10px;justify-content:space-between;flex-wrap:wrap">
        <div>
          <b>⚠️ Sisa Setoran (Tunggakan)</b>
          <div id="mj98-alert-sub" style="font-size:12px;opacity:.75">Link dengan sisa setoran tertinggi:</div>
        </div>
        <div style="display:flex;gap:8px">
          <button id="mj98-alert-hide" class="btn" style="background:#fef08a">Sembunyikan</button>
          <a id="mj98-alert-open-setoran" class="btn" style="background:#60A5FA;color:#0a2345" href="setoran.html">Buka Setoran</a>
        </div>
      </div>
      <div id="mj98-alert-list" class="mt-12"
        style="display:grid;grid-template-columns: repeat(auto-fit, minmax(220px,1fr)); gap:8px;"></div>
    </section>
  `);
  wrap.appendChild(card);

  // sisipkan wrap DI ATAS container utama
  if (inner) parent.insertBefore(wrap, inner);
  else parent.prepend(wrap);

  card.querySelector('#mj98-alert-hide')?.addEventListener('click', ()=> wrap.style.display='none');
  return wrap;
}

function renderSetoranRows(node, rows){
  const list = node.querySelector('#mj98-alert-list');
  if (!rows.length){ list.innerHTML=''; return; }
  list.innerHTML = rows.slice(0,8).map(r=>`
    <div class="card" style="padding:10px">
      <div style="font-weight:700">${esc(r.username || r.link_id)}</div>
      <div style="font-size:12px;opacity:.75">Sisa setoran</div>
      <div style="font-weight:800">${fmtRp(r.sisa_setoran)}</div>
      <div class="mt-8">
        <a class="btn" href="setoran.html?link_id=${encodeURIComponent(r.link_id)}"
           style="background:#60A5FA;color:#0a2345">Tagih</a>
      </div>
    </div>
  `).join('');
}

/** API Sisa Setoran */
export async function initGlobalSetoranAlert(){
  try{
    if (!supabase) return;
    if (isAuthLikePage()) return; // jangan di login/register
    const me = await getMe(); if (!me) return;
    const rows = await buildDebtAllTime(me);
    if (!rows?.some(r => Number(r.sisa_setoran||0) > 0)) return;
    const wrap = mountSetoranContainer(); if (!wrap) return;
    renderSetoranRows(wrap, rows);
  }catch(err){
    console.debug('[setoran-alert] skip:', err?.message || err);
  }
}

/* =========================================================
 * B) PENGUMUMAN — data + banner (khusus pengumuman.html)
 * =======================================================*/
function isOnPengumumanPage(){
  const p = (location.pathname||'').toLowerCase();
  if (/pengumuman\.html$/.test(p)) return true;
  const t = (document.title||'').toLowerCase();
  return t.includes('pengumuman');
}

function isActiveToday(row){
  if (!row) return false;
  const today = todayYMD();
  const m = row.tanggal_mulai   ? String(row.tanggal_mulai).slice(0,10)   : null;
  const s = row.tanggal_selesai ? String(row.tanggal_selesai).slice(0,10) : null;
  const started  = !m || m <= today;
  const notEnded = !s || s >= today;
  return !!row.status_aktif && started && notEnded && !row.dismissed;
}

async function fetchActiveAnnouncements(){
  // 1) via RPC (punya status read/dismissed per user)
  try{
    const { data, error } = await supabase.rpc('rpc_pengumuman_list', {
      only_active: true, q: null, limit_rows: 50, offset_rows: 0
    });
    if (error) throw error;
    return (data||[]).filter(isActiveToday);
  }catch(_e){
    // 2) fallback: tabel langsung
    try{
      const { data, error } = await supabase
        .from('pengumuman_hadiah')
        .select('*')
        .eq('status_aktif', true)
        .order('tanggal_mulai',{ascending:false})
        .order('created_at',{ascending:false})
        .limit(50);
      if (error) throw error;
      return (data||[]).map(r=>({ ...r, is_read:false, dismissed:false })).filter(isActiveToday);
    }catch(e2){
      console.debug('[annc] fetch error:', e2?.message||e2);
      return [];
    }
  }
}

async function markAnnouncement(id, dismissed){
  try{
    const { error } = await supabase.rpc('rpc_pengumuman_mark_read', { p_id:id, p_dismissed: !!dismissed });
    if (error) throw error;
    return true;
  }catch(e){
    console.debug('[annc] mark error:', e?.message||e);
    return false;
  }
}

async function loadWinnersFor(id){
  // per-id
  try{
    const { data, error } = await supabase.rpc('rpc_pengumuman_winners', { p_id: id });
    if (!error && Array.isArray(data)) return data || [];
  }catch{}

  // fallback batch
  try{
    const { data, error } = await supabase.rpc('rpc_banner_winners');
    if (error) throw error;
    const row = (data||[]).find(r => r.announcement_id === id || r.id === id);
    if (row?.winners && Array.isArray(row.winners)) return row.winners;
  }catch{}
  return [];
}

/** Banner pengumuman — diletakkan di atas container konten, lebar pas */
function mountAnnouncementContainer(){
  const inner = document.querySelector('.content .container') || document.querySelector('main .container');
  const parent = inner?.parentElement || document.querySelector('main') || document.body;
  if (!parent) return null;

  const existing = document.getElementById('mj98-annc-wrap');
  if (existing) return existing;

  const wrap = el(`<div id="mj98-annc-wrap" class="container" style="margin-top:14px"></div>`);
  const card = el(`
    <section id="mj98-annc-alert" class="card" style="background:#eff6ff;border-color:#bfdbfe">
      <div style="display:flex;align-items:center;gap:10px;justify-content:space-between;flex-wrap:wrap">
        <div>
          <b>📣 Pengumuman Aktif Hari Ini</b>
          <div style="font-size:12px;opacity:.75">Informasi & jadwal penting untuk Anda</div>
        </div>
        <div style="display:flex;gap:8px">
          <a class="btn" href="pengumuman.html" style="background:#93C5FD;color:#0a2345">Buka Halaman Pengumuman</a>
        </div>
      </div>
      <div id="mj98-annc-list" class="mt-12"
           style="display:grid;grid-template-columns: repeat(auto-fit, minmax(260px,1fr)); gap:8px;"></div>
    </section>
  `);
  wrap.appendChild(card);

  if (inner) parent.insertBefore(wrap, inner);
  else parent.prepend(wrap);

  return wrap;
}

function truncateHtml(txt, max=160){
  const s = String(txt||'').replace(/\s+/g,' ').trim();
  return (s.length <= max) ? s : (s.slice(0, max-1) + '…');
}

async function renderAnnouncements(node, rows){
  const list = node.querySelector('#mj98-annc-list');
  if (!rows.length){
    list.innerHTML = `<div style="opacity:.75">Tidak ada pengumuman aktif hari ini.</div>`;
    return;
  }

  list.innerHTML = rows.slice(0,8).map(r=>`
    <div class="card" style="padding:10px" data-id="${r.id}">
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        <span class="pill ok">Aktif</span>
        <strong>${esc(r.judul||'')}</strong>
      </div>
      <div style="font-size:12px;opacity:.75;margin-top:2px">
        Periode: ${esc(String(r.tanggal_mulai||'-').slice(0,10))} → ${esc(String(r.tanggal_selesai||'∞').slice(0,10))}
      </div>
      <div class="mt-6" style="white-space:pre-wrap">${esc(truncateHtml(r.deskripsi||'', 180))}</div>
      <div class="mt-6" style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn mj98-annc-read" data-id="${r.id}">Tandai dibaca</button>
        <button class="btn mj98-annc-dismiss" data-id="${r.id}">Sembunyikan</button>
        <a class="btn" href="pengumuman.html" style="background:#60A5FA;color:#0a2345">Selengkapnya</a>
      </div>
      <div class="mt-6 fs-12 opacity-75">Dibuat: ${r.created_at?fmtTime(r.created_at):''}</div>
      <div class="mt-8 fs-12 opacity-75 mj98-annc-winners" style="min-height:18px">Memuat pemenang…</div>
    </div>
  `).join('');

  // actions
  list.querySelectorAll('.mj98-annc-read').forEach(btn=>{
    btn.addEventListener('click', async (e)=>{
      const id = e.currentTarget.getAttribute('data-id'); if (!id) return;
      const ok = await markAnnouncement(id, false);
      if (ok){
        const card = list.querySelector(`.card[data-id="${id}"]`);
        if (card) card.style.display='none';
        if (!list.querySelector('.card')) list.innerHTML = `<div style="opacity:.75">Tidak ada pengumuman aktif hari ini.</div>`;
      }
    });
  });
  list.querySelectorAll('.mj98-annc-dismiss').forEach(btn=>{
    btn.addEventListener('click', async (e)=>{
      const id = e.currentTarget.getAttribute('data-id'); if (!id) return;
      const ok = await markAnnouncement(id, true);
      if (ok){
        const card = list.querySelector(`.card[data-id="${id}"]`);
        if (card) card.style.display='none';
        if (!list.querySelector('.card')) list.innerHTML = `<div style="opacity:.75">Tidak ada pengumuman aktif hari ini.</div>`;
      }
    });
  });

  // winners ringkas
  const cards = Array.from(list.querySelectorAll('.card[data-id]'));
  for (const c of cards){
    const id = c.getAttribute('data-id');
    const host = c.querySelector('.mj98-annc-winners');
    if (!id || !host) continue;
    try{
      const winners = await loadWinnersFor(id);
      if (!winners || !winners.length){ host.textContent = '—'; continue; }
      const rows2 = winners.map(w=>({
        username: w.username ?? w.link_id ?? '-',
        qty:      Number(w.qty||0),
        total:    Number(w.total_jual||0),
        hadiah:   w.hadiah || ''
      }));
      host.innerHTML = `
        <div><b>Pemenang (ringkas):</b></div>
        <ol style="margin:4px 0 0 18px">
          ${rows2.slice(0,3).map(w=>`<li><b>${esc(w.username)}</b> — ${w.qty} trx — Rp ${w.total.toLocaleString('id-ID')}${w.hadiah? ' — '+esc(w.hadiah):''}</li>`).join('')}
        </ol>
      `;
    }catch{ host.textContent = '—'; }
  }
}

/** API Banner Pengumuman (khusus pengumuman.html) */
export async function initGlobalAnnouncementAlert(){
  try{
    if (!supabase) return;
    if (isAuthLikePage()) return;
    if (!isOnPengumumanPage()) return;
    const me = await getMe(); if (!me) return;
    const rows = await fetchActiveAnnouncements();
    if (!rows || !rows.length) return;
    const wrap = mountAnnouncementContainer(); if (!wrap) return;
    await renderAnnouncements(wrap, rows);
  }catch(err){
    console.debug('[annc-banner] skip:', err?.message||err);
  }
}

/* =========================================================
 * C) ANNOUNCEMENT BEACON (tombol kecil)
 *   — MUNCUL selama ada pengumuman aktif hari ini,
 *     meskipun sudah dibaca. Hilang otomatis saat periode habis.
 * =======================================================*/
const BEACON_REFRESH_MS = 60 * 1000; // 60 detik

function injectBeaconStylesOnce(){
  if (document.getElementById('mj98-annc-beacon-style')) return;
  const style = document.createElement('style');
  style.id = 'mj98-annc-beacon-style';
  style.textContent = `
    @keyframes mj98-pulse { 0%{box-shadow:0 0 0 0 rgba(96,165,250,.8)} 70%{box-shadow:0 0 0 12px rgba(96,165,250,0)} 100%{box-shadow:0 0 0 0 rgba(96,165,250,0)} }
    @keyframes mj98-blink { 0%,100%{background:#2563eb} 50%{background:#60a5fa} }
    #mj98-annc-beacon{
      position:fixed; top:16px; right:16px; z-index:9999;
      display:flex; align-items:center; gap:8px;
      padding:10px 12px; border-radius:999px; color:#fff; cursor:pointer;
      user-select:none; text-decoration:none;
      animation: mj98-blink 1.4s infinite ease-in-out, mj98-pulse 2.2s infinite ease-in-out;
      border:1px solid rgba(255,255,255,.3);
      background:#2563eb;
    }
    #mj98-annc-beacon .dot{
      width:10px; height:10px; border-radius:999px; background:#fca5a5; display:inline-block;
      box-shadow:0 0 0 3px rgba(252,165,165,.35);
    }
    #mj98-annc-beacon .count{
      font-weight:800; background:#1e40af; border-radius:10px; padding:2px 6px; font-size:12px;
    }
    @media (max-width:640px){ #mj98-annc-beacon{ top:auto; bottom:16px; right:16px; } }
  `;
  document.head.appendChild(style);
}

function mountAnnouncementBeacon(count){
  injectBeaconStylesOnce();
  const exist = document.getElementById('mj98-annc-beacon');
  if (exist) return exist;

  const node = el(`
    <a id="mj98-annc-beacon" href="pengumuman.html" title="Pengumuman aktif — klik untuk membuka">
      <span class="dot" aria-hidden="true"></span>
      <span style="font-weight:700">Pengumuman</span>
      <span class="count" aria-label="Jumlah pengumuman">${Number(count||0)}</span>
      <span aria-hidden="true">🔔</span>
    </a>
  `);
  document.body.appendChild(node);
  return node;
}

/** INIT beacon — tampil selama ada PENGUMUMAN AKTIF (total > 0), bukan unread */
export async function initAnnouncementBeacon(){
  try{
    if (!supabase) return;
    if (isAuthLikePage()) return;   // jangan di login/register
    const me = await getMe(); if (!me) return;

    const render = async () => {
      const rows = await fetchActiveAnnouncements();
      const totalActive = rows?.length || 0;

      let node = document.getElementById('mj98-annc-beacon');
      if (totalActive > 0){
        if (!node) node = mountAnnouncementBeacon(totalActive);
        const c = node?.querySelector('.count');
        if (c) c.textContent = String(totalActive);
      } else {
        node?.remove();
      }
    };

    await render();
    setInterval(render, BEACON_REFRESH_MS);
  }catch(err){
    console.debug('[annc-beacon] skip:', err?.message||err);
  }
}

/* =========================================================
 * D) API gabungan + auto-init
 * =======================================================*/
/* ===== Opsi gabungan ===== */
// >>> Hanya beacon + sisa setoran. Banner besar TIDAK disuntik di mana pun
export async function initGlobalAlerts(){
  await Promise.allSettled([
    // initGlobalAnnouncementAlert(), // <-- sengaja dimatikan agar tidak dobel di pengumuman.html
    initAnnouncementBeacon(),        // tombol kecil "Pengumuman" (bergerak) tetap jalan
    initGlobalSetoranAlert()         // kartu sisa setoran
  ]);
}

/* ===== Auto-init di semua halaman (kecuali dimatikan manual) ===== */
if (typeof window !== 'undefined' && !window.__MJ98_ALERTS_AUTOINIT_DISABLED){
  window.addEventListener('DOMContentLoaded', () => { initGlobalAlerts(); });
}
