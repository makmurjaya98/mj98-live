// js/laporan.js — MJ98 (HYBRID FINAL, deposit by created_at only)
// Fitur:
// - Filter hirarki: Mitra -> Cabang -> Link (role-aware)
// - Sumber data:
//   • DETAIL: view audit_sales_mj98 (fallback ke sales) + hitung ulang pendapatan via share/komisi hirarki
//   • RPC: report_per_mitracabang / report_per_cabang (akurasi = DB, cepat)
// - Rumus: Tagihan = Σ(total_jual) − Σ(pendapatan_link);
//   Owner = max(0, total_jual − (pend_link + pend_cabang + pend_mitra))
// - Share/Komisi dari voucher_share_settings (hirarki)
// - Harga dari voucher_types (untuk sheet PerVoucher)
// - Export: DETAIL → Laporan + PerVoucher + Stok (+ Komisi/Share); RPC → Ringkasan
// - Penyeragaman: Total Setoran dihitung dari deposits.amount dengan filter waktu pada kolom created_at (akhir periode eksklusif)

'use strict';

import {
  supabase,
  getProfile,
  orgIdOf,
  isoRangeFromInputs,
  rpcReportPerMitra,
  rpcReportPerCabang,
  explainSupabaseError,
  toRp,
} from './supabase-init.js';

import { overrideRpcRowsWithDepositTotals } from './kpi-helper.js';

/* ===== UTIL ===== */
const $  = (s)=>document.querySelector(s);
const $$ = (s)=>Array.from(document.querySelectorAll(s));
const esc=(x)=>String(x??'').replace(/[&<>"']/g,m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
const toID=(n)=>Number(n||0).toLocaleString('id-ID');

async function ensureSheetJS(){
  if (window.XLSX && window.XLSX.utils && window.XLSX.writeFile) return window.XLSX;
  try{
    const mod = await import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm');
    window.XLSX = { utils: mod.utils, writeFile: mod.writeFile };
    return window.XLSX;
  }catch(e){
    console.error(e);
    alert('Gagal memuat library Excel.');
    return null;
  }
}
function disableWhileLoading(disabled=true){
  ['#btnMitra','#btnCabang','#btnReload','#export','#exportXlsx','#print'].forEach(sel=>{
    const b=$(sel); if (!b) return;
    b.disabled=!!disabled; b.setAttribute('aria-busy', disabled?'true':'false');
  });
}
function periodLabelFromInputs(){
  const fromInput = $('#from')?.value || '';
  const toInput   = $('#to')  ?.value || '';
  const f = fromInput ? new Date(fromInput) : null;
  const t = toInput   ? new Date(toInput)   : null;
  const fmt = (d)=> d ? d.toISOString().slice(0,10) : '-';
  return `${fmt(f)} s/d ${fmt(t)}`;
}

/* ===== Pilihan dropdown ===== */
function captureSelections() {
  gSel.mitra   = $('#fltMitra') ? ($('#fltMitra').value || null) : gSel.mitra;
  gSel.cabang  = $('#fltCabang') ? ($('#fltCabang').value || null) : gSel.cabang;
  gSel.link    = $('#fltLink') ? ($('#fltLink').value || null) : gSel.link;
  gSel.voucher = $('#fltVtype') ? ($('#fltVtype').value || '') : (gSel.voucher || '');
}

/* ===== STATE ===== */
let gProf=null, gOwner=null;
let gGroupMode='per-link'; // 'per-link' | 'per-cabang' | 'per-mitra'
let gSourceMode='detail';  // 'detail' | 'rpc'

let gRowsAgg=[];   // agregat render/export
let gRowsRaw=[];   // raw sales (DETAIL)
let gVoucherMap=new Map(); // vtid -> {nama,harga_pokok,harga_jual}
let gSel={ mitra:null, cabang:null, link:null, voucher:null };

let gSummary={
  periodText:'',
  modeText:'',
  voucherId:'',
  voucherLabel:'Semua',
  shares:{ share_link:null, share_cabang:null, p_link:null, p_cabang:null, p_mitra:null },
  sums:{ qty:0,total_pokok:0,total_jual:0,pend_link:0,pend_cabang:0,pend_mitra:0,pend_owner:0,tagihan:0,setoran:0,sisa:0 }
};

/* ===== INIT ===== */
window.addEventListener('DOMContentLoaded', init);

async function init(){
  gProf = await getProfile('id,role,owner_id,mitracabang_id,cabang_id,username,full_name');
  if(!gProf){ location.replace('index.html'); return; }
  gOwner = orgIdOf(gProf);

  // Default tanggal 7 hari
  const dTo = new Date();
  const dFrom = new Date(); dFrom.setDate(dTo.getDate()-7);
  $('#from')?.setAttribute('value', dFrom.toISOString().slice(0,10));
  $('#to')  ?.setAttribute('value',   dTo.toISOString().slice(0,10));

  // Cegah submit form filter (biar tidak reload)
  document.querySelector('#filterForm')
    ?.addEventListener('submit', (e)=>{ e.preventDefault(); e.stopPropagation(); });

  // Perubahan tanggal langsung terapkan + sinkronkan ke URL
  ['#from','#to'].forEach(sel=>{
    const el = document.querySelector(sel);
    if (!el) return;
    el.addEventListener('change', ()=>{
      const u = new URL(location.href);
      const f = $('#from')?.value || '';
      const t = $('#to')  ?.value || '';
      f ? u.searchParams.set('from', f) : u.searchParams.delete('from');
      t ? u.searchParams.set('to',   t) : u.searchParams.delete('to');
      history.replaceState(null,'',u.toString());
      loadAndRender();
    });
  });

  // Group mode
  if ($('#mode')) {
    const role = String(gProf.role||'').toLowerCase();
    if (role==='cabang') $('#mode').value='per-link';
    else if (role==='mitra-cabang' || role==='mitracabang') $('#mode').value='per-cabang';
    gGroupMode = $('#mode').value || 'per-link';
    $('#mode').addEventListener('change', ()=>{
      gGroupMode = $('#mode').value || 'per-link';
      loadAndRender();
    });
  }

  // Source mode
  if ($('#sourceMode')){
    gSourceMode = $('#sourceMode').value || 'detail';
    $('#sourceMode').addEventListener('change', ()=>{
      gSourceMode = $('#sourceMode').value || 'detail';
      if (gSourceMode==='rpc' && gGroupMode==='per-link'){
        gGroupMode='per-cabang'; $('#mode') && ($('#mode').value='per-cabang');
      }
      loadAndRender();
    });
  }

  // Tombol cepat
  $('#btnMitra')?.addEventListener('click', ()=>{
    $('#sourceMode') && ($('#sourceMode').value='rpc'); gSourceMode='rpc';
    gGroupMode='per-mitra'; $('#mode') && ($('#mode').value='per-mitra');
    loadAndRender();
  });
  $('#btnCabang')?.addEventListener('click', ()=>{
    $('#sourceMode') && ($('#sourceMode').value='rpc'); gSourceMode='rpc';
    gGroupMode='per-cabang'; $('#mode') && ($('#mode').value='per-cabang');
    loadAndRender();
  });

  // Tombol Terapkan (apply)
  const applyBtn = document.querySelector('#btnReload');
  if (applyBtn){
    applyBtn.addEventListener('click', (ev)=>{
      ev.preventDefault();
      captureSelections();
      const u = new URL(location.href);
      const f = $('#from')?.value || '';
      const t = $('#to')  ?.value || '';
      f ? u.searchParams.set('from', f) : u.searchParams.delete('from');
      t ? u.searchParams.set('to',   t) : u.searchParams.delete('to');
      history.replaceState(null,'', u.toString());
      loadAndRender();
    });
  }

  // Export & print
  $('#export')   ?.addEventListener('click', exportCsv);
  $('#exportXlsx')?.addEventListener('click', exportXlsx);
  $('#print')    ?.addEventListener('click', ()=>window.print());

  // Voucher filter
  await populateVoucherOptions();
  $('#fltVtype')?.addEventListener('change', ()=>{
    gSel.voucher = $('#fltVtype').value || '';
    loadAndRender();
  });

  // Filter hirarki
  await setupHierarchyFilters();
  $('#fltMitra') ?.addEventListener('change', async ()=>{
    gSel.mitra = $('#fltMitra').value || null;
    await populateCabangOptions();
    gSel.cabang = $('#fltCabang')?.value || null;
    await populateLinkOptions();
    gSel.link = $('#fltLink')?.value || null;
    await loadAndRender();
  });
  $('#fltCabang')?.addEventListener('change', async ()=>{
    gSel.cabang = $('#fltCabang').value || null;
    await populateLinkOptions();
    gSel.link = $('#fltLink')?.value || null;
    await loadAndRender();
  });
  $('#fltLink')  ?.addEventListener('change', ()=>{
    gSel.link = $('#fltLink').value || null;
    loadAndRender();
  });

  // Render awal
  await loadAndRender();
}

/* ===== VOUCHER ===== */
async function populateVoucherOptions(){
  const sel = $('#fltVtype'); if (!sel) return;
  sel.innerHTML = `<option value="">Semua</option>`;
  const { data, error } = await supabase
    .from('voucher_types')
    .select('id, jenis_voucher, harga_pokok, harga_jual')
    .eq('owner_id', gOwner)
    .order('jenis_voucher',{ascending:true});
  gVoucherMap.clear();
  if (error) return;
  (data||[]).forEach(v=>{
    gVoucherMap.set(v.id, { nama: (v.jenis_voucher || v.id), harga_pokok: Number(v.harga_pokok||0), harga_jual: Number(v.harga_jual||0) });
    const opt=document.createElement('option');
    opt.value=v.id; opt.textContent=v.jenis_voucher || v.id;
    sel.appendChild(opt);
  });
}

/* ===== HIERARKI (role-aware) ===== */
async function setupHierarchyFilters(){
  const role = String(gProf.role||'').toLowerCase();
  const show = (id, on)=>{ if ($(id)) $(id).style.display = on ? '' : 'none'; };

  // default sembunyi
  show('#wrapMitra',false); show('#wrapCabang',false); show('#wrapLink',false);

  if (role==='owner' || role==='admin'){
    show('#wrapMitra',true); show('#wrapCabang',true); show('#wrapLink',true);
    await populateMitraOptions();
    await populateCabangOptions();
    await populateLinkOptions();
    captureSelections();
    return;
  }
  if (role==='mitra-cabang' || role==='mitracabang'){
    show('#wrapCabang',true); show('#wrapLink',true);
    gSel.mitra = gProf.id;
    if ($('#fltMitra')){ $('#fltMitra').innerHTML = `<option value="${gProf.id}">${esc(gProf.username)}</option>`; $('#fltMitra').disabled = true; }
    await populateCabangOptions(gProf.id);
    await populateLinkOptions();
    captureSelections();
    return;
  }
  if (role==='cabang'){
    show('#wrapLink',true);
    gSel.cabang = gProf.id;
    if ($('#fltMitra')){
      const { data:m } = await supabase.from('profiles').select('id,username').eq('id', gProf.mitracabang_id).maybeSingle();
      $('#fltMitra').innerHTML = `<option value="${esc(gProf.mitracabang_id||'')}">${esc((m && m.username) ? m.username : '(Mitra)')}</option>`;
      $('#fltMitra').disabled = true;
    }
    if ($('#fltCabang')){ $('#fltCabang').innerHTML = `<option value="${gProf.id}">${esc(gProf.username)}</option>`; $('#fltCabang').disabled = true; }
    await populateLinkOptions();
    captureSelections();
    return;
  }
  if (role==='link'){ gSel.link = gProf.id; captureSelections(); }
}

async function populateMitraOptions(){
  const sel=$('#fltMitra'); if(!sel) return;
  const { data, error } = await supabase.from('profiles')
    .select('id, username').eq('owner_id', gOwner)
    .in('role',['mitra-cabang','mitracabang'])
    .order('username',{ascending:true});
  if (error){ sel.innerHTML = `<option value="">(Semua Mitra)</option>`; return; }
  sel.innerHTML = [`<option value="">(Semua Mitra)</option>`]
    .concat((data||[]).map(m=>`<option value="${m.id}">${esc(m.username)}</option>`))
    .join('');
  gSel.mitra = sel.value || null;
}
async function populateCabangOptions(fixedMitraId){
  const sel=$('#fltCabang'); if(!sel) return;
  let q = supabase.from('profiles')
    .select('id, username, mitracabang_id, role, owner_id')
    .eq('role','cabang').eq('owner_id', gOwner).order('username',{ascending:true});
  const mid = (fixedMitraId!=null) ? fixedMitraId : ($('#fltMitra') ? $('#fltMitra').value : null);
  if (mid) q=q.eq('mitracabang_id', mid);
  const { data, error } = await q;
  if (error){ sel.innerHTML = `<option value="">(Semua Cabang)</option>`; gSel.cabang=null; return; }
  sel.innerHTML = [`<option value="">(Semua Cabang)</option>`]
    .concat((data||[]).map(c=>`<option value="${c.id}">${esc(c.username)}</option>`))
    .join('');
  gSel.cabang = sel.value || null;
}
async function populateLinkOptions(){
  const sel=$('#fltLink'); if(!sel) return;
  let q = supabase.from('profiles')
    .select('id, username, owner_id, mitracabang_id, cabang_id')
    .eq('role','link').eq('owner_id', gOwner).order('username',{ascending:true});
  const mid = $('#fltMitra') ? $('#fltMitra').value : null;
  const cid = $('#fltCabang') ? $('#fltCabang').value : null;
  if (mid) q=q.eq('mitracabang_id', mid);
  if (cid) q=q.eq('cabang_id', cid);
  const { data, error } = await q;
  if (error){ sel.innerHTML = `<option value="">(Semua Link)</option>`; gSel.link=null; return; }
  sel.innerHTML = [`<option value="">(Semua Link)</option>`]
    .concat((data||[]).map(l=>`<option value="${l.id}">${esc(l.username)}</option>`))
    .join('');
  gSel.link = sel.value || null;
}

/* ===== SHARE LOOKUP (hirarki) ===== */
async function fetchShareMetaForVoucher(ownerId, voucherTypeId, mitraId, cabangId){
  const empty = { share_link:null, share_cabang:null, p_link:null, p_cabang:null, p_mitra:null };
  if (!voucherTypeId) return empty;

  const tries = [
    { cabang_id: cabangId, mitracabang_id: mitraId },
    { cabang_id: null,     mitracabang_id: mitraId },
    { cabang_id: cabangId, mitracabang_id: null    },
    { cabang_id: null,     mitracabang_id: null    },
  ];

  for (const f of tries){
    let q = supabase
      .from('voucher_share_settings')
      .select('share_link, share_cabang, komisi_link_persen, komisi_cabang_persen, komisi_mitra_persen, created_at')
      .eq('owner_id', ownerId)
      .eq('voucher_type_id', voucherTypeId)
      .order('created_at', { ascending:false })
      .limit(1);
    if (f.mitracabang_id) q=q.eq('mitracabang_id', f.mitracabang_id); else q=q.is('mitracabang_id', null);
    if (f.cabang_id)      q=q.eq('cabang_id',      f.cabang_id);      else q=q.is('cabang_id',      null);
    const { data, error } = await q;
    if (!error && data && data.length){
      const r=data[0];
      return {
        share_link:   Number((r.share_link   ?? 0)),
        share_cabang: Number((r.share_cabang ?? 0)),
        p_link:       Number((r.komisi_link_persen   ?? 0)),
        p_cabang:     Number((r.komisi_cabang_persen ?? 0)),
        p_mitra:      Number((r.komisi_mitra_persen  ?? 0)),
      };
    }
  }
  return empty;
}

/* ===== LOAD & RENDER (dispatcher) ===== */
async function loadAndRender(){
  disableWhileLoading(true);
  try{
    captureSelections();

    gSummary.periodText = periodLabelFromInputs();
    const vMeta = gSel.voucher ? gVoucherMap.get(gSel.voucher) : null;
    gSummary.voucherLabel = vMeta ? (vMeta.nama || gSel.voucher) : (gSel.voucher ? gSel.voucher : 'Semua');

    if (gSourceMode==='rpc' && gGroupMode==='per-link'){
      gGroupMode='per-cabang'; if ($('#mode')) $('#mode').value='per-cabang';
    }

    if (gSourceMode==='rpc'){
      await loadViaRpc();
    }else{
      await loadViaDetail();
    }
  }catch(e){
    console.error(e);
    alert(explainSupabaseError(e) || e.message || 'Gagal memuat laporan.');
  }finally{
    disableWhileLoading(false);
  }
}

/* ===== VIA RPC (ringkas, akurat) ===== */
function currentRange(){
  const fromStr = document.querySelector('#from')?.value || null;
  const toStr   = document.querySelector('#to')?.value   || null;
  const tz = '+08:00';

  const fromISO = fromStr ? new Date(`${fromStr}T00:00:00${tz}`).toISOString() : null;

  let toISO = null;
  if (toStr){
    const to0 = new Date(`${toStr}T00:00:00${tz}`);
    to0.setDate(to0.getDate() + 1); // eksklusif: to+1 hari
    toISO = to0.toISOString();
  }
  return { from: fromISO, to: toISO };
}

async function loadViaRpc(){
  const role = String(gProf.role||'').toLowerCase();
  const { from, to } = currentRange(); // ISO: gte = from, lt = to
  let only_mitra=null, only_cabang=null;

  if (role==='owner' || role==='admin'){
    only_mitra  = $('#fltMitra')  ? ($('#fltMitra').value || null)  : null;
    only_cabang = $('#fltCabang') ? ($('#fltCabang').value || null) : null;
  }else if (role==='mitra-cabang' || role==='mitracabang'){
    only_mitra  = gProf.id;
    only_cabang = $('#fltCabang') ? ($('#fltCabang').value || null) : null;
  }else if (role==='cabang'){
    only_mitra  = gProf.mitracabang_id || null;
    only_cabang = gProf.id;
  }

  if (gGroupMode==='per-mitra'){
    const rows = await rpcReportPerMitra({
      owner_id: gOwner,
      from, to,
      only_mitracabang_id: (only_mitra || null)
    });
    gRowsAgg = rows || [];

    // Override setoran RPC dengan deposits.amount @ created_at (to eksklusif)
    await overrideRpcRowsWithDepositTotals({
      rows: gRowsAgg,
      kind: 'mitra',
      ownerId: gOwner,
      fromISO: from,
      toISO: to,
    });

    renderTableRpc('mitra', gRowsAgg);
  } else {
    const rows = await rpcReportPerCabang({
      owner_id: gOwner,
      from, to,
      only_mitracabang_id: (only_mitra || null),
      only_cabang_id:      (only_cabang || null)
    });
    gRowsAgg = rows || [];

    // Override setoran RPC dengan deposits.amount @ created_at (to eksklusif)
    await overrideRpcRowsWithDepositTotals({
      rows: gRowsAgg,
      kind: 'cabang',
      ownerId: gOwner,
      fromISO: from,
      toISO: to,
    });

    renderTableRpc('cabang', gRowsAgg);
  }

  // ringkasan kartu setelah override
  const sum = gRowsAgg.reduce((a,r)=>({
    total_jual:     a.total_jual     + Number(r.total_jual||0),
    total_tagihan:  a.total_tagihan  + Number(r.total_tagihan||0),
    total_setoran:  a.total_setoran  + Number(r.total_setoran||0),
    sisa_setoran:   a.sisa_setoran   + Number(r.sisa_setoran||0),
  }), { total_jual:0,total_tagihan:0,total_setoran:0,sisa_setoran:0 });

  $('#sumTotalJual')    && ($('#sumTotalJual').textContent   = toRp(sum.total_jual));
  $('#sumTotalTagihan') && ($('#sumTotalTagihan').textContent= toRp(sum.total_tagihan));
  $('#sumTotalSetoran') && ($('#sumTotalSetoran').textContent= toRp(sum.total_setoran));
  $('#sumTotalSisa')    && ($('#sumTotalSisa').textContent   = toRp(sum.sisa_setoran));
}

function renderTableRpc(kind, rows){
  const tblHead = $('#tbl-head'), tblBody = $('#tbl-body');
  if (!tblHead || !tblBody) return;

  const idTitle = (kind==='mitra') ? 'Mitra ID' : 'Cabang ID';
  tblHead.innerHTML = `
    <tr>
      <th class="t-left">${idTitle}</th>
      <th class="t-right">Total Jual</th>
      <th class="t-right">Total Tagihan</th>
      <th class="t-right">Total Setoran</th>
      <th class="t-right">Sisa Setoran</th>
    </tr>`;

  if (!rows.length){
    tblBody.innerHTML = `<tr><td colspan="5">Tidak ada data</td></tr>`;
    return;
  }
  tblBody.innerHTML = rows.map(r=>`
    <tr>
      <td class="t-left">${esc(String((kind==='mitra'?r.mitracabang_id:r.cabang_id)).slice(0,8)+'…')}</td>
      <td class="t-right">${toRp(r.total_jual)}</td>
      <td class="t-right">${toRp(r.total_tagihan)}</td>
      <td class="t-right">${toRp(r.total_setoran)}</td>
      <td class="t-right">${toRp(r.sisa_setoran)}</td>
    </tr>
  `).join('');
}

/* ===== VIA DETAIL ===== */
function applyScopeBase(q){
  const role = String(gProf.role||'').toLowerCase();
  if (role==='owner' || role==='admin') return q.eq('owner_id', gOwner);
  if (role==='mitra-cabang' || role==='mitracabang') return q.eq('mitracabang_id', gProf.id);
  if (role==='cabang') return q.eq('cabang_id', gProf.id);
  if (role==='link') return q.eq('link_id', gProf.id);
  return q;
}
function applyExplicitFilters(q){
  if (gSel.mitra)   q=q.eq('mitracabang_id', gSel.mitra);
  if (gSel.cabang)  q=q.eq('cabang_id', gSel.cabang);
  if (gSel.link)    q=q.eq('link_id', gSel.link);
  if (gSel.voucher) q=q.eq('voucher_type_id', gSel.voucher);
  return q;
}

async function loadViaDetail(){
  const r = isoRangeFromInputs('#from','#to');
  const gte = r.gte, lt = r.lt;

  // ambil transaksi
  let rows=[]; let usedView=true;
  {
    let qa = supabase.from('audit_sales_mj98').select(`
      id, owner_id, link_id, cabang_id, mitracabang_id, voucher_type_id, created_at,
      qty, total_pokok, total_jual,
      pend_link_calc, pend_cabang_calc, pend_mitra_calc
    `);
    if (gte) qa=qa.gte('created_at', gte);
    if (lt)  qa=qa.lt ('created_at', lt);
    qa = applyScopeBase(qa);
    qa = applyExplicitFilters(qa);
    const { data, error } = await qa;
    if (error){ usedView=false; } else { rows = data || []; }
  }
  if (!usedView){
    let qs = supabase.from('sales').select(`
      id, owner_id, link_id, cabang_id, mitracabang_id, voucher_type_id, created_at,
      qty, total_pokok, total_jual,
      pendapatan_link, pendapatan_cabang, pendapatan_mitracabang
    `);
    if (gte) qs=qs.gte('created_at', gte);
    if (lt)  qs=qs.lt ('created_at', lt);
    qs = applyScopeBase(qs);
    qs = applyExplicitFilters(qs);
    const { data:sRows, error:sErr } = await qs;
    if (sErr){ alert(explainSupabaseError(sErr)); return; }
    rows = (sRows||[]).map(rw=>({
      ...rw,
      pend_link_calc:   Number(rw.pendapatan_link||0),
      pend_cabang_calc: Number(rw.pendapatan_cabang||0),
      pend_mitra_calc:  Number(rw.pendapatan_mitracabang||0),
    }));
  }

  // hitung ulang pendapatan via share meta
  const shareCache=new Map(); const uniqKeys=[];
  for (const r0 of rows){
    const key = `${r0.voucher_type_id}|${r0.mitracabang_id||''}|${r0.cabang_id||''}`;
    if (!shareCache.has(key)){ shareCache.set(key,null); uniqKeys.push({ key, vt:r0.voucher_type_id, m:r0.mitracabang_id, c:r0.cabang_id }); }
  }
  await Promise.all(uniqKeys.map(async k=>{
    const meta = await fetchShareMetaForVoucher(gOwner, k.vt, k.m, k.c);
    shareCache.set(k.key, meta);
  }));
  rows = rows.map(rw=>{
    const meta = shareCache.get(`${rw.voucher_type_id}|${rw.mitracabang_id||''}|${rw.cabang_id||''}`) || {};
    const qty   = Number(rw.qty||0);
    const pokok = Number(rw.total_pokok||0);
    const pl = (Number((meta.share_link   || 0)) * qty) + (pokok * (Number((meta.p_link   || 0))/100));
    const pc = (Number((meta.share_cabang || 0)) * qty) + (pokok * (Number((meta.p_cabang || 0))/100));
    const pm =  pokok * (Number((meta.p_mitra  || 0))/100);
    return { ...rw, pend_link_calc:pl, pend_cabang_calc:pc, pend_mitra_calc:pm };
  });

  gRowsRaw = rows.slice();

  // ringkasan
  const sums = {
    qty: rows.reduce((a,r0)=> a + Number(r0.qty||0), 0),
    total_pokok: rows.reduce((a,r0)=> a + Number(r0.total_pokok||0), 0),
    total_jual:  rows.reduce((a,r0)=> a + Number(r0.total_jual ||0), 0),
    pend_link:   rows.reduce((a,r0)=> a + Number(r0.pend_link_calc  ||0), 0),
    pend_cabang: rows.reduce((a,r0)=> a + Number(r0.pend_cabang_calc||0), 0),
    pend_mitra:  rows.reduce((a,r0)=> a + Number(r0.pend_mitra_calc ||0), 0),
  };
  const ownerAll   = Math.max(0, sums.total_jual - (sums.pend_link + sums.pend_cabang + sums.pend_mitra));
  const tagihanAll = sums.total_jual - sums.pend_link;

  // ====== DEPOSITS (DETAIL) — gunakan created_at saja untuk periode ======
  // Scope mengikuti filter hirarki aktif; jumlahkan kolom `amount`, periode by created_at (to eksklusif).
  let setoran = 0;
  {
    let qd = supabase
      .from('deposits')
      .select('amount, created_at, owner_id, mitracabang_id, cabang_id, link_id')
      .eq('owner_id', gOwner)
      .order('created_at', { ascending:false });

    // terapkan filter hirarki eksplisit (mitra/cabang/link) bila ada
    qd = applyExplicitFilters(qd);

    if (gte) qd = qd.gte('created_at', gte);
    if (lt ) qd = qd.lt ('created_at', lt);

    const { data:depRows, error:dErr } = await qd;
    if (dErr){ console.error(dErr); }
    if (depRows && depRows.length){
      setoran = depRows.reduce((a,r)=> a + Number(r.amount||0), 0);
    }
  }
  // ======================================================================

  gSummary.sums = { ...sums, pend_owner:ownerAll, tagihan:tagihanAll, setoran:setoran, sisa: Math.max(0, tagihanAll - setoran) };
  $('#sumTagihan')      && ($('#sumTagihan').textContent     = toRp(gSummary.sums.tagihan));
  $('#sumSetoran')      && ($('#sumSetoran').textContent     = toRp(gSummary.sums.setoran));
  $('#sumSisa')         && ($('#sumSisa').textContent        = toRp(gSummary.sums.sisa));
  $('#sumTrx')          && ($('#sumTrx').textContent         = toID(gSummary.sums.qty));
  $('#sumPendLink')     && ($('#sumPendLink').textContent    = toRp(gSummary.sums.pend_link));
  $('#sumPendCabang')   && ($('#sumPendCabang').textContent  = toRp(gSummary.sums.pend_cabang));
  $('#sumPendMitra')    && ($('#sumPendMitra').textContent   = toRp(gSummary.sums.pend_mitra));
  $('#sumPendOwner')    && ($('#sumPendOwner').textContent   = toRp(gSummary.sums.pend_owner));

  // meta share untuk header (kalau voucher dipilih)
  if (gSel.voucher){
    gSummary.shares = await fetchShareMetaForVoucher(gOwner, gSel.voucher, gSel.mitra, gSel.cabang);
  }else{
    gSummary.shares = { share_link:null, share_cabang:null, p_link:null, p_cabang:null, p_mitra:null };
  }
  $('#metaVoucher')         && ($('#metaVoucher').textContent      = gSummary.voucherLabel);
  $('#metaShareLink')       && ($('#metaShareLink').textContent    = (gSummary.shares?.share_link   != null ? toRp(Number(gSummary.shares.share_link))   : '-'));
  $('#metaShareCabang')     && ($('#metaShareCabang').textContent  = (gSummary.shares?.share_cabang != null ? toRp(Number(gSummary.shares.share_cabang)) : '-'));
  $('#metaKomisiLink')      && ($('#metaKomisiLink').textContent   = (gSummary.shares?.p_link   != null ? (String(gSummary.shares.p_link)+'%')   : '-'));
  $('#metaKomisiCabang')    && ($('#metaKomisiCabang').textContent = (gSummary.shares?.p_cabang != null ? (String(gSummary.shares.p_cabang)+'%') : '-'));
  $('#metaKomisiMitra')     && ($('#metaKomisiMitra').textContent  = (gSummary.shares?.p_mitra  != null ? (String(gSummary.shares.p_mitra)+'%')  : '-'));

  // agregasi sesuai group mode
  const key = (gGroupMode==='per-link') ? 'link_id' : (gGroupMode==='per-cabang' ? 'cabang_id' : 'mitracabang_id');
  const map=new Map();
  for (const r0 of rows){
    const k = r0[key] || '—';
    const a = map.get(k) || { id:k, qty:0, total_pokok:0, total_jual:0, pendapatan_link:0, pendapatan_cabang:0, pendapatan_mitracabang:0, pendapatan_owner:0, tagihan:0 };
    const pl=Number(r0.pend_link_calc||0), pc=Number(r0.pend_cabang_calc||0), pm=Number(r0.pend_mitra_calc||0);
    a.qty += Number(r0.qty||0);
    a.total_pokok += Number(r0.total_pokok||0);
    a.total_jual  += Number(r0.total_jual ||0);
    a.pendapatan_link        += pl;
    a.pendapatan_cabang      += pc;
    a.pendapatan_mitracabang += pm;
    map.set(k,a);
  }
  for (const a of map.values()){
    a.pendapatan_owner = Math.max(0, a.total_jual - (a.pendapatan_link + a.pendapatan_cabang + a.pendapatan_mitracabang));
    a.tagihan = a.total_jual - a.pendapatan_link;
  }
  gRowsAgg = [...map.values()];
  renderTableDetail(gRowsAgg, gGroupMode);
}

function renderTableDetail(rows, mode){
  const tblHead = $('#tbl-head'), tblBody = $('#tbl-body'); if(!tblHead||!tblBody) return;
  const idTitle = (mode==='per-link') ? 'Link' : (mode==='per-cabang' ? 'Cabang ID' : 'Mitra ID');
  tblHead.innerHTML = `
    <tr>
      <th class="t-left">${idTitle}</th>
      <th class="t-right">Qty</th>
      <th class="t-right">Total Pokok</th>
      <th class="t-right">Total Jual</th>
      <th class="t-right">Pendapatan Link</th>
      <th class="t-right">Pendapatan Cabang</th>
      <th class="t-right">Pendapatan Mitra</th>
      <th class="t-right">Pendapatan Owner</th>
      <th class="t-right">Tagihan Link</th>
    </tr>`;
  if (!rows.length){ tblBody.innerHTML = `<tr><td colspan="9">Tidak ada data</td></tr>`; return; }
  tblBody.innerHTML = rows.map(r=>`
    <tr>
      <td class="t-left">${esc(String(r.id))}</td>
      <td class="t-right">${toID(r.qty)}</td>
      <td class="t-right">${toRp(r.total_pokok)}</td>
      <td class="t-right">${toRp(r.total_jual)}</td>
      <td class="t-right">${toRp(r.pendapatan_link)}</td>
      <td class="t-right">${toRp(r.pendapatan_cabang)}</td>
      <td class="t-right">${toRp(r.pendapatan_mitracabang)}</td>
      <td class="t-right">${toRp(r.pendapatan_owner)}</td>
      <td class="t-right">${toRp(r.tagihan)}</td>
    </tr>
  `).join('');
}

/* ===== BREAKDOWN PER VOUCHER (DETAIL) ===== */
function buildVoucherBreakdown(){
  const byV=new Map();
  for (const r of gRowsRaw){
    const k=r.voucher_type_id || null;
    const meta = gVoucherMap.get(k) || { nama:'(Tanpa Jenis)', harga_pokok:0, harga_jual:0 };
    const o = byV.get(k) || { vtid:k, voucher:meta.nama, harga_pokok:meta.harga_pokok, harga_jual:meta.harga_jual, qty:0, total_pokok:0, total_jual:0 };
    o.qty += Number(r.qty||0);
    o.total_pokok += Number(r.total_pokok||0);
    o.total_jual  += Number(r.total_jual ||0);
    byV.set(k,o);
  }
  return [...byV.values()].sort((a,b)=> (a.voucher||'').localeCompare(b.voucher||''));
}

/* ===== STOK SHEET (DETAIL) ===== */
async function buildStockSheetData(perV){
  // Kumpulkan stok per voucher_type_id berdasarkan scope saat ini
  const stockMap=new Map();

  const pushMax = (id, qty)=> stockMap.set(id, Math.max(Number(qty||0), Number(stockMap.get(id)||0)));

  const vIds = perV.map(x=>x.vtid).filter(Boolean);

  // 1) Coba view agregat kalau tersedia
  try{
    if (vIds.length){
      let q1 = supabase.from('v_stok_per_voucher')
        .select('voucher_type_id,total_stok,owner_id,mitracabang_id,cabang_id,link_id')
        .in('voucher_type_id', vIds)
        .eq('owner_id', gOwner);
      if (gSel.mitra)  q1=q1.eq('mitracabang_id', gSel.mitra);
      if (gSel.cabang) q1=q1.eq('cabang_id',      gSel.cabang);
      if (gSel.link)   q1=q1.eq('link_id',        gSel.link);
      const { data } = await q1;
      if (data && data.length){
        data.forEach(r=> pushMax(r.voucher_type_id, r.total_stok));
      }
    }
  }catch(_e){/* abaikan jika view tidak ada */ }

  // 2) Kalau masih kosong, agregasi dari tabel stok (bukan "stocks")
  try{
    if (!stockMap.size && vIds.length){
      let q2 = supabase.from('stok')
        .select('voucher_type_id,jumlah,owner_id,mitracabang_id,cabang_id,link_id')
        .eq('owner_id', gOwner)
        .in('voucher_type_id', vIds);
      if (gSel.mitra)  q2=q2.eq('mitracabang_id', gSel.mitra);
      if (gSel.cabang) q2=q2.eq('cabang_id',      gSel.cabang);
      if (gSel.link)   q2=q2.eq('link_id',        gSel.link);
      const { data } = await q2;
      if (data && data.length){
        const agg=new Map();
        data.forEach(r=>{
          const k=r.voucher_type_id;
          agg.set(k, (agg.get(k)||0) + Number(r.jumlah||0));
        });
        agg.forEach((qty, id)=> pushMax(id, qty));
      }
    }
  }catch(_e){/* abaikan jika struktur beda */ }

  // 3) Fallback terakhir: kolom stok di voucher_types (kalau ada)
  try{
    if (!stockMap.size && vIds.length){
      const { data } = await supabase.from('voucher_types').select('id,stok').in('id', vIds);
      if (data && data.length){
        data.forEach(r=> pushMax(r.id, r.stok));
      }
    }
  }catch(_e){}

  // Build baris + komisi/share per voucher (ambil dari share setting sesuai filter)
  const rows = [['Jenis Voucher','Total Stok','Terjual (Qty)','Komisi Link','Komisi Cabang','Komisi Mitra','Share Link','Share Cabang']];
  for (const v of perV){
    const metaShare = await fetchShareMetaForVoucher(gOwner, v.vtid, gSel.mitra, gSel.cabang);
    rows.push([
      v.voucher,
      stockMap.has(v.vtid) ? Number(stockMap.get(v.vtid)) : null,
      Number(v.qty||0),
      metaShare.p_link   != null ? Number(metaShare.p_link)   : null,
      metaShare.p_cabang != null ? Number(metaShare.p_cabang) : null,
      metaShare.p_mitra  != null ? Number(metaShare.p_mitra)  : null,
      metaShare.share_link   != null ? Number(metaShare.share_link)   : null,
      metaShare.share_cabang != null ? Number(metaShare.share_cabang) : null
    ]);
  }
  return rows;
}

/* ===== EXPORTS ===== */
function exportCsv(){
  if (!gRowsAgg.length){ alert('Tidak ada data'); return; }

  if (gSourceMode==='rpc'){
    const head = (gGroupMode==='per-mitra')
      ? ['mitracabang_id','total_jual','total_tagihan','total_setoran','sisa_setoran']
      : ['cabang_id','total_jual','total_tagihan','total_setoran','sisa_setoran'];
    const lines = [ head.join(','),
      ...gRowsAgg.map(r => (gGroupMode==='per-mitra'
        ? [r.mitracabang_id, r.total_jual, r.total_tagihan, r.total_setoran, r.sisa_setoran]
        : [r.cabang_id,      r.total_jual, r.total_tagihan, r.total_setoran, r.sisa_setoran]
      ).join(',')) ].join('\n');
    const blob = new Blob([lines], {type:'text/csv'});
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: `laporan-rpc-${gGroupMode}-${new Date().toISOString().slice(0,10)}.csv`
    });
    document.body.appendChild(a); a.click(); a.remove();
    return;
  }

  // DETAIL
  const idTitle = (gGroupMode==='per-link') ? 'Link' : (gGroupMode==='per-cabang' ? 'Cabang ID' : 'Mitra ID');
  const head = [idTitle,'Qty','Total Pokok','Total Jual','Pendapatan Link','Pendapatan Cabang','Pendapatan Mitra','Pendapatan Owner','Tagihan Link'];
  const lines = [ head.join(','),
    ...gRowsAgg.map(r=>[
      r.id, r.qty, r.total_pokok, r.total_jual, r.pendapatan_link, r.pendapatan_cabang, r.pendapatan_mitracabang, r.pendapatan_owner, r.tagihan
    ].join(',')) ].join('\n');
  const blob = new Blob([lines], {type:'text/csv'});
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: `laporan-detail-${gGroupMode}-${new Date().toISOString().slice(0,10)}.csv`
  });
  document.body.appendChild(a); a.click(); a.remove();
}

async function exportXlsx(){
  if (!gRowsAgg.length){ alert('Tidak ada data'); return; }
  const XLSX = await ensureSheetJS(); if (!XLSX) return;

  if (gSourceMode==='rpc'){
    const aoa=[];
    aoa.push([`Laporan RPC – ${gGroupMode==='per-mitra'?'Per Mitra':'Per Cabang'}`]);
    const prd = periodLabelFromInputs();
    aoa.push([`Periode: ${prd}`]);
    aoa.push([]);
    aoa.push(gGroupMode==='per-mitra'
      ? ['Mitra','Total Jual','Total Tagihan','Total Setoran','Sisa Setoran']
      : ['Cabang','Total Jual','Total Tagihan','Total Setoran','Sisa Setoran']
    );
    gRowsAgg.forEach(r=>{
      aoa.push(gGroupMode==='per-mitra'
        ? [r.mitracabang_id, Number(r.total_jual||0), Number(r.total_tagihan||0), Number(r.total_setoran||0), Number(r.sisa_setoran||0)]
        : [r.cabang_id,      Number(r.total_jual||0), Number(r.total_tagihan||0), Number(r.total_setoran||0), Number(r.sisa_setoran||0)]
      );
    });
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
    for (let R=4; R<=range.e.r; R++){ for (let C=1; C<=4; C++){ const addr=XLSX.utils.encode_cell({r:R,c:C}); if (ws[addr]) ws[addr].z='#,##0'; } }
    ws['!cols']=[{wch:26},{wch:16},{wch:16},{wch:16},{wch:16}];
    const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, (gGroupMode==='per-mitra'?'PerMitra':'PerCabang'));
    XLSX.writeFile(wb, `laporan-rpc-${gGroupMode}-${new Date().toISOString().slice(0,10)}.xlsx`);
    return;
  }

  // DETAIL: 3 sheet (Laporan, PerVoucher, Stok)
  const safeDecodeRange = (ws)=> XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');

  const idTitle = (gGroupMode==='per-link') ? 'Link' : (gGroupMode==='per-cabang' ? 'Cabang ID' : 'Mitra ID');
  const head1 = [
    ['Laporan MJ98 (Detail)'],
    [`Periode: ${periodLabelFromInputs()}`],
    [],
    ['Jenis Voucher', gSummary.voucherLabel],
    ['Share Link / unit', (gSummary.shares.share_link!=null ? Number(gSummary.shares.share_link) : '-')],
    ['Share Cabang / unit', (gSummary.shares.share_cabang!=null ? Number(gSummary.shares.share_cabang) : '-')],
    ['% Komisi Link',   (gSummary.shares.p_link   != null ? (String(gSummary.shares.p_link)+'%')   : '-')],
    ['% Komisi Cabang', (gSummary.shares.p_cabang != null ? (String(gSummary.shares.p_cabang)+'%') : '-')],
    ['% Komisi Mitra',  (gSummary.shares.p_mitra  != null ? (String(gSummary.shares.p_mitra)+'%')  : '-')],
    [],
    ['Pendapatan Link',   Number(gSummary.sums.pend_link)],
    ['Pendapatan Cabang', Number(gSummary.sums.pend_cabang)],
    ['Pendapatan Mitra',  Number(gSummary.sums.pend_mitra)],
    ['Pendapatan Owner',  Number(gSummary.sums.pend_owner)],
    ['Total Tagihan',     Number(gSummary.sums.tagihan)],
    ['Total Setoran',     Number(gSummary.sums.setoran)],
    ['Sisa Setoran',      Number(gSummary.sums.sisa)],
    []
  ];
  const body1=[[idTitle,'Qty','Total Pokok','Total Jual','Pendapatan Link','Pendapatan Cabang','Pendapatan Mitra','Pendapatan Owner','Tagihan Link']];
  gRowsAgg.forEach(r=> body1.push([r.id, r.qty, r.total_pokok, r.total_jual, r.pendapatan_link, r.pendapatan_cabang, r.pendapatan_mitracabang, r.pendapatan_owner, r.tagihan]));
  const ws1 = XLSX.utils.aoa_to_sheet(head1.concat([[]]).concat(body1));
  const range1 = safeDecodeRange(ws1);
  const startBodyRow = head1.length + 2;
  for (let R=startBodyRow; R<=range1.e.r+1; R++){
    const cQty = XLSX.utils.encode_cell({ r:R-1, c:1 }); if (ws1[cQty]) ws1[cQty].z='#,##0';
    for (let C=2; C<=8; C++){ const addr=XLSX.utils.encode_cell({ r:R-1, c:C }); if (ws1[addr]) ws1[addr].z='#,##0'; }
  }
  ws1['!cols']=[{wch:28},{wch:10},{wch:16},{wch:16},{wch:18},{wch:18},{wch:18},{wch:18},{wch:18}];

  const perV = buildVoucherBreakdown();
  const data2=[['Jenis Voucher','Harga Pokok/Unit','Harga Jual/Unit','Qty','Total Pokok','Total Jual']];
  perV.forEach(v=> data2.push([v.voucher, Number(v.harga_pokok||0), Number(v.harga_jual||0), Number(v.qty||0), Number(v.total_pokok||0), Number(v.total_jual||0)]));
  const ws2 = XLSX.utils.aoa_to_sheet(data2);
  const range2 = safeDecodeRange(ws2);
  for (let R=1; R<=range2.e.r; R++){
    const cQty=XLSX.utils.encode_cell({r:R,c:3}); if (ws2[cQty]) ws2[cQty].z='#,##0';
    [1,2,4,5].forEach(C=>{ const addr=XLSX.utils.encode_cell({r:R,c:C}); if (ws2[addr]) ws2[addr].z='#,##0'; });
  }
  ws2['!cols']=[{wch:22},{wch:18},{wch:18},{wch:10},{wch:16},{wch:16}];

  const data3 = await buildStockSheetData(perV);
  const ws3 = XLSX.utils.aoa_to_sheet(data3);
  const range3 = safeDecodeRange(ws3);
  // Kolom numerik: 1..7
  for (let R=1; R<=range3.e.r; R++){
    for (let C=1; C<=7; C++){
      const addr=XLSX.utils.encode_cell({r:R,c:C}); if (ws3[addr]) ws3[addr].z='#,##0';
    }
  }
  ws3['!cols']=[{wch:22},{wch:14},{wch:14},{wch:14},{wch:16},{wch:14},{wch:14},{wch:14}];

  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws1, 'Laporan');
  XLSX.utils.book_append_sheet(wb, ws2, 'PerVoucher');
  XLSX.utils.book_append_sheet(wb, ws3, 'Stok');
  XLSX.writeFile(wb, `laporan-detail-${gGroupMode}-${new Date().toISOString().slice(0,10)}.xlsx`);
}
