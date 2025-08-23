// js/dashboard.js — MJ98 (DATA-ONLY, konsisten dengan LAPORAN)
// - Tanpa RPC/function khusus; semua angka dari tabel: sales, deposits, stok
// - Rumus konsisten dengan laporan
// - Scope mengikuti role pengguna
'use strict';

import {
  supabase,
  getProfile,
  orgIdOf,
  isoRangeFromInputs,
  explainSupabaseError,
} from './supabase-init.js';

/* ---------- DOM & helpers ---------- */
const $  = (s) => document.querySelector(s);
const nf = (n) => Number(n || 0).toLocaleString('id-ID');
const rp = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
const ymd = (d) => d.toISOString().slice(0,10);
const ESC = { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' };
const esc = (x) => String(x ?? '').replace(/[&<>"']/g, m => ESC[m]);

let me = null, OWNER_ID = null;

/* ---------- Boot ---------- */
(async function boot(){
  me = await getProfile('id, role, username, full_name, owner_id, mitracabang_id, cabang_id');
  if (!me){ location.replace('index.html'); return; }
  OWNER_ID = orgIdOf(me);

  // Header & greeting
  const roleLower = String(me.role||'').toLowerCase();
  const roleNice =
    roleLower==='owner' ? 'OWNER' :
    roleLower==='admin' ? 'ADMIN' :
    ['mitra-cabang','mitracabang'].includes(roleLower) ? 'MITRACABANG' :
    roleLower==='cabang' ? 'CABANG' :
    roleLower==='link'   ? 'LINK' : (me.role||'-').toUpperCase();

  $('#greet')      && ($('#greet').textContent = `Selamat datang, ${me.full_name || me.username || 'Pengguna'}`);
  $('#whoami')     && ($('#whoami').textContent = me.username || '-');
  $('#roleBadge')  && ($('#roleBadge').textContent = roleNice);
  $('#welcomeLine')&& ($('#welcomeLine').textContent = `SELAMAT DATANG ${roleNice}: ${me.username||'-'}`);

  // Periode default: 30 hari terakhir
  const dtTo = new Date();
  const dtFrom = new Date(); dtFrom.setDate(dtTo.getDate()-29);
  $('#from') && ($('#from').value = ymd(dtFrom));
  $('#to')   && ($('#to').value   = ymd(dtTo));
  setPeriodeText();

  // Events
  $('#btnLogout')?.addEventListener('click', async ()=>{ try{ await supabase.auth.signOut(); } finally{ location.replace('index.html'); }});
  ['#from','#to'].forEach(sel => $(sel)?.addEventListener('change', ()=>{ setPeriodeText(); refreshAll(); }));
  $('#btnRefresh')?.addEventListener('click', refreshAll);
  document.addEventListener('mj98:refresh', refreshAll);

  await refreshAll();
})();

function setPeriodeText(){
  const f = $('#from')?.value, t = $('#to')?.value;
  $('#kpiPeriode') && ($('#kpiPeriode').textContent = `${f||'—'} s/d ${t||'—'}`);
}

/* ---------- Scope helper: kembalikan {col, val} ---------- */
function scopeKey(){
  const r = String(me.role||'').toLowerCase();
  if (r==='owner' || r==='admin') return { col:'owner_id',       val:(me.owner_id || me.id) };
  if (['mitra-cabang','mitracabang'].includes(r)) return { col:'mitracabang_id', val: me.id };
  if (r==='cabang') return { col:'cabang_id',     val: me.id };
  if (r==='link')   return { col:'link_id',       val: me.id };
  return { col:null, val:null };
}

/* ---------- KPI utama: Tagihan/Setor/Sisa ---------- */
async function refreshKpi(){
  const { gte, lt } = isoRangeFromInputs('#from','#to');
  const scope = scopeKey();

  // 1) Tagihan = Σ(total_jual − pendapatan_link) dari sales
  let qs = supabase.from('sales')
    .select('total_jual, pendapatan_link, created_at')
    .eq('owner_id', OWNER_ID);
  if (scope.col && scope.val) qs = qs.eq(scope.col, scope.val);
  if (gte) qs = qs.gte('created_at', gte);
  if (lt)  qs = qs.lt ('created_at', lt);
  const { data: srows, error: sErr } = await qs;
  if (sErr) throw sErr;
  const totalTagihan = (srows||[]).reduce((a,r)=> a + (Number(r?.total_jual||0) - Number(r?.pendapatan_link||0)), 0);

  // 2) Total setoran dari deposits (pakai tanggal_setor bila ada)
  let qd = supabase.from('deposits')
    .select('amount, tanggal_setor, created_at, owner_id, link_id, mitracabang_id, cabang_id')
    .eq('owner_id', OWNER_ID);
  if (scope.col && scope.val) qd = qd.eq(scope.col, scope.val);
  const { data: drows, error: dErr } = await qd;
  if (dErr) throw dErr;

  const lo = gte ? new Date(gte).getTime() : -Infinity;
  const hi = lt  ? new Date(lt).getTime()  :  Infinity;
  const depFiltered = (drows||[]).filter(r=>{
    const s = (r && r.tanggal_setor) ? r.tanggal_setor : r?.created_at;
    const t = s ? new Date(s).getTime() : 0;
    return t>=lo && t<hi;
  });
  const totalSetor = depFiltered.reduce((a,r)=> a + Number(r?.amount||0), 0);

  const sisa = totalTagihan - totalSetor;

  // Render
  $('#kpiTagihanOwner') && ($('#kpiTagihanOwner').textContent = rp(totalTagihan));
  $('#kpiTotalSetor')   && ($('#kpiTotalSetor').textContent   = rp(totalSetor));
  $('#kpiSisaSetor')    && ($('#kpiSisaSetor').textContent    = rp(sisa));
}

/* ---------- Data pendukung kartu-kartu ---------- */
// Stok LINK-only (agar tidak dobel dari level lain)
async function fetchStokLinkOnly(){
  const r = String(me.role||'').toLowerCase();

  if (r==='link'){
    const { data, error } = await supabase.from('stok')
      .select('jumlah').eq('owner_id', OWNER_ID).eq('link_id', me.id);
    if (error) return [];
    return data||[];
  }

  // owner/admin/mitra/cabang → kumpulkan id link dalam scope
  let qp = supabase.from('profiles').select('id').eq('owner_id', OWNER_ID).eq('role','link');
  if (r==='cabang') qp = qp.eq('cabang_id', me.id);
  if (['mitra-cabang','mitracabang'].includes(r)) qp = qp.eq('mitracabang_id', me.id);
  const { data: links } = await qp;
  const ids = (links||[]).map(x=>x.id);
  if (!ids.length) return [];

  const { data, error } = await supabase.from('stok')
    .select('jumlah').eq('owner_id', OWNER_ID).in('link_id', ids);
  if (error) return [];
  return data||[];
}

async function fetchSalesInPeriod(){
  const { gte, lt } = isoRangeFromInputs('#from','#to');
  const scope = scopeKey();
  let q = supabase.from('sales')
    .select('qty,total_jual,pendapatan_link,pendapatan_cabang,pendapatan_mitracabang,owner_id,mitracabang_id,cabang_id,link_id,created_at')
    .eq('owner_id', OWNER_ID);
  if (scope.col && scope.val) q = q.eq(scope.col, scope.val);
  if (gte) q = q.gte('created_at', gte);
  if (lt)  q = q.lt ('created_at', lt);
  const { data, error } = await q;
  if (error) throw error;
  return data||[];
}

function sum(arr, pick){ let x=0; for(const r of (arr||[])) x += Number(pick(r)||0); return x; }
const sumQty = (rows) => sum(rows, r => r?.qty);

/* ---------- Kartu metrik ---------- */
function card(label, value, sub=''){
  return `
    <div class="card">
      <div class="fs-12 opacity-70">${label}</div>
      <div class="fw-800">${value ?? '—'}</div>
      ${sub ? `<div class="fs-12 opacity-70">${sub}</div>` : ''}
    </div>
  `;
}

async function refreshMetrics(){
  const roleLower = String(me.role||'').toLowerCase();
  const [stokRows, salesRows] = await Promise.all([ fetchStokLinkOnly(), fetchSalesInPeriod() ]);

  // Total voucher tersedia (snapshot stok LINK)
  const totalVoucherAda = sum(stokRows, r => r?.jumlah);

  // Total voucher terjual (periode) dari sales
  const totalVoucherTerjual = sumQty(salesRows);

  // Pendapatan sesuai role
  let pendapatan = 0;
  if (roleLower==='owner' || roleLower==='admin'){
    // Rumus selaras laporan: owner = total_jual − (pl + pc + pm)
    pendapatan = salesRows.reduce((a,r)=>{
      const tj = Number(r?.total_jual||0);
      const pl = Number(r?.pendapatan_link||0);
      const pc = Number(r?.pendapatan_cabang||0);
      const pm = Number(r?.pendapatan_mitracabang||0);
      return a + (tj - (pl+pc+pm));
    },0);
  } else if (['mitra-cabang','mitracabang'].includes(roleLower)){
    pendapatan = sum(salesRows, r=> r?.pendapatan_mitracabang);
  } else if (roleLower==='cabang'){
    pendapatan = sum(salesRows, r=> r?.pendapatan_cabang);
  } else if (roleLower==='link'){
    pendapatan = sum(salesRows, r=> r?.pendapatan_link);
  }

  // Distinct counts (berdasar transaksi periode)
  const distinctCount = (rows,key)=>{ const s=new Set(); for(const r of rows||[]) if(r?.[key]) s.add(r[key]); return s.size; };
  let totalMitra=null,totalCabang=null,totalLink=null;
  if (roleLower==='owner' || roleLower==='admin'){
    totalMitra  = distinctCount(salesRows,'mitracabang_id');
    totalCabang = distinctCount(salesRows,'cabang_id');
    totalLink   = distinctCount(salesRows,'link_id');
  } else if (['mitra-cabang','mitracabang'].includes(roleLower)){
    totalCabang = distinctCount(salesRows,'cabang_id');
    totalLink   = distinctCount(salesRows,'link_id');
  } else if (roleLower==='cabang'){
    totalLink   = distinctCount(salesRows,'link_id');
  }

  const periodeText = `${$('#from')?.value||'—'} s/d ${$('#to')?.value||'—'}`;
  const blocks = [];
  if (roleLower==='owner' || roleLower==='admin'){
    blocks.push(card('Total Voucher Tersedia (semua link)', nf(totalVoucherAda)));
    blocks.push(card('Total Voucher Terjual (periode)', nf(totalVoucherTerjual), periodeText));
    blocks.push(card('Pendapatan Owner (periode)', rp(pendapatan), periodeText));
    blocks.push(card('Total Mitra Cabang (periode)', nf(totalMitra)));
    blocks.push(card('Total Cabang (periode)', nf(totalCabang)));
    blocks.push(card('Total Link (periode)', nf(totalLink)));
  } else if (['mitra-cabang','mitracabang'].includes(roleLower)){
    blocks.push(card('Total Voucher Tersedia (semua cabang)', nf(totalVoucherAda)));
    blocks.push(card('Total Voucher Terjual (periode)', nf(totalVoucherTerjual), periodeText));
    blocks.push(card('Pendapatan Mitra (periode)', rp(pendapatan), periodeText));
    blocks.push(card('Total Cabang (periode)', nf(totalCabang)));
    blocks.push(card('Total Link (periode)', nf(totalLink)));
  } else if (roleLower==='cabang'){
    blocks.push(card('Total Voucher Tersedia (link di cabang ini)', nf(totalVoucherAda)));
    blocks.push(card('Total Voucher Terjual (periode)', nf(totalVoucherTerjual), periodeText));
    blocks.push(card('Pendapatan Cabang (periode)', rp(pendapatan), periodeText));
    blocks.push(card('Total Link di Cabang Ini (periode)', nf(totalLink)));
  } else if (roleLower==='link'){
    blocks.push(card('Total Voucher Dimiliki (link ini)', nf(totalVoucherAda)));
    blocks.push(card('Total Voucher Terjual (periode)', nf(totalVoucherTerjual), periodeText));
    blocks.push(card('Pendapatan Link (periode)', rp(pendapatan), periodeText));
  } else {
    blocks.push(card('Info', 'Peran tidak dikenali', 'Hubungi admin.'));
  }
  $('#metricCards') && ($('#metricCards').innerHTML = blocks.join(''));
}

/* ---------- Orkestrasi ---------- */
async function refreshAll(){
  try{
    await refreshKpi();       // Tagihan/Setor/Sisa
    await refreshMetrics();   // Kartu-kartu lain
  }catch(e){
    console.error(e);
    ['kpiTagihanOwner','kpiTotalSetor','kpiSisaSetor'].forEach(id=>{
      const el = document.getElementById(id);
      if (el) el.textContent = '—';
    });
    alert(explainSupabaseError(e));
  }
}
