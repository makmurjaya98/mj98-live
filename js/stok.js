// js/stok.js — Halaman Stok MJ98 (agregasi klien, patuh RLS, export Excel)
// Auto-fallback bila RPC lama di DB masih refer ke share_link_rp, dsb.
"use strict";

import {
  supabase,
  getProfile,
  signOutAndRedirect,
  rpcRecordVoucherSale,
  explainSupabaseError,
} from "./supabase-init.js";

/* =================== Helpers =================== */
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (m) => ESC_MAP[m]);
const toID = (n) => Number(n || 0).toLocaleString("id-ID");
const isUUID = (s) =>
  typeof s === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
const ymd = (d) => d.toISOString().slice(0, 10);

// sheetjs loader (sama seperti di setoran.js)
async function ensureSheetJS() {
  if (window.XLSX) return true;
  try {
    await new Promise((ok) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
      s.onload = ok;
      s.onerror = ok;
      document.head.appendChild(s);
    });
  } catch {}
  return !!window.XLSX;
}

function disableWhileLoading(on = true) {
  $$("#filterForm button, #btnAddStock, #btnSell, #btnExportStok, #btnExportMutasi").forEach(
    (b) => {
      if (!b) return;
      b.disabled = !!on;
      b.setAttribute("aria-busy", on ? "true" : "false");
    }
  );
}

/* ===== saldo helper (untuk pre-check di form Jual) ===== */
function saldoFor(linkId, vtypeId) {
  return (cacheStok || [])
    .filter((r) => r[C_LINK] === linkId && r[C_VT] === vtypeId)
    .reduce((s, r) => s + (Number(r[C_QTY]) || 0), 0);
}
function refreshSellWarning() {
  const linkId = $("#s_link")?.value || "";
  const vtypeId = $("#s_vtype")?.value || "";
  const qty = Number($("#s_qty")?.value || 0);
  const msgEl = $("#sellWarn");

  const saldo = linkId && vtypeId ? saldoFor(linkId, vtypeId) : 0;
  $("#btnSell")?.setAttribute("disabled", "disabled");

  if (!linkId || !vtypeId) {
    if (msgEl) msgEl.textContent = "Pilih Link & Jenis voucher.";
    return;
  }
  if (saldo <= 0) {
    if (msgEl) msgEl.textContent = "Stok belum ada untuk link/jenis ini.";
    return;
  }
  if (qty > saldo) {
    if (msgEl) msgEl.textContent = `Qty melebihi stok (tersedia ${saldo}).`;
    return;
  }
  if (msgEl) msgEl.textContent = "";
  $("#btnSell")?.removeAttribute("disabled");
}

/* =================== Tables & columns =================== */
const T_STOK = "stok";
const T_PROF = "profiles";
const T_VTYPE = "voucher_types";
const T_SHARE = "voucher_share_settings";
const T_SALES = "sales";

const C_ID = "id";
const C_TS = "created_at";
const C_OWNER = "owner_id";
const C_MITRA = "mitracabang_id";
const C_CABANG = "cabang_id";
const C_LINK = "link_id";
const C_VT = "voucher_type_id";
const C_QTY = "jumlah";
const C_SRC = "sumber";

/* =================== State =================== */
let gProf = null;
let ORG_OWNER = null;
let gVTypes = []; // {id,label,pokok,jual}
let gMitra = [];
let gCabang = [];
let gLinks = [];
let cacheStok = []; // semua mutasi stok (scope role)
let soldMap = new Map(); // vt -> qty terjual (periode)

let gRowsNow = []; // stok sekarang (setelah filter entitas; tanpa tanggal)
let gRowsPeriod = []; // mutasi stok pada periode (untuk export riwayat)

/* =================== Boot =================== */
(async () => {
  gProf = await getProfile(
    "id,role,owner_id,mitracabang_id,cabang_id,username,full_name"
  );
  if (!gProf) {
    location.replace("index.html");
    return;
  }
  ORG_OWNER = gProf.owner_id || gProf.id;

  $("#who") &&
    ($("#who").textContent = `${gProf.full_name || gProf.username} (${gProf.role})`);
  $("#logout")?.addEventListener("click", () => signOutAndRedirect("index.html"));
  $("#btnToSetoran")?.addEventListener("click", () => (location.href = "setoran.html"));

  // default: 7 hari terakhir s.d. HARI INI (inklusif)
  const dTo = new Date();
  const dFrom = new Date();
  dFrom.setDate(dTo.getDate() - 7);
  $("#from") && ($("#from").value = ymd(dFrom));
  $("#to") && ($("#to").value = ymd(dTo));

  disableWhileLoading(true);
  await Promise.all([loadVoucherTypes(), loadProfilesNetwork()]);
  disableWhileLoading(false);

  // isi dropdown filter
  fillSelect($("#f_vtype"), [{ id: "", label: "Semua" }, ...gVTypes], "id", "label");
  fillSelect($("#f_mitra"), [{ id: "", label: "Semua" }, ...gMitra], "id", "label");
  fillSelect($("#f_cabang"), [{ id: "", label: "Semua" }, ...gCabang], "id", "label");
  fillSelect($("#f_link"), [{ id: "", label: "Semua" }, ...gLinks], "id", "label");

  // cascading filter
  $("#f_mitra")?.addEventListener("change", () => {
    const m = $("#f_mitra").value;
    const cab = gCabang.filter((c) => !m || c.mitra_id === m);
    const lnk = gLinks.filter((l) => !m || l.mitra_id === m);
    fillSelect($("#f_cabang"), [{ id: "", label: "Semua" }, ...cab], "id", "label");
    fillSelect($("#f_link"), [{ id: "", label: "Semua" }, ...lnk], "id", "label");
  });
  $("#f_cabang")?.addEventListener("change", () => {
    const m = $("#f_mitra").value;
    const c = $("#f_cabang").value;
    const lnk = gLinks.filter(
      (l) => (!m || l.mitra_id === m) && (!c || l.cabang_id === c)
    );
    fillSelect($("#f_link"), [{ id: "", label: "Semua" }, ...lnk], "id", "label");
  });

  // tombol filter
  $("#filterForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    await renderAll();
  });
  $("#btnRole")?.addEventListener("click", setFilterByRole);

  // tombol export
  $("#btnExportStok")?.addEventListener("click", exportStokXLSX);
  $("#btnExportMutasi")?.addEventListener("click", exportMutasiXLSX);

  // dialog tambah stok
  $("#btnAddStock")?.addEventListener("click", openAddDialog);

  // SELL FORM (Owner/Admin only)
  initSellForm();

  // muat stok sesuai scope RLS (sekali), lalu render sesuai filter UI
  await loadStokByRoleScope();
  await renderAll();
  refreshSellWarning();

  // Sembunyikan section Riwayat di halaman (hanya lewat export)
  $("#mutasiSection") && ($("#mutasiSection").style.display = "none");

  // event refresh global
  document.addEventListener("mj98:refresh", async () => {
    await loadStokByRoleScope();
    await renderAll();
    refreshSellWarning();
  });
})();

/* =================== Load Master =================== */
async function loadVoucherTypes() {
  // Ambil label + harga
  const { data, error } = await supabase
    .from(T_VTYPE)
    .select("id, jenis_voucher, harga_pokok, harga_jual")
    .eq(C_OWNER, ORG_OWNER)
    .order("jenis_voucher", { ascending: true });
  if (error) {
    gVTypes = [];
    return;
  }
  gVTypes =
    data?.map((r) => ({
      id: r.id,
      label: r.jenis_voucher ?? String(r.id),
      pokok: Number(r.harga_pokok || 0),
      jual: Number(r.harga_jual || 0),
    })) ?? [];
}

function labelFromProfile(x) {
  const nm = x.full_name || x.username || x.id;
  return `${nm} (${String(x.id).slice(0, 8)}…)`;
}
async function loadProfilesNetwork() {
  const { data, error } = await supabase
    .from(T_PROF)
    .select("id, role, owner_id, mitracabang_id, cabang_id, full_name, username")
    .eq(C_OWNER, ORG_OWNER);
  if (error) {
    console.warn("profiles error", error);
    gMitra = [];
    gCabang = [];
    gLinks = [];
    return;
  }
  const rows = data || [];

  const isMitraRole = (r) => {
    const v = String(r || "").toLowerCase();
    return v === "mitra-cabang" || v === "mitracabang";
  };

  const mitras = rows
    .filter((x) => isMitraRole(x.role))
    .map((x) => ({ id: x.id, label: labelFromProfile(x) }));
  const cabang = rows
    .filter((x) => String(x.role).toLowerCase() === "cabang")
    .map((x) => ({
      id: x.id,
      label: labelFromProfile(x),
      mitra_id: x.mitracabang_id,
    }));
  const links = rows
    .filter((x) => String(x.role).toLowerCase() === "link")
    .map((x) => ({
      id: x.id,
      label: labelFromProfile(x),
      mitra_id: x.mitracabang_id,
      cabang_id: x.cabang_id,
    }));

  const roleLower = String(gProf.role).toLowerCase();
  if (isMitraRole(roleLower) && !mitras.find((m) => m.id === gProf.id))
    mitras.push({ id: gProf.id, label: labelFromProfile(gProf) });
  if (roleLower === "cabang" && !cabang.find((c) => c.id === gProf.id))
    cabang.push({
      id: gProf.id,
      label: labelFromProfile(gProf),
      mitra_id: gProf.mitracabang_id,
    });
  if (roleLower === "link" && !links.find((l) => l.id === gProf.id))
    links.push({
      id: gProf.id,
      label: labelFromProfile(gProf),
      mitra_id: gProf.mitracabang_id,
      cabang_id: gProf.cabang_id,
    });

  gMitra = mitras.sort((a, b) => a.label.localeCompare(b.label));
  gCabang = cabang.sort((a, b) => a.label.localeCompare(b.label));
  gLinks = links.sort((a, b) => a.label.localeCompare(b.label));
}

/* =================== Scope & Range =================== */
function setFilterByRole() {
  const rl = String(gProf.role).toLowerCase();
  if (rl === "owner" || rl === "admin") {
    $("#f_mitra").value = "";
    $("#f_cabang").value = "";
    $("#f_link").value = "";
  } else if (rl === "mitra-cabang" || rl === "mitracabang") {
    $("#f_mitra").value = gProf.id;
    $("#f_mitra").dispatchEvent(new Event("change"));
  } else if (rl === "cabang") {
    $("#f_mitra").value = gProf.mitracabang_id || "";
    $("#f_mitra").dispatchEvent(new Event("change"));
    $("#f_cabang").value = gProf.id;
    $("#f_cabang").dispatchEvent(new Event("change"));
  } else {
    // link
    $("#f_mitra").value = gProf.mitracabang_id || "";
    $("#f_mitra").dispatchEvent(new Event("change"));
    $("#f_cabang").value = gProf.cabang_id || "";
    $("#f_cabang").dispatchEvent(new Event("change"));
    $("#f_link").value = gProf.id;
  }
  renderAll();
}

function rangeFromInputs() {
  // hasil: { gte, lt, start, end } — lt = hari+1 (eksklusif)
  const fromEl = $("#from"),
    toEl = $("#to");
  const vFrom = fromEl?.value ? new Date(fromEl.value) : null;
  const vTo = toEl?.value ? new Date(toEl.value) : null;
  const start = vFrom ? new Date(new Date(vFrom).setHours(0, 0, 0, 0)) : null;
  const end = vTo ? new Date(new Date(vTo).setHours(23, 59, 59, 999)) : null;
  const o = {
    gte: start ? start.toISOString() : null,
    lt: end ? new Date(end.getTime() + 1).toISOString() : null,
    start,
    end,
  };
  return o.gte || o.lt ? o : { gte: null, lt: null, start: null, end: null };
}

/* =================== Load Data =================== */
async function loadStokByRoleScope() {
  let q = supabase
    .from(T_STOK)
    .select(
      `${C_ID}, ${C_TS}, ${C_OWNER}, ${C_MITRA}, ${C_CABANG}, ${C_LINK}, ${C_VT}, ${C_QTY}, ${C_SRC}`
    )
    .order(C_TS, { ascending: false });

  const rl = String(gProf.role).toLowerCase();
  if (rl === "owner" || rl === "admin") q = q.eq(C_OWNER, ORG_OWNER);
  else if (rl === "mitra-cabang" || rl === "mitracabang") q = q.eq(C_MITRA, gProf.id);
  else if (rl === "cabang") q = q.eq(C_CABANG, gProf.id);
  else q = q.eq(C_LINK, gProf.id);

  const { data, error } = await q;
  if (error) {
    console.error("load stok", error);
    cacheStok = [];
    return;
  }
  cacheStok = data || [];
}

/* ---- qty terjual per voucher (periode + filter UI; buang NULL) ---- */
async function loadSoldPerVoucher() {
  const rng = rangeFromInputs();
  const vtype = $("#f_vtype")?.value || "";
  const mid = $("#f_mitra")?.value || "";
  const cid = $("#f_cabang")?.value || "";
  const lid = $("#f_link")?.value || "";

  let q = supabase
    .from(T_SALES)
    .select("voucher_type_id, qty, owner_id, mitracabang_id, cabang_id, link_id, created_at")
    .not("voucher_type_id", "is", null);

  const rl = String(gProf.role).toLowerCase();
  if (rl === "owner" || rl === "admin") q = q.eq(C_OWNER, ORG_OWNER);
  else if (rl === "mitra-cabang" || rl === "mitracabang") q = q.eq(C_MITRA, gProf.id);
  else if (rl === "cabang") q = q.eq(C_CABANG, gProf.id);
  else q = q.eq(C_LINK, gProf.id);

  if (vtype) q = q.eq(C_VT, vtype);
  if (mid) q = q.eq(C_MITRA, mid);
  if (cid) q = q.eq(C_CABANG, cid);
  if (lid) q = q.eq(C_LINK, lid);
  if (rng.gte) q = q.gte(C_TS, rng.gte);
  if (rng.lt) q = q.lt(C_TS, rng.lt);

  const { data, error } = await q;
  if (error) {
    console.error("load sold", error);
    soldMap = new Map();
    return;
  }

  const m = new Map();
  for (const r of data || []) {
    const vt = r[C_VT];
    const qn = Number((r.qty ?? r.jumlah) || 0);
    if (!vt) continue;
    m.set(vt, (m.get(vt) || 0) + qn);
  }
  soldMap = m;
}

/* =================== Render: Summary, Now, (Riwayat via Export) =================== */
async function renderAll() {
  await loadSoldPerVoucher(); // hitung “Terjual (periode)” dulu
  const rowsForMutasi = applyUiFilters(cacheStok, { useDate: true }); // untuk RIWAYAT (export saja)
  const rowsForNow = applyUiFilters(cacheStok, { useDate: false }); // stok sekarang (abaikan tanggal)

  gRowsPeriod = rowsForMutasi;
  gRowsNow = rowsForNow;

  renderSummary(rowsForNow, rowsForMutasi);
  renderStokNow(rowsForNow, soldMap);
}

function applyUiFilters(rows, { useDate } = { useDate: true }) {
  const vtype = $("#f_vtype")?.value || "";
  const mid = $("#f_mitra")?.value || "";
  const cid = $("#f_cabang")?.value || "";
  const lid = $("#f_link")?.value || "";
  const rng = rangeFromInputs();

  return (rows || []).filter((r) => {
    if (vtype && r[C_VT] !== vtype) return false;
    if (mid && r[C_MITRA] !== mid) return false;
    if (cid && r[C_CABANG] !== cid) return false;
    if (lid && r[C_LINK] !== lid) return false;
    if (useDate && (rng.gte || rng.lt)) {
      const ts = new Date(r[C_TS]).toISOString();
      if (rng.gte && ts < rng.gte) return false;
      if (rng.lt && ts >= rng.lt) return false;
    }
    return true;
  });
}

function renderSummary(rowsNow, rowsPeriod) {
  // Stok sekarang (ABAIKAN tanggal)
  const perVNow = new Map();
  for (const r of rowsNow) {
    if (!r[C_VT]) continue; // buang voucher null → hilangkan baris “—”
    perVNow.set(r[C_VT], (perVNow.get(r[C_VT]) || 0) + (+r[C_QTY] || 0));
  }
  const totalSisa = [...perVNow.values()].reduce((s, x) => s + x, 0);
  const varianNow = [...perVNow.values()].filter((x) => x > 0).length;

  // “Tambah stok (periode)” = hanya jumlah > 0 pada periode terfilter
  const tambahPeriode = (rowsPeriod || []).reduce(
    (s, r) => s + (Number(r[C_QTY]) > 0 ? Number(r[C_QTY]) : 0),
    0
  );

  $("#sumTotal") && ($("#sumTotal").textContent = toID(totalSisa));
  $("#sumVarian") && ($("#sumVarian").textContent = toID(varianNow));
  $("#sumTambah") && ($("#sumTambah").textContent = toID(tambahPeriode));
}

function renderStokNow(rowsNow, soldByVt) {
  // agregasi stok per voucher (NOW)
  const stok = new Map(); // vt -> qty sisa
  for (const r of rowsNow) {
    if (!r[C_VT]) continue; // filter baris tanpa voucher → tidak muncul “—”
    stok.set(r[C_VT], (stok.get(r[C_VT]) || 0) + (+r[C_QTY] || 0));
  }

  // union semua voucher yang muncul di stok atau sold
  const allVt = new Set([...stok.keys(), ...soldByVt.keys()]);
  const list = [...allVt]
    .filter((vt) => !!vt) // buang key kosong
    .map((vt) => {
      const v = gVTypes.find((x) => x.id === vt);
      const vname = v?.label || vt;
      const sisa = stok.get(vt) || 0;
      const sold = soldByVt.get(vt) || 0; // periode
      return { vt, vname, sisa, sold };
    })
    .filter((x) => x.sisa !== 0 || x.sold !== 0)
    .sort((a, b) => String(a.vname).localeCompare(String(b.vname)));

  $("#tblNow").innerHTML = list.length
    ? list
        .map(
          (r) => `
      <tr>
        <td class="t-left">${esc(r.vname)}</td>
        <td class="t-right">${toID(r.sisa)}</td>
        <td class="t-right">${toID(r.sold)}</td>
      </tr>`
        )
        .join("")
    : `<tr><td class="t-left" colspan="3">Tidak ada data</td></tr>`;
}

/* =================== Export Excel =================== */
async function exportStokXLSX() {
  // data sumber: gRowsNow (stok sekarang) + soldMap (periode)
  const stokNow = new Map();
  for (const r of gRowsNow) {
    if (!r[C_VT]) continue;
    stokNow.set(r[C_VT], (stokNow.get(r[C_VT]) || 0) + (+r[C_QTY] || 0));
  }
  const rows = [...new Set([...stokNow.keys(), ...soldMap.keys()])]
    .filter(Boolean)
    .map((vt) => {
      const name = gVTypes.find((v) => v.id === vt)?.label || vt;
      return [name, Number(stokNow.get(vt) || 0), Number(soldMap.get(vt) || 0)];
    })
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));

  const aoa = [];
  aoa.push([`Export Stok – ${new Date().toLocaleString("id-ID")}`]);
  aoa.push([
    `Periode penjualan: ${$("#from").value || "-"} s/d ${$("#to").value || "-"}`,
  ]);
  aoa.push([]);
  aoa.push(["Voucher", "Total Stok", "Terjual (periode)"]);
  rows.forEach((r) => aoa.push(r));

  if (await ensureSheetJS()) {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 26 }, { wch: 14 }, { wch: 18 }];
    for (let R = 4; R < aoa.length; R++) {
      const c1 = XLSX.utils.encode_cell({ r: R, c: 1 });
      const c2 = XLSX.utils.encode_cell({ r: R, c: 2 });
      if (ws[c1]) ws[c1].z = "#,##0";
      if (ws[c2]) ws[c2].z = "#,##0";
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Stok");
    XLSX.writeFile(wb, `stok-${new Date().toISOString().slice(0, 10)}.xlsx`);
    return;
  }

  // fallback HTML
  const html = `
    <table border="1">
      <tr><th colspan="3">Export Stok – ${new Date().toLocaleString("id-ID")}</th></tr>
      <tr><td colspan="3">Periode penjualan: ${$("#from").value || "-"} s/d ${$("#to").value || "-"}</td></tr>
      <tr><th>Voucher</th><th>Total Stok</th><th>Terjual (periode)</th></tr>
      ${rows
        .map(
          (r) =>
            `<tr><td>${esc(r[0])}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`
        )
        .join("")}
    </table>`;
  const blob = new Blob([html], { type: "application/vnd.ms-excel" });
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(blob),
    download: `stok-${new Date().toISOString().slice(0, 10)}.xls`,
  });
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function exportMutasiXLSX() {
  const rows = gRowsPeriod
    .slice()
    .sort((a, b) => new Date(a[C_TS]) - new Date(b[C_TS]))
    .map((x) => {
      const vt = gVTypes.find((v) => v.id === x[C_VT]);
      return [
        new Date(x[C_TS]).toLocaleString("id-ID"),
        gProf?.full_name || gProf?.username || (x[C_OWNER] ?? "-"),
        x[C_MITRA] ? String(x[C_MITRA]).slice(0, 8) + "…" : "—",
        x[C_CABANG] ? String(x[C_CABANG]).slice(0, 8) + "…" : "—",
        x[C_LINK] ? String(x[C_LINK]).slice(0, 8) + "…" : "—",
        vt?.label || x[C_VT] || "—",
        Number(x[C_QTY] || 0),
        x[C_SRC] || "",
      ];
    });

  const head = [
    "Waktu",
    "Oleh",
    "Mitra",
    "Cabang",
    "Link",
    "Voucher",
    "Jumlah",
    "Catatan",
  ];

  if (await ensureSheetJS()) {
    const ws = XLSX.utils.aoa_to_sheet([head, ...rows]);
    ws["!cols"] = [
      { wch: 20 },
      { wch: 22 },
      { wch: 10 },
      { wch: 10 },
      { wch: 10 },
      { wch: 18 },
      { wch: 10 },
      { wch: 40 },
    ];
    for (let R = 1; R <= rows.length; R++) {
      const c = XLSX.utils.encode_cell({ r: R, c: 6 });
      if (ws[c]) ws[c].z = "#,##0";
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Riwayat Stok");
    XLSX.writeFile(
      wb,
      `riwayat-stok-${new Date().toISOString().slice(0, 10)}.xlsx`
    );
    return;
  }

  const html = `
    <table border="1">
      <tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr>
      ${rows
        .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`)
        .join("")}
    </table>`;
  const blob = new Blob([html], { type: "application/vnd.ms-excel" });
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(blob),
    download: `riwayat-stok-${new Date().toISOString().slice(0, 10)}.xls`,
  });
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/* =================== Dialog Tambah Stok =================== */
function fillSelect(sel, rows, vKey = "id", tKey = "label") {
  if (!sel) return;
  sel.innerHTML = (rows || [])
    .map((r) => `<option value="${esc(r[vKey])}">${esc(r[tKey])}</option>`)
    .join("");
}

/* ---- cek keberadaan Share Settings dengan HIERARKI (tanpa mengubah yang lama) ---- */
async function shareSettingsExistsHierarchy(ownerId, voucherTypeId, mitraId, cabangId) {
  const tries = [
    { m: mitraId, c: cabangId },   // mitra+cabang
    { m: mitraId, c: null },       // mitra
    { m: null,    c: cabangId },   // cabang
    { m: null,    c: null }        // global
  ];
  for (const t of tries) {
    let q = supabase
      .from(T_SHARE)
      .select("id", { count: "exact", head: true })
      .eq(C_OWNER, ownerId)
      .eq(C_VT, voucherTypeId);
    q = (t.m !== null) ? q.eq(C_MITRA, t.m) : q.is(C_MITRA, null);
    q = (t.c !== null) ? q.eq(C_CABANG, t.c) : q.is(C_CABANG, null);
    const { error, count } = await q;
    if (!error && (count || 0) > 0) return true;
  }
  return false;
}

function openAddDialog() {
  const rl = String(gProf.role).toLowerCase();
  if (!(rl === "owner" || rl === "admin")) {
    alert("Hanya Owner/Admin yang dapat menambah stok.");
    return;
  }

  // voucher
  fillSelect($("#a_vtype"), gVTypes, "id", "label");

  // tujuan wajib: Mitra -> Cabang -> Link
  const mitraSel = $("#a_mitra");
  const cabSel = $("#a_cabang");
  const linkSel = $("#a_link");

  fillSelect(mitraSel, [{ id: "", label: "Pilih" }, ...gMitra], "id", "label");
  cabSel.innerHTML = `<option value="">Pilih</option>`;
  cabSel.disabled = true;
  linkSel.innerHTML = `<option value="">Pilih</option>`;
  linkSel.disabled = true;

  mitraSel.onchange = () => {
    const mid = mitraSel.value;
    const cabs = gCabang.filter((c) => !mid || c.mitra_id === mid);
    fillSelect(cabSel, [{ id: "", label: "Pilih" }, ...cabs], "id", "label");
    cabSel.disabled = false;

    const lnks = gLinks.filter((l) => !mid || l.mitra_id === mid);
    fillSelect(linkSel, [{ id: "", label: "Pilih" }, ...lnks], "id", "label");
    linkSel.disabled = false;
  };

  cabSel.onchange = () => {
    const mid = mitraSel.value;
    const cid = cabSel.value;
    const lnks = gLinks.filter(
      (l) => (!mid || l.mitra_id === mid) && (!cid || l.cabang_id === cid)
    );
    fillSelect(linkSel, [{ id: "", label: "Pilih" }, ...lnks], "id", "label");
    linkSel.disabled = false;
  };

  // reset form
  $("#a_qty").value = "";
  $("#a_note").value = "";
  $("#addMsg").textContent = "";
  const dlg = $("#dlgAdd");
  dlg?.showModal();

  $("#btnCancel").onclick = () => dlg.close();

  $("#addForm").onsubmit = async (e) => {
    e.preventDefault();
    const msg = $("#addMsg");
    msg.textContent = "";

    const voucher_type_id = $("#a_vtype").value?.trim();
    const link_id = linkSel.value?.trim();
    const qty = parseInt($("#a_qty").value, 10) || 0;
    const note = ($("#a_note").value || "").trim();

    if (!isUUID(voucher_type_id)) {
      msg.textContent = "Voucher wajib dipilih.";
      return;
    }
    if (!isUUID(link_id)) {
      msg.textContent = "Mitra, Cabang, dan Link wajib dipilih.";
      return;
    }
    if (!qty || qty < 1) {
      msg.textContent = "Jumlah harus lebih dari 0.";
      return;
    }

    // ambil pasangan mitra/cabang dari Link (agar konsisten)
    const link = gLinks.find((x) => x.id === link_id);
    const mitra_id = link?.mitra_id || null;
    const cabang_id = link?.cabang_id || null;

    // 1) Pastikan Share Settings ADA di salah satu level hierarki
    try {
      const exists = await shareSettingsExistsHierarchy(ORG_OWNER, voucher_type_id, mitra_id, cabang_id);
      if (!exists) {
        msg.textContent =
          "Share Settings untuk kombinasi ini belum ada (termasuk fallback). Buat di menu Voucher → Tambah Share.";
        return;
      }
    } catch (sErr) {
      console.error("share check", sErr);
      msg.textContent = sErr?.message || "Gagal mengecek Share Settings.";
      return;
    }

    // 2) Insert stok
    const payload = {
      [C_OWNER]: ORG_OWNER,
      [C_LINK]: link_id,
      [C_VT]: voucher_type_id,
      [C_QTY]: qty,
      [C_SRC]: note || "owner",
      [C_MITRA]: mitra_id,
      [C_CABANG]: cabang_id,
    };

    const { error } = await supabase.from(T_STOK).insert(payload);
    if (error) {
      console.error("stok.insert", error);
      msg.textContent = error.message || "Gagal menambah stok.";
      return;
    }

    dlg.close();
    await loadStokByRoleScope();
    await renderAll();
  };
}

/* =================== SELL FORM (Owner/Admin) =================== */
function showSellCardIfAllowed() {
  const role = String(gProf.role || "").toLowerCase();
  const sellCard = $("#sellCard");
  if (!sellCard) return;
  if (role === "owner" || role === "admin") sellCard.style.display = "";
  else sellCard.remove();
}

function populateSellDropdowns() {
  fillSelect($("#s_vtype"), [{ id: "", label: "Pilih Voucher" }, ...gVTypes], "id", "label");
  const links = gLinks;
  fillSelect(
    $("#s_link"),
    [{ id: "", label: "Pilih Link" }, ...links.map((l) => ({ id: l.id, label: l.label }))],
    "id",
    "label"
  );
}

/* ---- helper share meta (hierarki) — tahan banting ---- */
async function fetchShareMetaForVoucher(ownerId, voucherTypeId, mitraId, cabangId) {
  const SAFE_ZERO = { s_link: 0, s_cabang: 0, p_link: 0, p_cabang: 0, p_mitra: 0 };

  const tries = [
    { mitracabang_id: mitraId, cabang_id: cabangId }, // spesifik mitra+cabang
    { mitracabang_id: mitraId, cabang_id: null }, // spesifik mitra
    { mitracabang_id: null, cabang_id: cabangId }, // spesifik cabang
    { mitracabang_id: null, cabang_id: null }, // global
  ];

  try {
    for (const f of tries) {
      try {
        let q = supabase
          .from(T_SHARE)
          .select(
            "share_link, share_cabang, komisi_link_persen, komisi_cabang_persen, komisi_mitra_persen"
          )
          .eq(C_OWNER, ownerId)
          .eq(C_VT, voucherTypeId)
          .limit(1);

        if (f.mitracabang_id !== null) q = q.eq(C_MITRA, f.mitracabang_id);
        else q = q.is(C_MITRA, null);

        if (f.cabang_id !== null) q = q.eq(C_CABANG, f.cabang_id);
        else q = q.is(C_CABANG, null);

        const { data, error } = await q.maybeSingle();
        if (error) {
          console.debug("share meta try failed:", error.message || error);
          continue; // lanjut opsi berikutnya
        }
        if (data) {
          return {
            s_link: Number(data.share_link ?? 0),
            s_cabang: Number(data.share_cabang ?? 0),
            p_link: Number(data.komisi_link_persen ?? 0),
            p_cabang: Number(data.komisi_cabang_persen ?? 0),
            p_mitra: Number(data.komisi_mitra_persen ?? 0),
          };
        }
      } catch (inner) {
        console.debug("share meta inner exception:", inner?.message || inner);
        continue;
      }
    }
  } catch (e) {
    console.debug("share meta fatal:", e?.message || e);
  }

  return SAFE_ZERO; // kalau semua gagal → nol semua
}

/* ---- fallback penjualan jika RPC gagal ---- */
async function fallbackRecordSale({ link_id, voucher_type_id, qty, note }) {
  // meta entitas
  const link = gLinks.find((x) => x.id === link_id);
  const mitra_id = link?.mitra_id || null;
  const cabang_id = link?.cabang_id || null;

  // harga & total
  const vt = gVTypes.find((v) => v.id === voucher_type_id);
  const harga_pokok = Number(vt?.pokok || 0);
  const harga_jual = Number(vt?.jual || 0);
  const total_pokok = harga_pokok * qty;
  const total_jual = harga_jual * qty;

  // share/komisi (kolom BARU)
  const meta = await fetchShareMetaForVoucher(
    ORG_OWNER,
    voucher_type_id,
    mitra_id,
    cabang_id
  );
  const pend_link = meta.s_link * qty + total_pokok * (meta.p_link / 100);
  const pend_cabang = meta.s_cabang * qty + total_pokok * (meta.p_cabang / 100);
  const pend_mitra = total_pokok * (meta.p_mitra / 100);

  // ---- INSERT SALES: coba lengkap → degradasi bila kolom tidak ada ----
  const baseMinimal = {
    [C_OWNER]: ORG_OWNER,
    [C_LINK]: link_id,
    [C_CABANG]: cabang_id,
    [C_MITRA]: mitra_id,
    [C_VT]: voucher_type_id,
    qty,
  };
  const withNote = note != null ? { note } : {};

  const tryPayloads = [
    { ...baseMinimal, ...withNote, total_pokok, total_jual, pendapatan_link: pend_link, pendapatan_cabang: pend_cabang, pendapatan_mitracabang: pend_mitra },
    { ...baseMinimal, ...withNote, total_pokok, total_jual },
    { ...baseMinimal, total_pokok, total_jual }, // tanpa note
    { ...baseMinimal }, // minimal
  ];

  let salesId = null,
    lastErr = null;
  for (const payload of tryPayloads) {
    const { data, error } = await supabase.from(T_SALES).insert(payload).select("id").single();
    if (!error) {
      salesId = data?.id || null;
      lastErr = null;
      break;
    }
    lastErr = error;
    if (!/column .* does not exist/i.test(error.message || "")) break;
  }
  if (lastErr) throw lastErr;

  // 2) stok negatif
  const stokPayload = {
    [C_OWNER]: ORG_OWNER,
    [C_LINK]: link_id,
    [C_VT]: voucher_type_id,
    [C_QTY]: -qty,
    [C_SRC]: note ? `sold: ${note}` : "sold",
    [C_MITRA]: mitra_id,
    [C_CABANG]: cabang_id,
  };
  const { error: stErr } = await supabase.from(T_STOK).insert(stokPayload);
  if (stErr) throw stErr;

  return salesId;
}

function bindSellHandler() {
  const form = $("#sellForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const link_id = $("#s_link").value;
    const voucher_type_id = $("#s_vtype").value;
    const qty = Number($("#s_qty").value || 0);
    const note = $("#s_note").value || null;

    const msg = $("#sellMsg");
    const btn = $("#btnSell");

    if (!isUUID(link_id) || !isUUID(voucher_type_id) || !qty || qty <= 0) {
      msg.style.color = "#7a0000";
      msg.textContent = "Lengkapi Link, Voucher, dan Qty > 0.";
      return;
    }

    // guard terakhir: jangan lanjut jika stok tidak cukup
    const saldo = saldoFor(link_id, voucher_type_id);
    if (saldo <= 0 || qty > saldo) {
      msg.style.color = "#7a0000";
      msg.textContent =
        saldo <= 0
          ? "Stok belum ada untuk link/jenis ini."
          : `Qty melebihi stok (tersedia ${saldo}).`;
      return;
    }

    try {
      btn.disabled = true;
      msg.style.color = "";
      msg.textContent = "Memproses…";

      // 1) Coba lewat RPC baru
      let ok = false;
      try {
        await rpcRecordVoucherSale({ link_id, voucher_type_id, qty, note });
        ok = true;
      } catch (err) {
        console.warn("RPC gagal; lanjut fallback:", err?.message || err);
      }

      // 2) Fallback jika RPC gagal (termasuk error 'share_link_rp')
      if (!ok) {
        await fallbackRecordSale({ link_id, voucher_type_id, qty, note });
      }

      msg.style.color = "#2f6f2f";
      msg.textContent = "Berhasil dicatat.";
      $("#s_qty").value = "";

      // refresh data di halaman
      document.dispatchEvent(new CustomEvent("mj98:refresh"));
    } catch (err) {
      console.error(err);
      msg.style.color = "#7a0000";
      msg.textContent =
        explainSupabaseError(err) || "Gagal mencatat penjualan.";
    } finally {
      btn.disabled = false;
    }
  });
}

function initSellForm() {
  showSellCardIfAllowed();
  populateSellDropdowns();
  bindSellHandler();

  ["#s_link", "#s_vtype", "#s_qty"].forEach((sel) => {
    const el = document.querySelector(sel);
    if (!el) return;
    el.addEventListener("change", refreshSellWarning);
    el.addEventListener("input", refreshSellWarning);
  });
}
