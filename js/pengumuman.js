// js/pengumuman.js — MJ98 (Pengumuman umum + generator Top Seller) — versi robust
'use strict';

import { supabase, getProfile, signOutAndRedirect } from './supabase-init.js';

const $  = (q, el=document) => el.querySelector(q);
const $$ = (q, el=document) => Array.from(el.querySelectorAll(q));
const esc = (s='') => String(s).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;' }[m]));
const fmtTime = (d) => d ? new Date(d).toLocaleString('id-ID') : '';
const toRp = (n) => 'Rp ' + (Number(n||0)).toLocaleString('id-ID');

// Local Y-M-D (bukan UTC) agar tidak mundur/hari salah pada zona WITA/WIB/WIT
const todayYMD = () => {
  const dt = new Date();
  dt.setMinutes(dt.getMinutes() - dt.getTimezoneOffset());
  return dt.toISOString().slice(0,10);
};

/* ===== Selector & parser super-toleran ===== */
function pickEl(...sels){
  for (const s of sels){ const el=$(s); if (el) return el; }
  return null;
}

function findByLabelContains(txt){
  const want = String(txt).toLowerCase();
  for (const lab of $$('label')){
    const t = (lab.textContent||'').trim().toLowerCase();
    if (!t || !t.includes(want)) continue;
    const forId = lab.getAttribute('for');
    if (forId) {
      const el = document.getElementById(forId);
      if (el) return el;
    }
    const near = lab.parentElement?.querySelector('input,textarea,select');
    if (near) return near;
  }
  return null;
}

function getTextValueByAny(...sels){
  const byAttr = pickEl(...sels);
  if (byAttr && typeof byAttr.value === 'string') return byAttr.value;
  const fallback =
    sels.some(s=>/judul/i.test(s)) ? findByLabelContains('judul')
  : sels.some(s=>/(isi|deskripsi)/i.test(s)) ? findByLabelContains('isi')
  : null;
  return (fallback && typeof fallback.value === 'string') ? fallback.value : '';
}

function getBoolLike(v){
  const s = String(v??'').trim().toLowerCase();
  return ['1','true','ya','y','aktif','yes','on'].includes(s);
}

// mengubah berbagai input tanggal ke 'YYYY-MM-DD'
function parseAnyDateToYMD(raw){
  if (!raw) return '';
  let s = String(raw).trim();

  // datetime-local -> date
  if (/^\d{4}-\d{2}-\d{2}t\d{2}:\d{2}/i.test(s)) s = s.split('T')[0];
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // dd/mm/yyyy atau dd-mm-yyyy [opsional HH:MM]
  const m1 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/);
  if (m1){
    const dd = Number(m1[1]), mm = Number(m1[2]), yyyy = Number(m1[3]);
    if (yyyy>=1900 && mm>=1 && mm<=12 && dd>=1 && dd<=31){
      const mm2 = String(mm).padStart(2,'0');
      const dd2 = String(dd).padStart(2,'0');
      return `${yyyy}-${mm2}-${dd2}`;
    }
  }
  // fallback: Date.parse (anggap lokal)
  const dt = new Date(s);
  if (!isNaN(dt.getTime())){
    const y=dt.getFullYear(), m=String(dt.getMonth()+1).padStart(2,'0'), d=String(dt.getDate()).padStart(2,'0');
    return `${y}-${m}-${d}`;
  }
  return '';
}

/* ========================================================= */
let me=null, canManage=false, feedRows=[], calon=[];
let editingId = null; // id pengumuman yang sedang diedit (null = tambah baru)

window.addEventListener('DOMContentLoaded', init);

async function init(){
  const { data:{session} } = await supabase.auth.getSession();
  if(!session){ location.href='index.html'; return; }

  // ambil profil + hirarki (buat filter generator)
  me = await getProfile("id, role, username, full_name, owner_id, mitracabang_id, cabang_id");
  if(!me){ alert('Gagal memuat profil'); return; }

  canManage = ['owner','admin'].includes(String(me.role||'').toLowerCase());
  $('#userRole') && ($('#userRole').textContent = `(${me.role})`);
  $('#greet')    && ($('#greet').textContent    = `Hai, ${me.username||me.full_name||''}`);
  $('#btnLogout')?.addEventListener('click', ()=>signOutAndRedirect('./index.html'));

  pickEl('#btnReload','#reload','#muat')?.addEventListener('click', reload);
  pickEl('#q','#cari')?.addEventListener('input', render);

  if (canManage){
    $('#editor')?.classList.remove('hidden');
    pickEl('#tabNormal','#tab-biasa')?.addEventListener('click', ()=>showTab('normal'));
    pickEl('#tabHadiah','#tab-hadiah')?.addEventListener('click', ()=>showTab('hadiah'));
    showTab('normal');

    const hFrom = pickEl('#hFrom','#fromH'); if (hFrom) hFrom.value=todayYMD();
    const hTo   = pickEl('#hTo','#toH');     if (hTo)   hTo.value=todayYMD();

    pickEl('#btnSave','#simpan')?.addEventListener('click', onSave);
    pickEl('#btnReset','#bersihkan')?.addEventListener('click', resetForm);
    pickEl('#btnHitung','#hitung')?.addEventListener('click', hitungTopSeller);
    pickEl('#btnIsiKeForm','#isiKeForm')?.addEventListener('click', isiKeFormDariCalon);
  }

  await reload();
}

function showTab(name){
  pickEl('#tabNormal','#tab-biasa')?.classList.toggle('active', name==='normal');
  pickEl('#tabHadiah','#tab-hadiah')?.classList.toggle('active', name!=='normal');
  pickEl('#paneNormal')?.classList.toggle('hidden', name!=='normal');
  pickEl('#paneHadiah') ?.classList.toggle('hidden', name==='normal');
}

/* ===================== FEED ===================== */
async function reload(){
  try{
    // Utama: gunakan RPC (RLS-aware)
    const { data, error } = await supabase.rpc('rpc_pengumuman_list', {
      only_active: false,
      q: (getTextValueByAny('#q','#cari')||'').trim() || null,
      limit_rows: 200,
      offset_rows: 0
    });
    if (error) throw error;
    feedRows = data || [];
  }catch{
    // Fallback: baca tabel langsung (tanpa status baca)
    const { data, error } = await supabase
      .from('pengumuman_hadiah')
      .select('*')
      .order('status_aktif',{ascending:false})
      .order('tanggal_mulai',{ascending:false})
      .order('created_at',{ascending:false})
      .limit(200);
    if (error){ alert('Gagal memuat pengumuman'); return; }
    feedRows = (data||[]).map(r=>({ ...r, is_read:false, dismissed:false, read_at:null }));
  }
  render();
}

function render(){
  const q = (getTextValueByAny('#q','#cari')||'').toLowerCase();
  const rows = (feedRows||[]).filter(r =>
    !q || String(r.judul||'').toLowerCase().includes(q) || String(r.deskripsi||'').toLowerCase().includes(q)
  );
  $('#feed') && ($('#feed').innerHTML = rows.map(card).join(''));
  $('#empty')?.classList.toggle('hidden', rows.length>0);

  if (canManage){
    $$('.btn-active').forEach(b=>b.addEventListener('click',()=>toggleActive(b.dataset.id, b.dataset.val==='true')));
    $$('.btn-del').forEach(b=>b.addEventListener('click',()=>delItem(b.dataset.id)));
    $$('.btn-edit').forEach(b=>b.addEventListener('click',()=>startEdit(b.dataset.id)));
  }
  $$('.btn-read').forEach(b=>b.addEventListener('click',()=>markRead(b.dataset.id,false)));
  $$('.btn-dismiss').forEach(b=>b.addEventListener('click',()=>markRead(b.dataset.id,true)));

  if (rows.length) { hydrateWinners(); }   // ambil pemenang untuk tiap kartu
}

function badgeActive(r){
  return r.status_aktif ? `<span class="pill ok">Aktif</span>` : `<span class="pill warn">Nonaktif</span>`;
}

// Periode dianggap inklusif harian: mulai <= hari_ini <= selesai
function badgeLive(r){
  const today = todayYMD();
  const m = r.tanggal_mulai   ? String(r.tanggal_mulai).slice(0,10)   : null;
  const s = r.tanggal_selesai ? String(r.tanggal_selesai).slice(0,10) : null;
  const started  = !m || m <= today;
  const notEnded = !s || s >= today;
  return (started && notEnded)
    ? `<span class="pill ok">Dalam Periode</span>`
    : `<span class="pill warn">Di luar Periode</span>`;
}

function badgeRead(r){
  if (r.dismissed) return `<span class="pill" style="background:#fee;color:#900;border-color:#fcc">Disembunyikan</span>`;
  if (r.is_read)   return `<span class="pill" style="background:#EEF5FF;color:#225;border-color:#dde">Sudah dibaca</span>`;
  return '';
}

function card(r){
  const period = [
    r.tanggal_mulai ? esc(String(r.tanggal_mulai).slice(0,10)) : '-',
    r.tanggal_selesai ? esc(String(r.tanggal_selesai).slice(0,10)) : '∞'
  ].join(' → ');
  const toolsL = `
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      <button class="btn btn-read" data-id="${r.id}">Tandai dibaca</button>
      <button class="btn btn-dismiss" data-id="${r.id}">Sembunyikan</button>
    </div>`;
  const toolsR = canManage ? `
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      <button class="btn btn-edit" data-id="${r.id}">Edit</button>
      <button class="btn btn-active" data-id="${r.id}" data-val="${r.status_aktif}">${r.status_aktif?'Nonaktifkan':'Aktifkan'}</button>
      <button class="btn btn-del" data-id="${r.id}">Hapus</button>
    </div>` : '';

  return `
  <div class="card" data-id="${r.id}" style="display:flex;gap:12px;align-items:flex-start;justify-content:space-between">
    <div style="flex:1 1 auto">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        ${badgeActive(r)} ${badgeLive(r)} ${badgeRead(r)}
        <strong style="font-size:18px">${esc(r.judul||'')}</strong>
        <span style="opacity:.7;font-size:12px">• Periode: ${period}</span>
      </div>
      <div style="white-space:pre-wrap;margin-top:6px">${esc(r.deskripsi||'')}</div>

      <!-- winners -->
      <div class="fs-12 opacity-80 mt-8">Pemenang:</div>
      <div class="winners fs-14 opacity-80">Memuat…</div>

      <div style="opacity:.7;font-size:12px;margin-top:6px">${r.created_at?fmtTime(r.created_at):''}</div>
      <div class="mt-8">${toolsL}</div>
    </div>
    ${toolsR}
  </div>`;
}

/* ——— ambil pemenang untuk setiap kartu ——— */
async function hydrateWinners() {
  const cards = $$('#feed .card[data-id]');
  for (const c of cards) {
    const id = c.dataset.id;
    const host = c.querySelector('.winners');
    if (!host) continue;

    try{
      const { data, error } = await supabase.rpc('rpc_pengumuman_winners', { p_id: id });
      if (error) throw error;
      if (!data || !data.length) { host.textContent = 'Belum ada pemenang'; continue; }

      host.innerHTML = `
        <ol style="margin:6px 0 0 18px">
          ${data.map(w => `<li><b>${esc(w.username)}</b> — ${w.qty} trx — ${toRp(w.total_jual)}${w.hadiah? ' — hadiah: '+esc(w.hadiah):''}</li>`).join('')}
        </ol>`;
    }catch(e){
      host.textContent = 'Gagal memuat pemenang';
    }
  }
}

/* ——— helper isi form + mulai edit ——— */
function setVal(sel, val){
  const el = pickEl(sel);
  if (el && 'value' in el) el.value = val;
}

function fillFormFromRecord(r){
  setVal('#fTitle', r.judul || '');
  setVal('#judul',  r.judul || '');
  setVal('#title',  r.judul || '');

  setVal('#fBody', r.deskripsi || '');
  setVal('#isi',   r.deskripsi || '');
  setVal('#body',  r.deskripsi || '');
  setVal('#deskripsi', r.deskripsi || '');

  setVal('#fPinned','true'); setVal('#pinned','true'); setVal('#pin','true'); setVal('#aktif', r.status_aktif ? 'true' : 'false');

  const tMulai = r.tanggal_mulai ? String(r.tanggal_mulai).slice(0,10) : todayYMD();
  const tSelesai = r.tanggal_selesai ? String(r.tanggal_selesai).slice(0,10) : (r.tanggal_mulai ? String(r.tanggal_mulai).slice(0,10) : '');

  setVal('#fFrom', tMulai); setVal('#from', tMulai); setVal('#mulai', tMulai); setVal('#start', tMulai); setVal('#tanggal_mulai', tMulai);
  setVal('#fTo', tSelesai); setVal('#to', tSelesai); setVal('#selesai', tSelesai); setVal('#end', tSelesai); setVal('#tanggal_selesai', tSelesai);
}

function startEdit(id){
  const r = (feedRows||[]).find(x => String(x.id)===String(id));
  if (!r){ alert('Data tidak ditemukan'); return; }
  editingId = r.id;
  fillFormFromRecord(r);
  const saveBtn = pickEl('#btnSave','#simpan'); if (saveBtn) saveBtn.textContent = 'Update';
  showTab('normal');
  window.scrollTo({top:0, behavior:'smooth'});
}

/* ===================== SIMPAN ===================== */
async function onSave(){
  const judul = (getTextValueByAny('#fTitle','#judul','#title','input[name=judul]','[data-field="judul"]','#paneNormal input[type="text"]','form#frmAnn input[type="text"]')||'').trim();
  const deskripsi = (getTextValueByAny('#fBody','#isi','#body','#deskripsi','textarea[name=isi]','[data-field="isi"]','#paneNormal textarea','form#frmAnn textarea','textarea')||'').trim();

  if (!judul || !deskripsi){
    alert('Judul & isi wajib diisi');
    return;
  }

  // status aktif (pin)
  const pinRaw = getTextValueByAny('#fPinned','#pinned','#pin','#aktif','select[name=pin]','[data-field="pinned"]') || 'true';
  const status_aktif = getBoolLike(pinRaw);

  // tanggal (ingat: tanggal_selesai NOT NULL di DB)
  const tMulaiRaw = getTextValueByAny('#fFrom','#from','#mulai','#start','#tanggal_mulai') || todayYMD();
  const tSelesaiRaw = getTextValueByAny('#fTo','#to','#selesai','#end','#tanggal_selesai') || '';
  let tanggal_mulai   = parseAnyDateToYMD(tMulaiRaw)   || todayYMD();
  let tanggal_selesai = parseAnyDateToYMD(tSelesaiRaw) || tanggal_mulai; // default = mulai (wajib isi)

  // betulkan jika terbalik
  if (new Date(tanggal_selesai) < new Date(tanggal_mulai)) {
    const tmp = tanggal_mulai;
    tanggal_mulai = tanggal_selesai;
    tanggal_selesai = tmp;
  }

  const jumlah_pemenang = Math.max(1, parseInt(getTextValueByAny('#fJP','#jumlah_pemenang') || '3',10));
  const targetMitra = (getTextValueByAny('#fTargetMitra','#targetMitra','#mitracabang_id')||'').trim();
  const mitracabang_id = (targetMitra && /^[0-9a-f-]{36}$/i.test(targetMitra)) ? targetMitra : null;

  const payload = { judul, deskripsi, tanggal_mulai, tanggal_selesai, jumlah_pemenang, status_aktif, created_by: me.id, mitracabang_id };

  let error;
  if (editingId){
    ({ error } = await supabase.from('pengumuman_hadiah').update(payload).eq('id', editingId));
  }else{
    ({ error } = await supabase.from('pengumuman_hadiah').insert(payload));
  }
  if (error){
    alert('Gagal simpan: ' + (error.message || ''));
    return;
  }

  const msg = editingId ? 'Perubahan tersimpan.' : 'Pengumuman tersimpan.';
  resetForm(); await reload(); alert(msg);
}

function resetForm(){
  const set = (sel,val)=>{ const el=pickEl(sel); if(el && 'value' in el) el.value=val; };
  set('#fTitle',''); set('#judul',''); set('#title','');
  set('#fBody','');  set('#isi','');    set('#body',''); set('#deskripsi','');
  set('#fPinned','true'); set('#pinned','true'); set('#pin','true'); set('#aktif','true');
  set('#fFrom',''); set('#from',''); set('#mulai',''); set('#start',''); set('#tanggal_mulai','');
  set('#fTo','');   set('#to','');   set('#selesai',''); set('#end',''); set('#tanggal_selesai','');
  set('#fJP','3'); set('#jumlah_pemenang','3');
  set('#fTargetMitra',''); set('#targetMitra',''); set('#mitracabang_id','');

  // reset mode edit
  editingId = null;
  const saveBtn = pickEl('#btnSave','#simpan'); if (saveBtn) saveBtn.textContent = 'Simpan';
}

/* ===================== AKSI KARTU ===================== */
async function toggleActive(id,current){
  if(!confirm(current?'Nonaktifkan pengumuman ini?':'Aktifkan pengumuman ini?')) return;
  const { error } = await supabase.from('pengumuman_hadiah').update({ status_aktif: !current }).eq('id', id);
  if (error){ alert('Gagal mengubah status'); return; }
  await reload();
}

async function delItem(id){
  if(!confirm('Hapus pengumuman ini?')) return;
  const { error } = await supabase.from('pengumuman_hadiah').delete().eq('id', id);
  if (error){ alert('Gagal hapus'); return; }
  await reload();
}

async function markRead(id, dismissed){
  try{
    const { error } = await supabase.rpc('rpc_pengumuman_mark_read', { p_id:id, p_dismissed: !!dismissed });
    if (error) throw error;
    await reload();
  }catch{
    alert('Gagal menandai pengumuman.');
  }
}

/* ===================== GENERATOR TOP SELLER ===================== */
/* 2.3: Memakai RPC top_seller_links (bukan langsung baca sales) */
async function hitungTopSeller(){
  const d1 = getTextValueByAny('#hFrom','#fromH');
  const d2 = getTextValueByAny('#hTo','#toH');
  const limit  = Math.max(1, parseInt(getTextValueByAny('#hLimit','#limitH')||'3',10));
  const metric = (getTextValueByAny('#hMetric','#metricH') || 'total').toLowerCase();
  if (!d1 || !d2){ alert('Isi periode dulu'); return; }

  const p_from = parseAnyDateToYMD(d1);
  const p_to   = parseAnyDateToYMD(d2);

  const onlyMitra  = (me?.role && String(me.role).toLowerCase()==='mitra-cabang') ? (me.mitracabang_id||null) : null;
  const onlyCabang = (me?.role && String(me.role).toLowerCase()==='cabang')       ? (me.cabang_id||null)      : null;

  let rows=[];
  try{
    const { data, error } = await supabase.rpc('top_seller_links', {
      p_from,
      p_to,
      p_limit: limit,
      p_only_mitracabang: onlyMitra,
      p_only_cabang: onlyCabang
    });
    if (error) throw error;
    rows = data || [];
  }catch{
    rows = [];
  }

  if (!rows.length){
    $('#hInfo') && ($('#hInfo').textContent='Tidak ada data penjualan pada periode ini.');
    calon=[]; renderCalon(); return;
  }

  // Ambil nama link
  const ids = rows.map(r=>r.link_id);
  const nameMap=new Map();
  if (ids.length){
    const { data:prof } = await supabase.from('profiles').select('id,username,full_name').in('id', ids).limit(1000);
    (prof||[]).forEach(p=> nameMap.set(p.id, p.username || p.full_name || p.id));
  }

  rows.sort((a,b)=> metric==='qty'
    ? (Number(b.qty||0)-Number(a.qty||0))
    : (Number(b.total_jual||0)-Number(a.total_jual||0))
  );

  calon = rows.slice(0, limit).map((x,i)=>({
    rank_no: i+1,
    link_id: x.link_id,
    username: nameMap.get(x.link_id) || x.link_id,
    qty: Number(x.qty||0),
    total_jual: Number(x.total_jual||0),
    hadiah: ''
  }));

  $('#hInfo') && ($('#hInfo').textContent = `${calon.length} pemenang ditemukan`);
  renderCalon();
}

function renderCalon(){
  const host = $('#hTable'); if (!host) return;
  if (!calon.length){
    host.innerHTML='<div style="opacity:.7">Belum ada data pemenang. Gunakan tombol “Hitung Top Seller”.</div>';
    return;
  }
  host.innerHTML = `
    <table style="width:100%;border-collapse:collapse">
      <thead><tr><th>#</th><th>Username Link</th><th>Qty</th><th>Total Jual</th><th>Hadiah</th></tr></thead>
      <tbody>
        ${calon.map((r,i)=>`
          <tr>
            <td>${r.rank_no}</td>
            <td>${esc(r.username||'')}</td>
            <td class="right">${r.qty}</td>
            <td class="right">${toRp(r.total_jual)}</td>
            <td><input data-i="${i}" class="hadiah" placeholder="Hadiah untuk pemenang #${r.rank_no}"></td>
          </tr>`).join('')}
      </tbody>
    </table>`;
  $$('.hadiah').forEach(inp=>inp.addEventListener('input',e=>{
    const i = Number(e.target.dataset.i||0);
    calon[i].hadiah = e.target.value;
  }));
}

function isiKeFormDariCalon(){
  const d1 = getTextValueByAny('#hFrom','#fromH'), d2 = getTextValueByAny('#hTo','#toH');
  const hadiahDefault = (getTextValueByAny('#hHadiahDefault','#hadiahDefault')||'').trim();
  const metric = (getTextValueByAny('#hMetric','#metricH') || 'total').toLowerCase();

  const lines = (calon||[]).map(c=>{
    const hadiah = (c.hadiah||hadiahDefault||'-');
    const metricTxt = metric==='qty' ? `${c.qty} transaksi` : `${toRp(c.total_jual)}`;
    return `#${c.rank_no}. ${c.username} — ${metricTxt} — Hadiah: ${hadiah}`;
  });

  const title = `Pemenang Top Seller Periode ${d1} s/d ${d2}`;
  const body  = lines.length
    ? `Selamat kepada para pemenang Top Seller periode ${d1} s/d ${d2}:\n\n${lines.join('\n')}\n\nTerima kasih atas kerja kerasnya!`
    : `Pengumuman Top Seller periode ${d1} s/d ${d2}. (Isi detail pemenang secara manual di bawah ini)`;

  setVal('#fTitle', title); setVal('#judul', title); setVal('#title', title);
  setVal('#fBody', body); setVal('#isi', body); setVal('#body', body); setVal('#deskripsi', body);
  setVal('#fPinned','true'); setVal('#pinned','true'); setVal('#pin','true'); setVal('#aktif','true');
  setVal('#fFrom', todayYMD()); setVal('#from', todayYMD()); setVal('#mulai', todayYMD()); setVal('#start', todayYMD()); setVal('#tanggal_mulai', todayYMD());
  setVal('#fTo',''); setVal('#to',''); setVal('#selesai',''); setVal('#end',''); setVal('#tanggal_selesai','');
  showTab('normal');
  window.scrollTo({top:0, behavior:'smooth'});
}
