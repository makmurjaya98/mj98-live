// /js/setoran.js — MJ98 (created_at only, deposits + rumus tagihan + GUARD nominal)
// v2: Riwayat di UI hanya 3 setoran terakhir oleh owner/admin; export tetap full
'use strict';

import {
  supabase,
  getProfile,
  orgIdOf,
  isoRangeFromInputs,
  explainSupabaseError,
  toRp,
} from './supabase-init.js';

/* ===== Helpers ===== */
const $  = (q, el=document) => el.querySelector(q);
const $$ = (q, el=document) => Array.from(el.querySelectorAll(q));
const ymd = (d) => d?.toISOString?.().slice(0,10);
const dtLocal = (d) => {
  if (!d) return '';
  const t = new Date(d);
  const pad = (x)=>String(x).padStart(2,'0');
  return `${t.getFullYear()}-${pad(t.getMonth()+1)}-${pad(t.getDate())}T${pad(t.getHours())}:${pad(t.getMinutes())}`;
};
async function ensureSheetJS(){
  if (window.XLSX) return true;
  try {
    await new Promise((resolve)=>{ const s=document.createElement('script');
      s.src='https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
      s.onload=resolve; s.onerror=resolve; document.head.appendChild(s);
    });
  } catch {}
  return !!window.XLSX;
}
const isMitra = (r)=> ['mitra-cabang','mitracabang'].includes(String(r||'').toLowerCase());
const colMissing = (e)=> /column .* does not exist/i.test(String(e?.message||e||'')); // deteksi kolom hilang

/* ===== State ===== */
let me = null;
let ORG_OWNER = null;
let rows = [];      // HANYA untuk tampilan (maks 3 terakhir oleh owner/admin)
let rowsAll = [];   // SELURUH hasil (untuk export/print penuh)
let summary = { tagihan:0, disetor:0, sisa:0, last_date:null };

let selMitra = null;
let selCabang = null;
let selLink = null;

/* ===== Boot ===== */
window.addEventListener('DOMContentLoaded', init);

async function init(){
  // Profil via helper (patuh RLS)
  me = await getProfile('id, role, owner_id, mitracabang_id, cabang_id, username, full_name');
  if(!me){ location.replace('index.html'); return; }
  ORG_OWNER = orgIdOf(me);

  // Default date range 30 hari
  const to = new Date();
  const from = new Date(); from.setDate(to.getDate()-30);
  $('#dateFrom').value = ymd(from);
  $('#dateTo').value   = ymd(to);

  // Tombol tambah utk owner/admin
  if (['owner','admin'].includes(String(me.role).toLowerCase())) $('#btnAdd').style.display = '';

  // Events
  $('#btnReload')?.addEventListener('click', reloadAll);
  $('#btnExportCSV')?.addEventListener('click', exportCSV);
  $('#btnExportXLSX')?.addEventListener('click', exportXLSX);
  $('#btnPrint')?.addEventListener('click', doPrint);
  $('#btnAdd')?.addEventListener('click', openAdd);
  $('#btnCancel')?.addEventListener('click', closeAdd);
  $('#btnSave')?.addEventListener('click', saveDeposit);
  $('#dateFrom')?.addEventListener('keydown', e=>{ if(e.key==='Enter') reloadAll(); });
  $('#dateTo')  ?.addEventListener('keydown', e=>{ if(e.key==='Enter') reloadAll(); });

  $('#filterMitra')?.addEventListener('change', async e=>{
    selMitra = e.target.value || null;
    await loadCabang(); await loadLinks();
    await reloadAll();
  });
  $('#filterCabang')?.addEventListener('change', async e=>{
    selCabang = e.target.value || null;
    await loadLinks();
    await reloadAll();
  });
  $('#linkSelect')?.addEventListener('change', async e=>{
    selLink = e.target.value || null;
    await reloadAll();
  });

  await setupFiltersByRole();
  await reloadAll();
}

/* ===== Filters (Owner/Admin → Mitra → Cabang → Link) ===== */
async function setupFiltersByRole(){
  if (['owner','admin'].includes(String(me.role).toLowerCase())){
    await loadMitra(); await loadCabang(); await loadLinks();
    return;
  }
  if (isMitra(me.role)){
    selMitra = me.id;
    $('#filterMitra').innerHTML = `<option value="${me.id}">${me.username}</option>`;
    $('#filterMitra').disabled = true;
    await loadCabang(); await loadLinks();
    return;
  }
  if (String(me.role).toLowerCase() === 'cabang'){
    selMitra = me.mitracabang_id || null;
    selCabang = me.id;
    if (selMitra){
      const { data:mitra } = await supabase.from('profiles')
        .select('id, username').eq('id', selMitra).maybeSingle();
      $('#filterMitra').innerHTML = mitra ? `<option value="${mitra.id}">${mitra.username}</option>` : `<option value="">(Mitra)</option>`;
    } else {
      $('#filterMitra').innerHTML = `<option value="">(Mitra)</option>`;
    }
    $('#filterMitra').disabled = true;
    $('#filterCabang').innerHTML = `<option value="${me.id}">${me.username}</option>`;
    $('#filterCabang').disabled = true;
    await loadLinks();
    return;
  }
  if (String(me.role).toLowerCase() === 'link'){
    $('#filterMitra').style.display = 'none';
    $('#filterCabang').style.display = 'none';
    $('#linkSelect').innerHTML = `<option value="${me.id}">${me.username}</option>`;
    $('#linkSelect').disabled = true;
    selLink = me.id;
    $('#fLink').innerHTML = $('#linkSelect').innerHTML;
    return;
  }
}

async function loadMitra(){
  const { data, error } = await supabase.from('profiles')
    .select('id, username, full_name, owner_id, role')
    .in('role', ['mitra-cabang','mitracabang'])
    .eq('owner_id', ORG_OWNER)
    .order('username',{ascending:true});
  if (error){ console.error(error); alert('Gagal memuat Mitra Cabang: ' + explainSupabaseError(error)); return; }

  const opts = [`<option value="">(Semua Mitra Cabang)</option>`]
    .concat((data||[]).map(m=>`<option value="${m.id}">${m.username}</option>`));
  $('#filterMitra').innerHTML = opts.join('');
  selMitra = $('#filterMitra').value || null;
}

async function loadCabang(){
  let q = supabase.from('profiles')
    .select('id, username, full_name, mitracabang_id, role, owner_id')
    .eq('role','cabang')
    .eq('owner_id', ORG_OWNER);

  if (selMitra) q = q.eq('mitracabang_id', selMitra);
  if (isMitra(me.role)) q = q.eq('mitracabang_id', me.id);

  const { data, error } = await q.order('username',{ascending:true});
  if (error){ console.error(error); alert('Gagal memuat Cabang: ' + explainSupabaseError(error)); return; }

  const opts = (['owner','admin'].includes(String(me.role).toLowerCase()) || isMitra(me.role))
    ? [`<option value="">(Semua Cabang)</option>`]
    : [];
  $('#filterCabang').innerHTML = opts.concat((data||[]).map(c=>`<option value="${c.id}">${c.username}</option>`)).join('');
  selCabang = $('#filterCabang').value || null;
}

async function loadLinks(){
  let q = supabase.from('profiles')
    .select('id, username, full_name, owner_id, mitracabang_id, cabang_id')
    .eq('role','link')
    .eq('owner_id', ORG_OWNER);

  if (isMitra(me.role)) q = q.eq('mitracabang_id', me.id);
  if (String(me.role).toLowerCase()==='cabang') q = q.eq('cabang_id', me.id);
  if (selMitra)  q = q.eq('mitracabang_id', selMitra);
  if (selCabang) q = q.eq('cabang_id', selCabang);

  const { data, error } = await q.order('username',{ascending:true});
  if (error){
    console.error('loadLinks error:', error);
    alert('Gagal memuat Link: ' + explainSupabaseError(error));
    $('#linkSelect').innerHTML = '';
    $('#fLink').innerHTML = '';
    selLink = null;
    return;
  }

  const select = $('#linkSelect');
  select.innerHTML = (data||[]).map(l=>`<option value="${l.id}">${l.username}</option>`).join('');

  if (select.options.length){
    if (!select.value) select.selectedIndex = 0;
    selLink = select.value;
  } else {
    selLink = null;
  }
  $('#fLink').innerHTML = select.innerHTML;
}

/* ===== Utility: hitung tagihan berdasar sales (rumus final) ===== */
async function computeTotalTagihan(linkId){
  const { gte, lt } = isoRangeFromInputs('#dateFrom','#dateTo');
  let q = supabase.from('sales')
    .select('total_jual, pendapatan_link, created_at, owner_id')
    .eq('link_id', linkId)
    .eq('owner_id', ORG_OWNER);
  if (gte) q = q.gte('created_at', gte);
  if (lt ) q = q.lt ('created_at', lt);
  const { data, error } = await q;
  if (error){ throw error; }
  // RUMUS FINAL: Σ(total_jual) − Σ(pendapatan_link)
  let sumTotalJual = 0, sumPendLink = 0;
  for(const r of (data||[])){ sumTotalJual += Number(r.total_jual||0); sumPendLink += Number(r.pendapatan_link||0); }
  return sumTotalJual - sumPendLink;
}

/* ===== Utility: sum deposits (for live guard) — langsung ke `deposits` ===== */
async function sumDeposits(linkId){
  const { gte, lt } = isoRangeFromInputs('#dateFrom','#dateTo');
  let q = supabase.from('deposits')
    .select('amount, created_at, owner_id')
    .eq('link_id', linkId)
    .eq('owner_id', ORG_OWNER);
  if (gte) q = q.gte('created_at', gte);
  if (lt ) q = q.lt ('created_at', lt);
  const { data, error } = await q;
  if (error) throw error;
  return (data||[]).reduce((a,r)=> a + Number(r.amount||0), 0);
}

/* ===== Utility: live summary (fresh, sebelum insert) ===== */
async function getLiveSummary(linkId){
  const tagihan = await computeTotalTagihan(linkId);
  const disetor = await sumDeposits(linkId);
  const sisa = Math.max(0, tagihan - disetor);
  return { tagihan, disetor, sisa };
}

/* ===== Reload data (summary + table) ===== */
async function reloadAll(){
  selLink = selLink || $('#linkSelect')?.value || null;
  if (!selLink){ resetCards(); return; }
  await loadSummary(selLink);
  await loadTable(selLink);
}

const resetCards = ()=>{
  $('#card-tagihan').textContent = 'Rp 0';
  $('#card-disetor').textContent = 'Rp 0';
  $('#card-sisa').textContent    = 'Rp 0';
  $('#last-date').textContent    = 'Terakhir setor: -';
  const badge = $('#card-status');
  if (badge){ badge.textContent='-'; badge.classList.remove('ok','warn'); }
  const tbody = $('#tbl tbody'); if (tbody) tbody.innerHTML='';
  $('#mismatch') && ($('#mismatch').style.display='none');
};

/* ===== Summary (sales vs deposits) ===== */
async function loadSummary(linkId){
  try{
    // 1) Tagihan dari SALES (rumus benar)
    const tagihan = await computeTotalTagihan(linkId);

    // 2) Disetor dari tabel `deposits` (created_at)
    const { gte, lt } = isoRangeFromInputs('#dateFrom','#dateTo');
    let { data:depRows, error:dErr } = await supabase.from('deposits')
      .select('amount, created_at, tanggal_setor, owner_id')
      .eq('link_id', linkId)
      .eq('owner_id', ORG_OWNER)
      .order('created_at', { ascending:false });
    if (gte) depRows = (depRows||[]).filter(r => new Date(r.created_at) >= new Date(gte));
    if (lt ) depRows = (depRows||[]).filter(r => new Date(r.created_at)  < new Date(lt));
    if (dErr) throw dErr;

    const disetor = (depRows||[]).reduce((a,r)=> a + Number(r.amount||0), 0);
    const last = (depRows?.[0]?.tanggal_setor || depRows?.[0]?.created_at) || null;
    const sisa = Math.max(0, tagihan - disetor);

    summary = { tagihan, disetor, sisa, last_date:last };

    // Render
    $('#card-tagihan').textContent = toRp(tagihan);
    $('#card-disetor').textContent = toRp(disetor);
    $('#card-sisa').textContent    = toRp(sisa);
    $('#last-date').textContent    = 'Terakhir setor: ' + (last ? new Date(last).toLocaleString('id-ID') : '-');

    const badge = $('#card-status');
    if (badge){
      badge.textContent = (sisa <= 0) ? 'Lunas' : 'Belum lunas';
      badge.classList.toggle('ok', sisa <= 0);
      badge.classList.toggle('warn', sisa > 0);
    }
    $('#mismatch') && ($('#mismatch').style.display = 'none');
  }catch(e){
    console.error(e);
    alert('Gagal memuat ringkasan setoran: ' + (explainSupabaseError(e) || e.message || e.code || 'unknown'));
  }
}

/* ===== Table (tampilkan 3 terakhir oleh owner/admin; export full) ===== */
async function loadTable(linkId){
  const { gte, lt } = isoRangeFromInputs('#dateFrom','#dateTo');

  // Ambil seluruh deposits sesuai filter (scoped owner)
  let q = supabase.from('deposits')
    .select('id, link_id, amount, catatan, note, created_at, tanggal_setor, admin_input_by, owner_id')
    .eq('link_id', linkId)
    .eq('owner_id', ORG_OWNER)
    .order('created_at', { ascending:false });
  if (gte) q = q.gte('created_at', gte);
  if (lt ) q = q.lt ('created_at', lt);

  const { data, error } = await q;
  if (error){ console.error(error); alert('Gagal memuat tabel setoran: ' + explainSupabaseError(error)); return; }

  // Ambil username untuk link terkait
  const ids = [...new Set((data||[]).map(r=>r.link_id).filter(Boolean))];
  let nameMap = new Map();
  if (ids.length){
    const { data: profs } = await supabase.from('profiles')
      .select('id, username')
      .in('id', ids);
    (profs||[]).forEach(p=> nameMap.set(p.id, p.username));
  }

  // Siapkan ALL rows untuk export
  rowsAll = (data||[]).map(r => ({
    id: r.id,
    at: r.tanggal_setor || r.created_at,
    username: nameMap.get(r.link_id) || $('#linkSelect')?.selectedOptions?.[0]?.text || '',
    amount: Number(r.amount ?? 0),
    catatan: (r.catatan ?? r.note ?? ''),
    admin: r.admin_input_by || ''
  }));

  // Filter hanya yang diinput oleh owner/admin (di organisasi ini), ambil 3 terbaru
  const { data: admins } = await supabase.from('profiles')
    .select('id')
    .eq('owner_id', ORG_OWNER)
    .in('role', ['owner','admin']);
  const adminSet = new Set((admins||[]).map(a=>a.id));
  rows = rowsAll.filter(r => adminSet.has(r.admin)).slice(0,3);

  // Render tabel minimal (3 baris)
  const tbody = $('#tbl tbody');
  if (!rows.length){
    tbody.innerHTML = `<tr><td colspan="5">Belum ada setoran oleh owner/admin pada periode ini. Gunakan <b>Export</b> untuk riwayat lengkap.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td>${ new Date(r.at).toLocaleString('id-ID') }</td>
      <td>${ r.username || '-' }</td>
      <td class="t-right">${ toRp(r.amount) }</td>
      <td>${ r.catatan }</td>
      <td><code>${ r.admin?.slice(0,8) || '-' }</code></td>
    </tr>
  `).join('');
}

/* ===== Add Deposit (with GUARD) ===== */
function openAdd(){
  if (!['owner','admin'].includes(String(me.role).toLowerCase())){ alert('Hanya Owner/Admin yang boleh menambah setoran'); return; }
  $('#fLink').value = selLink || $('#linkSelect').value || '';
  $('#fTanggal').value = dtLocal(new Date()); // tampilan saja, disabled
  $('#fAmount').value = '';
  $('#fCatatan').value = '';
  // set batas maksimal input berdasar ringkasan saat ini
  const maxNow = Math.max(0, Math.floor(Number(summary.sisa)||0));
  $('#fAmount').setAttribute('max', String(maxNow));
  $('#fAmount').setAttribute('aria-valuemax', String(maxNow));
  $('#precalc').textContent = `Sisa sebelum setor: ${toRp(summary.sisa)} • Total tagihan: ${toRp(summary.tagihan)}`;
  // guard realtime input
  $('#fAmount').oninput = (e)=>{
    const max = Number(e.target.max || 0);
    let v = Number(e.target.value || 0);
    if (max > 0 && v > max) e.target.value = String(max);
    if (v < 0) e.target.value = '0';
  };
  $('#dlg').style.display = '';
  window.scrollTo({top:0, behavior:'smooth'});
}
function closeAdd(){ $('#dlg').style.display = 'none'; }

/* ===== Insert helper dengan fallback payload ===== */
async function insertDepositWithFallback({ link_id, amount, catatan, live }) {
  // payload paling lengkap hingga minimal — urutkan supaya aman di berbagai versi DB
  const payloads = [
    { link_id, admin_input_by: me.id, amount, total_tagihan: live.tagihan, sisa_sebelumnya: live.sisa, catatan },
    { link_id, admin_input_by: me.id, amount, total_tagihan: live.tagihan, sisa_sebelumnya: live.sisa, note: catatan },
    { link_id, admin_input_by: me.id, amount, catatan },
    { link_id, admin_input_by: me.id, amount, note: catatan },
    { link_id, amount, catatan },
    { link_id, amount, note: catatan },
    { link_id, amount },
  ];

  let lastErr = null;
  for (const p of payloads) {
    const { error } = await supabase.from('deposits').insert(p);
    if (!error) return true;
    lastErr = error;
    if (!colMissing(error)) break; // jika error lain (bukan kolom hilang), stop
  }
  if (lastErr) throw lastErr;
  return false;
}

/* ===== Save (GUARD: cek ulang ke DB) ===== */
async function saveDeposit(){
  try{
    const link_id = $('#fLink').value;
    const amount  = Number($('#fAmount').value || 0);
    const catatan = $('#fCatatan').value?.trim() || null;

    if (!link_id || !amount || amount <= 0){ alert('Isi Link & jumlah setoran > 0'); return; }

    // GUARD 2: cek ulang ke DB
    const live = await getLiveSummary(link_id); // {tagihan, disetor, sisa}
    if (amount > live.sisa){
      alert(`Nominal melebihi sisa setoran.\nSisa saat ini: ${toRp(live.sisa)}.\nSilakan masukkan nominal ≤ sisa.`);
      $('#fAmount').value = String(Math.max(0, Math.floor(live.sisa)));
      $('#precalc').textContent = `Sisa sebelum setor: ${toRp(live.sisa)} • Total tagihan: ${toRp(live.tagihan)}`;
      return;
    }

    // Insert ke deposits (fallback-friendly). created_at & tanggal_setor by default now(), owner_id via trigger.
    await insertDepositWithFallback({ link_id, amount, catatan, live });

    closeAdd();
    await reloadAll();
    // feedback visual: scroll ke histori terbaru
    document.querySelector('#tbl tbody tr')?.scrollIntoView({behavior:'smooth', block:'center'});
    alert('Setoran tersimpan.');
  }catch(e){
    console.error(e);
    alert('Gagal menyimpan setoran: ' + (explainSupabaseError(e) || e.message || e.code || 'unknown'));
  }
}

/* ===== Export / Print ===== */
function exportCSV(){
  if (!rowsAll.length){ alert('Tidak ada data.'); return; }
  const head = ['tanggal','username_link','amount','catatan','admin_input_by'];
  const csv = [
    head.join(','),
    ...rowsAll.map(r => [
      (new Date(r.at)).toISOString(),
      (r.username||'').replaceAll('"','""'),
      Number(r.amount||0),
      JSON.stringify(r.catatan||'').replaceAll('"','""'),
      (r.admin||'')
    ].join(','))
  ].join('\n');

  const blob = new Blob([csv], {type:'text/csv'});
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: `setoran-${new Date().toISOString().slice(0,10)}.csv`
  });
  document.body.appendChild(a); a.click(); a.remove();
}

async function exportXLSX(){
  if (!rowsAll.length){ alert('Tidak ada data.'); return; }
  if (await ensureSheetJS()){
    const aoa = [];
    const name = $('#linkSelect')?.selectedOptions?.[0]?.text || '';
    aoa.push([`Ringkasan Setoran – ${name}`]);
    aoa.push([`Periode: ${$('#dateFrom').value || '-'} s/d ${$('#dateTo').value || '-'}`]);
    aoa.push([`Tagihan`, summary.tagihan, `Disetor`, summary.disetor, `Sisa`, summary.sisa]);
    aoa.push([]);
    aoa.push(['Tanggal','Username Link','Jumlah','Catatan','Diinput Oleh']);
    rowsAll.forEach(r=>{
      aoa.push([
        new Date(r.at).toLocaleString('id-ID'),
        r.username || '',
        Number(r.amount||0),
        r.catatan || '',
        r.admin || ''
      ]);
    });
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{wch:22},{wch:24},{wch:14},{wch:40},{wch:18}];
    for (let R = 5; R < aoa.length; R++){
      const cell = XLSX.utils.encode_cell({ r:R, c:2 });
      if (ws[cell]) ws[cell].z = '#,##0';
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Setoran');
    XLSX.writeFile(wb, `setoran-${new Date().toISOString().slice(0,10)}.xlsx`);
    return;
  }

  // fallback HTML Excel
  const name = $('#linkSelect')?.selectedOptions?.[0]?.text || '';
  const head = `
    <table border="1">
      <tr><th colspan="5">Ringkasan Setoran – ${name}</th></tr>
      <tr><td colspan="5">Periode: ${$('#dateFrom').value || '-'} s/d ${$('#dateTo').value || '-'}</td></tr>
      <tr><td><b>Tagihan</b></td><td>${summary.tagihan}</td><td><b>Disetor</b></td><td>${summary.disetor}</td><td><b>Sisa</b>: ${summary.sisa}</td></tr>
      <tr></tr>
      <tr><th>Tanggal</th><th>Username Link</th><th>Jumlah</th><th>Catatan</th><th>Diinput Oleh</th></tr>
  `;
  const body = rowsAll.map(r=>`
      <tr>
        <td>${ new Date(r.at).toLocaleString('id-ID') }</td>
        <td>${ r.username||'' }</td>
        <td>${ Number(r.amount||0) }</td>
        <td>${ (r.catatan||'').toString().replace(/</g,'&lt;') }</td>
        <td>${ r.admin||'' }</td>
      </tr>
  `).join('');
  const html = head + body + '</table>';
  const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: `setoran-${new Date().toISOString().slice(0,10)}.xls`
  });
  document.body.appendChild(a); a.click(); a.remove();
}

function doPrint(){
  const w = window.open('', '_blank');
  const styles = `<style>
    body{font-family:system-ui,Segoe UI,Roboto,Arial;padding:16px}
    table{width:100%;border-collapse:collapse}
    th,td{border:1px solid #ddd;padding:6px 8px;font-size:12px}
    th{background:#f3f3f3}
    .t-right{text-align:right}
  </style>`;
  const name = $('#linkSelect')?.selectedOptions?.[0]?.text || '';
  const head = `
    <h3>Riwayat Setoran – ${name}</h3>
    <div>Periode: ${$('#dateFrom').value || '-'} s/d ${$('#dateTo').value || '-'}</div>
    <div>Ringkasan: Tagihan ${toRp(summary.tagihan)} • Disetor ${toRp(summary.disetor)} • Sisa ${toRp(summary.sisa)}</div>
    <div style="margin:6px 0 10px 0;opacity:.75">Menampilkan 3 setoran terakhir oleh owner/admin. Gunakan Export untuk riwayat lengkap.</div>
    <hr/>`;
  const body = $('#tbl').outerHTML;
  w.document.write(styles + head + body);
  w.document.close(); w.focus(); w.print(); w.close();
}
