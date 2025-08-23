// js/voucher.js — MJ98 (Type -> Share; UUID opsional utk mitra/cabang; created_at; refined)
// - Scope ketat per owner (non-owner selalu onlyMine)
// - Validasi harga & persen (0..100)
// - Export XLSX menyertakan nama mitra/cabang + header rapi
// - Selaras DB terbaru: hanya pakai share_link, share_cabang, komisi_*_persen (tanpa *_rp)

'use strict';

import { supabase, getProfile, explainSupabaseError } from "./supabase-init.js";

const $  = (s)=>document.querySelector(s);
const $$ = (s)=>Array.from(document.querySelectorAll(s));

/* ========= UTIL ========= */
const toRp  = (n)=> "Rp " + Number(n || 0).toLocaleString("id-ID");
const asNum = (v)=> (v===""||v==null)?null:Number(v);
const esc   = (s)=> String(s ?? "").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const parsePercent = (raw)=>{ if(raw==null||raw==="") return null; const n=Number(String(raw).trim().replace("%","").replace(",", ".")); return Number.isFinite(n)?n:null; };
const parseMoney   = (raw)=>{ if(raw==null||raw==="") return null; const n=Number(String(raw).replace(/[^\d.-]/g,"")); return Number.isFinite(n)?n:null; };
const hoursFrom = (count, unit)=> (unit==="hari"? Number(count||0)*24 : Number(count||0));
const durToForm = (hours)=> { const h = Number(hours||0); return (h && h%24===0) ? {num:h/24, unit:"hari"} : {num:h||0, unit:"jam"}; };
const isUUID = (s)=> typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
const toUUID = (v)=> (v && isUUID(v) ? v : null);
const err = (e)=> alert(explainSupabaseError(e) || e?.message || String(e));

/* ========= STATE ========= */
let gProf=null, ORG_OWNER=null, IS_OWNER=false;
let gTypesAll=[], gSharesAll=[];
let refMitra=[], refCabang=[];
const nameMap = new Map();

/* ========= KOLOM (hard map) ========= */
const TYPE = {
  id:'id', label:'jenis_voucher', created:'created_at',
  pokok:'harga_pokok', jual:'harga_jual', dur:'durasi',
  owner:'owner_id'
};
const SHARE = {
  id:'id', created:'created_at', owner:'owner_id',
  vtype:'voucher_type_id', mitra:'mitracabang_id', cabang:'cabang_id',
  k_link:'komisi_link_persen', k_cabang:'komisi_cabang_persen', k_mitra:'komisi_mitra_persen',
  s_cabang:'share_cabang', s_link:'share_link'
};

/* ========= REFERENSI (profiles) ========= */
function labelFromProfile(x){
  const nm = x.full_name || x.username || x.id;
  return `${nm} (${String(x.id).slice(0,8)}…)`;
}
async function loadRefs(){
  const { data, error } = await supabase.from('profiles')
    .select('id, role, username, full_name, mitracabang_id, owner_id')
    .eq('owner_id', ORG_OWNER);
  if (error) { console.warn('profiles refs error', error); return; }
  const rows = data || [];

  refMitra  = rows
    .filter(r => ['mitra-cabang','mitracabang'].includes(String(r.role).toLowerCase()))
    .map(r => ({ id:r.id, label:labelFromProfile(r) }));
  refCabang = rows
    .filter(r => String(r.role).toLowerCase()==='cabang')
    .map(r => ({ id:r.id, label:labelFromProfile(r), mitra_id:r.mitracabang_id }));

  nameMap.clear();
  [...refMitra, ...refCabang].forEach(x => nameMap.set(x.id, x.label));

  // asumsikan #list_mitra dan #list_cabang adalah <datalist> untuk input bebas
  if ($("#list_mitra"))  $("#list_mitra").innerHTML  = refMitra.map(x=>`<option value="${esc(x.id)}">${esc(x.label)}</option>`).join('');
  if ($("#list_cabang")) $("#list_cabang").innerHTML = refCabang.map(x=>`<option value="${esc(x.id)}">${esc(x.label)}</option>`).join('');
}

/* ========= LOAD ========= */
async function loadTypes(){
  const onlyMineToggle = $("#onlyMine")?.checked;
  let q = supabase.from("voucher_types")
    .select(`${TYPE.id}, ${TYPE.label}, ${TYPE.pokok}, ${TYPE.jual}, ${TYPE.dur}, ${TYPE.owner}, ${TYPE.created}`)
    .order(TYPE.label, { ascending: true });

  // Non-owner: selalu hanya milik organisasi sendiri
  if (!IS_OWNER || onlyMineToggle) q = q.eq(TYPE.owner, ORG_OWNER);

  const { data, error } = await q;
  if (error) return err(error);
  gTypesAll = data || [];

  if ($("#list_vtype")) {
    $("#list_vtype").innerHTML =
      gTypesAll.map(v=>`<option value="${esc(v[TYPE.id])}">${esc(v[TYPE.label]||'')}</option>`).join("");
  }

  const btnAddShare = $("#btnAddShare");
  if (btnAddShare) btnAddShare.disabled = !gTypesAll.length;
}

async function loadShares(){
  const { data, error } = await supabase
    .from("voucher_share_settings")
    .select(`${SHARE.id}, ${SHARE.created}, ${SHARE.owner}, ${SHARE.vtype}, ${SHARE.mitra}, ${SHARE.cabang}, ${SHARE.k_link}, ${SHARE.k_cabang}, ${SHARE.k_mitra}, ${SHARE.s_cabang}, ${SHARE.s_link}`)
    .eq(SHARE.owner, ORG_OWNER)
    .order(SHARE.created, { ascending:false });
  if (error) return err(error);
  gSharesAll = data || [];
}

/* ========= RENDER ========= */
function renderTypes(){
  const q = ($("#qType")?.value||"").trim().toLowerCase();
  const rows = (gTypesAll||[]).filter(r=> !q || String(r[TYPE.label]||"").toLowerCase().includes(q));

  const thead = `
    <thead>
      <tr>
        ${IS_OWNER ? `<th class="t-left">Aksi</th>` : ''}
        <th class="t-left">Jenis Voucher</th>
        <th class="t-right">Harga Pokok</th>
        <th class="t-right">Harga Jual</th>
        <th class="t-left">Durasi</th>
      </tr>
    </thead>`;

  const tbody = rows.length ? `<tbody>${
    rows.map(r=>{
      const dur = durToForm(r[TYPE.dur]);
      return `
        <tr>
          ${IS_OWNER ? `
            <td class="t-left">
              <button class="btn" data-t="t" data-act="e" data-id="${esc(r[TYPE.id])}">Edit</button>
              <button class="btn" data-t="t" data-act="d" data-id="${esc(r[TYPE.id])}">Hapus</button>
            </td>` : ''
          }
          <td class="t-left">${esc(r[TYPE.label] || '')}</td>
          <td class="t-right">${toRp(r[TYPE.pokok])}</td>
          <td class="t-right">${toRp(r[TYPE.jual])}</td>
          <td class="t-left">${dur.num} ${dur.unit}</td>
        </tr>`;
    }).join('')
  }</tbody>`
  : `<tbody><tr><td class="t-left" colspan="${IS_OWNER?5:4}">Tidak ada data</td></tr></tbody>`;

  $("#tblTypes").innerHTML = thead + tbody;

  if(IS_OWNER){
    $("#tblTypes").querySelectorAll("button[data-t='t']").forEach(btn=>{
      const id=btn.dataset.id;
      const row=gTypesAll.find(x=>String(x[TYPE.id])===String(id));
      if(btn.dataset.act==="e") btn.onclick=()=>openType(row);
      if(btn.dataset.act==="d") btn.onclick=()=>delType(id);
    });
  }
}

function renderShares(){
  const fltM=($("#flt_mitra")?.value||"").trim().toLowerCase();
  const fltC=($("#flt_cabang")?.value||"").trim().toLowerCase();
  const byType = new Map((gTypesAll||[]).map(v=>[String(v[TYPE.id]), v]));

  const rows=(gSharesAll||[]).filter(r=>{
    // filter berbasis ID; jika ingin berbasis nama, ketikkan sebagian id/nama yang tercantum di tabel
    const okM=!fltM || String(r[SHARE.mitra]||"").toLowerCase().includes(fltM) || (nameMap.get(r[SHARE.mitra]||"")||"").toLowerCase().includes(fltM);
    const okC=!fltC || String(r[SHARE.cabang]||"").toLowerCase().includes(fltC) || (nameMap.get(r[SHARE.cabang]||"")||"").toLowerCase().includes(fltC);
    return okM && okC;
  });

  const thead = `
    <thead>
      <tr>
        ${IS_OWNER ? `<th class="t-left">Aksi</th>` : ''}
        <th class="t-left">Voucher</th>
        <th class="t-left">Mitra</th>
        <th class="t-left">Cabang</th>
        <th class="t-left">% Komisi Link</th>
        <th class="t-left">% Komisi Cabang</th>
        <th class="t-left">% Komisi Mitra</th>
        <th class="t-right">Share Cabang</th>
        <th class="t-right">Share Link</th>
        <th class="t-left">Dibuat</th>
      </tr>
    </thead>`;

  const tbody = rows.length ? `<tbody>${
    rows.map(r=>{
      const vt = byType.get(String(r[SHARE.vtype]));
      const mitraLbl  = r[SHARE.mitra]  ? (nameMap.get(r[SHARE.mitra])  || r[SHARE.mitra])  : "—";
      const cabangLbl = r[SHARE.cabang] ? (nameMap.get(r[SHARE.cabang]) || r[SHARE.cabang]) : "—";
      const pct = (v)=> v==null ? '' : `${v}%`;
      return `
        <tr>
          ${IS_OWNER ? `
            <td class="t-left">
              <button class="btn" data-t="s" data-act="e" data-id="${esc(r[SHARE.id])}">Edit</button>
              <button class="btn" data-t="s" data-act="d" data-id="${esc(r[SHARE.id])}">Hapus</button>
            </td>` : ''
          }
          <td class="t-left">${esc(vt?.[TYPE.label] || r[SHARE.vtype] || '')}</td>
          <td class="t-left">${esc(mitraLbl)}</td>
          <td class="t-left">${esc(cabangLbl)}</td>
          <td class="t-left">${pct(r[SHARE.k_link])}</td>
          <td class="t-left">${pct(r[SHARE.k_cabang])}</td>
          <td class="t-left">${pct(r[SHARE.k_mitra])}</td>
          <td class="t-right">${toRp(r[SHARE.s_cabang] ?? 0)}</td>
          <td class="t-right">${toRp(r[SHARE.s_link]   ?? 0)}</td>
          <td class="t-left">${r[SHARE.created] ? new Date(r[SHARE.created]).toLocaleString('id-ID') : '–'}</td>
        </tr>`;
    }).join('')
  }</tbody>`
  : `<tbody><tr><td class="t-left" colspan="${IS_OWNER?10:9}">Tidak ada data</td></tr></tbody>`;

  $("#tblShares").innerHTML = thead + tbody;

  if(IS_OWNER){
    $("#tblShares").querySelectorAll("button[data-t='s']").forEach(btn=>{
      const id=btn.dataset.id;
      const row=gSharesAll.find(x=>String(x[SHARE.id])===String(id));
      if(btn.dataset.act==="e") btn.onclick=()=>openShare(row);
      if(btn.dataset.act==="d") btn.onclick=()=>delShare(id);
    });
  }
}

/* ========= DIALOG: TYPE ========= */
function openType(row){
  $("#dlgTypeTitle").textContent=row?"Edit Tipe":"Tambah Tipe";
  $("#type_id").value    = row?.[TYPE.id] || "";
  $("#type_jenis").value = row?.[TYPE.label] || "";
  $("#type_pokok").value = row?.[TYPE.pokok] ?? "";
  $("#type_jual").value  = row?.[TYPE.jual]  ?? "";
  const d=durToForm(row?.[TYPE.dur]);
  $("#type_dur_num").value  = d.num || "";
  $("#type_dur_unit").value = d.unit || "jam";
  $("#type_owner").value    = row?.[TYPE.owner] || "";
  $("#msgType").textContent = "";
  $("#dlgType").showModal();
}
function payloadType(){
  const p={};
  const jenis=($("#type_jenis").value||"").trim();
  if(jenis) p[TYPE.label]=jenis;
  const pokok=asNum($("#type_pokok").value); if(pokok!=null) p[TYPE.pokok]=pokok;
  const jual =asNum($("#type_jual").value);  if(jual!=null)  p[TYPE.jual]=jual;
  const dnum =asNum($("#type_dur_num").value);
  const dunit=$("#type_dur_unit").value;
  if(dnum!=null) p[TYPE.dur]=hoursFrom(dnum,dunit); // jam
  p[TYPE.owner] = ($("#type_owner").value||"").trim() || ORG_OWNER;
  return p;
}
async function saveType(){
  const id=($("#type_id").value||"").trim();
  const payload=payloadType();
  try{
    if(!IS_OWNER) throw new Error("Akses ditolak.");
    if(!payload[TYPE.label]) throw new Error("jenis_voucher wajib.");
    if(!payload[TYPE.owner]) throw new Error("owner_id tidak terdeteksi.");
    if(payload[TYPE.pokok]!=null && payload[TYPE.jual]!=null && payload[TYPE.jual] < payload[TYPE.pokok]){
      throw new Error("Harga jual tidak boleh lebih kecil dari harga pokok.");
    }

    if(!id){
      const {error}=await supabase.from("voucher_types").insert(payload);
      if(error) throw error;
    }else{
      const {error}=await supabase.from("voucher_types").update(payload).eq(TYPE.id, id).eq(TYPE.owner, ORG_OWNER);
      if(error) throw error;
    }
    $("#dlgType").close();
    await loadTypes(); renderTypes();
  }catch(e){ err(e); }
}
async function delType(id){
  if(!confirm("Hapus tipe voucher ini?")) return;
  const {error}=await supabase.from("voucher_types").delete().eq(TYPE.id, id).eq(TYPE.owner, ORG_OWNER);
  if(error) return err(error);
  await loadTypes(); renderTypes();
}

/* ========= DIALOG: SHARE ========= */
function openShare(row){
  if (!gTypesAll.length){
    alert("Buat dulu Jenis Voucher (Step 1). Setelah itu baru isi Share (Step 2).");
    return;
  }
  $("#dlgShareTitle").textContent=row?"Edit Share":"Tambah Share";
  $("#share_id").value     = row?.[SHARE.id] || "";
  $("#share_vtype").value  = row?.[SHARE.vtype] || "";
  $("#share_mitra").value  = row?.[SHARE.mitra] || "";
  $("#share_cabang").value = row?.[SHARE.cabang] || "";
  $("#share_kl").value     = row?.[SHARE.k_link]   ?? "";
  $("#share_kc").value     = row?.[SHARE.k_cabang] ?? "";
  $("#share_km").value     = row?.[SHARE.k_mitra]  ?? "";
  $("#share_cbg").value    = row?.[SHARE.s_cabang] ?? "";
  $("#share_lk").value     = row?.[SHARE.s_link]   ?? "";
  $("#share_owner").value  = row?.[SHARE.owner] || "";
  $("#msgShare").textContent="";
  $("#dlgShare").showModal();
}
function payloadShare(){
  const p={};
  const vt = ($("#share_vtype").value||"").trim(); if(vt) p[SHARE.vtype]=vt;
  const mid= toUUID(($("#share_mitra").value||"").trim());   if(mid!==undefined) p[SHARE.mitra]=mid;
  const cid= toUUID(($("#share_cabang").value||"").trim());  if(cid!==undefined) p[SHARE.cabang]=cid;
  const kl = parsePercent($("#share_kl").value); if(kl!=null) p[SHARE.k_link]=kl;
  const kc = parsePercent($("#share_kc").value); if(kc!=null) p[SHARE.k_cabang]=kc;
  const km = parsePercent($("#share_km").value); if(km!=null) p[SHARE.k_mitra]=km;
  const sc = parseMoney($("#share_cbg").value);  if(sc!=null) p[SHARE.s_cabang]=sc;
  const sl = parseMoney($("#share_lk").value);   if(sl!=null) p[SHARE.s_link]=sl;
  p[SHARE.owner] = ($("#share_owner").value||"").trim() || ORG_OWNER;
  return p;
}
async function saveShare(){
  const id    = ($("#share_id").value||"").trim(); // siap kalau perlu nanti
  const vtype = ($("#share_vtype").value||"").trim();
  const midRaw= ($("#share_mitra").value||"").trim();
  const cidRaw= ($("#share_cabang").value||"").trim();

  if (!isUUID(vtype)) return err("Pilih Jenis Voucher yang valid (Step 1 dulu jika belum ada).");
  if (midRaw && !isUUID(midRaw)) return err("mitracabang_id tidak valid.");
  if (cidRaw && !isUUID(cidRaw)) return err("cabang_id tidak valid.");

  const payload = payloadShare();

  for(const [nm,key] of [['Komisi Link',SHARE.k_link],['Komisi Cabang',SHARE.k_cabang],['Komisi Mitra',SHARE.k_mitra]]){
    const v = payload[key];
    if(v!=null && (v<0 || v>100)) return err(`${nm} harus 0..100`);
  }
  if (payload[SHARE.s_cabang]!=null && payload[SHARE.s_cabang]<0) return err("Share Cabang tidak boleh negatif");
  if (payload[SHARE.s_link]!=null   && payload[SHARE.s_link]  <0) return err("Share Link tidak boleh negatif");

  try{
    const { error } = await supabase
      .from("voucher_share_settings")
      .upsert(payload, {
        onConflict: "owner_id,mitracabang_id,cabang_id,voucher_type_id",
        ignoreDuplicates: false
      })
      .select()
      .single();

    if (error) throw error;

    $("#dlgShare").close();
    await loadShares();
    renderShares();
  }catch(e){ err(e); }
}
async function delShare(id){
  if(!confirm("Hapus share setting ini?")) return;
  const {error}=await supabase.from("voucher_share_settings").delete().eq(SHARE.id, id).eq(SHARE.owner, ORG_OWNER);
  if(error) return err(error);
  await loadShares(); renderShares();
}

/* ========= EXPORT ========= */
function rowsForExportTypes(){
  return (gTypesAll||[]).map(t=>{
    const d = durToForm(t[TYPE.dur]);
    return {
      id: t[TYPE.id],
      jenis_voucher: t[TYPE.label] || "",
      harga_pokok: t[TYPE.pokok] ?? null,
      harga_jual:  t[TYPE.jual]  ?? null,
      durasi_jam:  t[TYPE.dur]   ?? null,
      durasi_label: `${d.num||0} ${d.unit}`,
      owner_id: t[TYPE.owner] || "",
      created_at: t[TYPE.created] || null
    };
  });
}
function rowsForExportShares(){
  const byType = new Map((gTypesAll||[]).map(v=>[String(v[TYPE.id]), v]));
  return (gSharesAll||[]).map(s=>{
    const vt = byType.get(String(s[SHARE.vtype]));
    return {
      id: s[SHARE.id],
      voucher_type_id: s[SHARE.vtype] || "",
      jenis_voucher: vt?.[TYPE.label] || "",
      mitracabang_id: s[SHARE.mitra] || "",
      mitra_nama: s[SHARE.mitra] ? (nameMap.get(s[SHARE.mitra]) || '') : '',
      cabang_id: s[SHARE.cabang] || "",
      cabang_nama: s[SHARE.cabang] ? (nameMap.get(s[SHARE.cabang]) || '') : '',
      komisi_link_persen:  s[SHARE.k_link]   ?? null,
      komisi_cabang_persen:s[SHARE.k_cabang] ?? null,
      komisi_mitra_persen: s[SHARE.k_mitra]  ?? null,
      share_cabang: s[SHARE.s_cabang] ?? null,
      share_link:   s[SHARE.s_link]   ?? null,
      owner_id: s[SHARE.owner] || "",
      created_at: s[SHARE.created] || null
    };
  });
}

/* ========= BOOT ========= */
(async ()=>{
  gProf = await getProfile("id,role,owner_id,username,full_name");
  if(!gProf){ location.replace("index.html"); return; }
  $("#who") && ($("#who").textContent=`${gProf.full_name||gProf.username} (${gProf.role})`);
  IS_OWNER = ["owner","admin"].includes(String(gProf.role).toLowerCase());
  ORG_OWNER = gProf.owner_id || gProf.id;

  if(!IS_OWNER){ $("#btnAddType")?.remove(); $("#btnAddShare")?.remove(); }

  $("#btnAddType")?.addEventListener("click", ()=>openType(null));
  $("#btnTypeSave")?.addEventListener("click", (e)=>{e.preventDefault(); saveType();});

  $("#btnAddShare")?.addEventListener("click", ()=>openShare(null));
  $("#btnShareSave")?.addEventListener("click", (e)=>{e.preventDefault(); saveShare();});

  $("#onlyMine")?.addEventListener("change", async ()=>{ await loadTypes(); renderTypes(); });
  $("#qType")?.addEventListener("input", ()=> renderTypes());

  $("#btnFilter")?.addEventListener("click", ()=> renderShares());
  $("#btnClear") ?.addEventListener("click", ()=>{ $("#flt_mitra").value=""; $("#flt_cabang").value=""; renderShares(); });

  // bantu pengguna: clamp input persen 0..100 saat blur
  ["#share_kl","#share_kc","#share_km"].forEach(sel=>{
    const el=$(sel); if(!el) return;
    el.addEventListener("blur", ()=>{
      const n=parsePercent(el.value);
      if(n==null) return;
      el.value = Math.max(0, Math.min(100, n)).toString();
    });
  });

  $("#exportXlsx")?.addEventListener("click", async ()=>{
    try{
      const { utils, writeFile } = await import("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm");
      const wb=utils.book_new();

      const rowsT = rowsForExportTypes();
      const headerT = ["id","jenis_voucher","harga_pokok","harga_jual","durasi_jam","durasi_label","owner_id","created_at"];
      const shT = utils.json_to_sheet(rowsT, { header: headerT });
      utils.book_append_sheet(wb, shT, "voucher_types");

      const rowsS = rowsForExportShares();
      const headerS = ["id","voucher_type_id","jenis_voucher","mitracabang_id","mitra_nama","cabang_id","cabang_nama","komisi_link_persen","komisi_cabang_persen","komisi_mitra_persen","share_cabang","share_link","owner_id","created_at"];
      const shS = utils.json_to_sheet(rowsS, { header: headerS });
      utils.book_append_sheet(wb, shS, "share_settings");

      writeFile(wb,"voucher.xlsx");
    }catch(e){ err(e); }
  });

  await loadRefs();
  await loadTypes();
  await loadShares();
  renderTypes();
  renderShares();
})();
