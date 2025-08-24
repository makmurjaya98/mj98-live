// js/daftar-user.js — Direktori Pengguna (Mitra → Cabang → Link)
// Selaras dengan tabel `profiles` (lihat kolom2 di komentar ini).
// Kolom: id, role, owner_id, mitracabang_id, cabang_id,
//        username, full_name, address, phone_number, phone, email,
//        nik, id_number, nomor_id, is_active, created_at

import { supabase, getProfile } from "./supabase-init.js";

/* ==========================
   Konstanta kolom & helpers
   ========================== */

const FIELDS = [
  "id",
  "role",
  "owner_id",
  "mitracabang_id",
  "cabang_id",
  "username",
  "full_name",
  "address",
  "phone_number",
  "phone",
  "email",
  "nik",
  "id_number",
  "nomor_id",
  "is_active",
  "created_at",
].join(", ");

// DB UTAMA: 'mitracabang' (tanpa tanda minus). Alias lama 'mitra-cabang' tetap didukung.
const ROLE_OWNER = "owner";
const ROLE_ADMIN = "admin";
const ROLE_MITRA = "mitracabang";      // ← utama di DB
const ROLE_MITRA_ALT = "mitra-cabang"; // ← alias lama
const ROLE_CABANG = "cabang";
const ROLE_LINK = "link";

const state = {
  me: null,
  role: null,
  ownerId: null,

  selMitra: null,
  selCabang: null,
  selLink: null,

  cache: { mitra: [], cabang: [], link: [] },

  // chip yang sedang dipilih per kartu (opsional)
  chipSel: { mitra: null, cabang: null, link: null },
};

const el  = (sel) => document.querySelector(sel);
const safeText    = (v) => (v ?? "").toString().trim();
const pickPhone   = (r) => safeText(r.phone_number ?? r.phone ?? "");
const pickIdNum   = (r) => safeText(r.nik ?? r.id_number ?? r.nomor_id ?? "");
const pickAddress = (r) => safeText(r.address ?? "");
const pickName    = (r) => safeText(r.full_name ?? r.username ?? "");

/* === util: dukung dua versi id (#filter-* dan #sel*) tanpa memotong kode === */
function pickSel(idA, idB){ return el(idA) ?? el(idB) ?? null; }
const elsFilter = {
  mitra : () => pickSel("#filter-mitra", "#selMitra"),
  cabang: () => pickSel("#filter-cabang", "#selCabang"),
  link  : () => pickSel("#filter-link", "#selLink"),
};
const btnExportFilter = () => el("#btnExportFilter") ?? el("#btnExportFiltered");
const btnExportAll    = () => el("#btnExportAll");

/** Normalisasi role di memori */
function normRole(s) {
  s = (s || "").toLowerCase();
  if (s === ROLE_MITRA_ALT) return ROLE_MITRA;
  return s;
}

/** Daftar label role yang ekuivalen untuk filter .in(...) */
function roleList(roleWant) {
  const r = normRole(roleWant);
  if (r === ROLE_MITRA) return [ROLE_MITRA, ROLE_MITRA_ALT];
  return [r];
}

/* ==========================
   Fetch ber-scope RLS
   ========================== */

async function fetchProfilesByRole(roleWant, extraFilter) {
  try {
    let q = supabase
      .from("profiles")
      .select(FIELDS)
      .eq("owner_id", state.ownerId)
      .in("role", roleList(roleWant))
      .order("username", { ascending: true });

    // Scope tambahan berdasar role login
    const r = normRole(state.role);

    if (r === ROLE_MITRA) {
      // Mitra: lihat dirinya + bawahan (cabang/link)
      if (normRole(roleWant) === ROLE_MITRA) {
        q = q.eq("id", state.me.id);
      } else if (roleWant === ROLE_CABANG || roleWant === ROLE_LINK) {
        q = q.eq("mitracabang_id", state.me.id);
      } else {
        q = q.limit(0);
      }
    } else if (r === ROLE_CABANG) {
      // Cabang: lihat dirinya + link di bawahnya
      if (roleWant === ROLE_CABANG) {
        q = q.eq("id", state.me.id);
      } else if (roleWant === ROLE_LINK) {
        q = q.eq("cabang_id", state.me.id);
      } else {
        q = q.limit(0);
      }
    } // owner/admin: akses penuh dalam 1 owner_id

    if (typeof extraFilter === "function") q = extraFilter(q);

    const { data, error } = await q;
    if (error) {
      console.error("fetchProfilesByRole error:", roleWant, error);
      return [];
    }
    return data || [];
  } catch (e) {
    console.error("fetchProfilesByRole exception:", roleWant, e);
    return [];
  }
}

/* ==========================
   Panel Nilai (chips)
   ========================== */

function getValueByKey(row, key) {
  switch (key) {
    case "nama":     return pickName(row);
    case "username": return safeText(row.username);
    case "alamat":   return pickAddress(row);
    case "hp":       return pickPhone(row);
    case "email":    return safeText(row.email);
    case "nik":      return pickIdNum(row);
    default:         return "";
  }
}

function uniqueValues(rows, key) {
  const s = new Set();
  for (const r of rows) {
    const v = getValueByKey(r, key);
    if (v) s.add(v); // hanya nilai non-kosong yang tampil sebagai chip
  }
  return Array.from(s).sort((a,b)=>a.localeCompare(b,"id",{sensitivity:"base"}));
}

/** Tulis chip + bind klik (single-select). */
function writeChips(container, values, scope, emptyText="Tidak ada data") {
  if (!container) return;
  container.innerHTML = "";
  if (!values.length) {
    const span = document.createElement("span");
    span.className = "muted";
    span.textContent = emptyText;
    container.appendChild(span);
    state.chipSel[scope] = null;
    return;
  }
  const activeVal = state.chipSel[scope];
  for (const val of values) {
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.textContent = val;
    if (activeVal && activeVal === val) chip.classList.add("active");
    chip.addEventListener("click", () => {
      // toggle single select
      if (state.chipSel[scope] === val) {
        state.chipSel[scope] = null;
      } else {
        state.chipSel[scope] = val;
      }
      // refresh highlight saja (tanpa rerender mahal)
      Array.from(container.querySelectorAll(".chip")).forEach(c=>{
        c.classList.toggle("active", c.textContent === state.chipSel[scope]);
      });
    });
    container.appendChild(chip);
  }
}

/** Hormati pilihan entitas di atasnya (selMitra/selCabang/selLink) saat membuat chips. */
function renderChipsFor(scope){
  const bySel  = el(scope === "mitra" ? "#byMitra" : scope === "cabang" ? "#byCabang" : "#byLink");
  const chipsC = el(scope === "mitra" ? "#chipsMitra" : scope === "cabang" ? "#chipsCabang" : "#chipsLink");
  if (!bySel || !chipsC) return;

  const key = bySel.value || "nama";
  let rows =
    scope === "mitra"  ? state.cache.mitra :
    scope === "cabang" ? state.cache.cabang :
                         state.cache.link;

  // batasi ke entitas yang dipilih pada level yang sama (jika ada)
  if (scope === "mitra"  && state.selMitra)  rows = rows.filter(r => r.id === state.selMitra);
  if (scope === "cabang" && state.selCabang) rows = rows.filter(r => r.id === state.selCabang);
  if (scope === "link"   && state.selLink)   rows = rows.filter(r => r.id === state.selLink);

  // placeholder saat parent belum dipilih
  if (scope === "cabang" && !state.selMitra && rows.length === 0) {
    writeChips(chipsC, [], scope, "Pilih mitra lebih dulu");
    return;
  }
  if (scope === "link" && !state.selCabang && rows.length === 0) {
    writeChips(chipsC, [], scope, "Pilih cabang lebih dulu");
    return;
  }

  const values = uniqueValues(rows, key);
  writeChips(chipsC, values, scope);
}

/* ==========================
   Isi dropdown filter hirarki
   ========================== */

function setOptions(sel, rows, placeholder){
  if (!sel) return;
  sel.innerHTML = "";
  const ph = document.createElement("option");
  ph.value = "";
  ph.textContent = placeholder;
  sel.appendChild(ph);
  for (const r of rows) {
    const opt = document.createElement("option");
    opt.value = r.id;
    opt.textContent = r.username || r.full_name || r.email || r.id;
    sel.appendChild(opt);
  }
}

async function loadMitraOptions() {
  const sel = elsFilter.mitra();
  if (!sel) return;
  const rows = await fetchProfilesByRole(ROLE_MITRA);
  state.cache.mitra = rows;
  setOptions(sel, rows, "— pilih mitra —");
  sel.disabled = rows.length === 0;

  renderChipsFor("mitra");
}

async function loadCabangOptions() {
  const sel = elsFilter.cabang();
  if (!sel) return;

  if (!state.selMitra) {
    setOptions(sel, [], "— pilih mitra dulu —");
    sel.disabled = true;
    state.cache.cabang = [];
    renderChipsFor("cabang");
    return;
  }

  const rows = await fetchProfilesByRole(ROLE_CABANG, (q) =>
    q.eq("mitracabang_id", state.selMitra)
  );
  state.cache.cabang = rows;

  setOptions(sel, rows, "— pilih cabang —");
  sel.disabled = rows.length === 0;

  renderChipsFor("cabang");
}

async function loadLinkOptions() {
  const sel = elsFilter.link();
  if (!sel) return;

  if (!state.selCabang) {
    setOptions(sel, [], "— pilih cabang dulu —");
    sel.disabled = true;
    state.cache.link = [];
    renderChipsFor("link");
    return;
  }

  const rows = await fetchProfilesByRole(ROLE_LINK, (q) =>
    q.eq("cabang_id", state.selCabang)
  );
  state.cache.link = rows;

  setOptions(sel, rows, "— pilih link —");
  sel.disabled = rows.length === 0;

  renderChipsFor("link");
}

/* ==========================
   Export CSV
   ========================== */

function toCsvValue(v) {
  v = (v ?? "").toString();
  if (v.includes(",") || v.includes('"') || v.includes("\n")) {
    v = `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

function downloadCsv(filename, rows) {
  const header = [
    "role",
    "username",
    "full_name",
    "address",
    "phone",
    "email",
    "id_number",
  ];
  const lines = [];
  lines.push(header.join(","));
  for (const r of rows) {
    lines.push(
      [
        normRole(r.role),
        safeText(r.username),
        pickName(r),
        pickAddress(r),
        pickPhone(r),
        safeText(r.email),
        pickIdNum(r),
      ]
        .map(toCsvValue)
        .join(",")
    );
  }
  const blob = new Blob([lines.join("\n")], {
    type: "text/csv;charset=utf-8",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ===== Helper untuk ekspor sesuai filter (tanpa mengubah fungsi lain) ===== */

// kembalikan rows pada scope, sudah menghormati hirarki pilihan di atas
function baseRowsFor(scope) {
  let rows =
    scope === "mitra"  ? state.cache.mitra :
    scope === "cabang" ? state.cache.cabang :
                         state.cache.link;

  if (scope === "mitra"  && state.selMitra)  rows = rows.filter(r => r.id === state.selMitra);
  if (scope === "cabang" && state.selCabang) rows = rows.filter(r => r.id === state.selCabang);
  if (scope === "link"   && state.selLink)   rows = rows.filter(r => r.id === state.selLink);
  return rows;
}

// filter rows sesuai dropdown kolom + chip aktif (jika ada)
// jika tidak ada chip aktif, hanya ambil rows yang nilainya termasuk daftar chip (non-kosong)
function filteredRowsFor(scope) {
  const bySel = el(scope === "mitra" ? "#byMitra" : scope === "cabang" ? "#byCabang" : "#byLink");
  const key   = bySel?.value || "nama";
  const rows  = baseRowsFor(scope);

  const activeVal = state.chipSel[scope];
  if (activeVal) {
    return rows.filter(r => getValueByKey(r, key) === activeVal);
  }
  // Tidak ada chip aktif → ambil semua baris yang nilainya non-kosong & muncul sebagai chip
  const allowedValues = new Set(uniqueValues(rows, key)); // hanya non-kosong
  if (allowedValues.size === 0) return []; // tidak ada nilai tampil
  return rows.filter(r => allowedValues.has(getValueByKey(r, key)));
}

/* ==========================
   Event bindings
   ========================== */

function bindFilterEvents() {
  const selM = elsFilter.mitra();
  const selC = elsFilter.cabang();
  const selL = elsFilter.link();

  selM?.addEventListener("change", async (e) => {
    state.selMitra = e.target.value || null;
    state.selCabang = null;
    state.selLink = null;
    state.chipSel.mitra = null;
    state.chipSel.cabang = null;
    state.chipSel.link = null;
    await loadCabangOptions();
    await loadLinkOptions();
    renderChipsFor("mitra");
  });

  selC?.addEventListener("change", async (e) => {
    state.selCabang = e.target.value || null;
    state.selLink = null;
    state.chipSel.cabang = null;
    state.chipSel.link = null;
    await loadLinkOptions();
    renderChipsFor("cabang");
  });

  selL?.addEventListener("change", (e) => {
    state.selLink = e.target.value || null;
    state.chipSel.link = null;
    renderChipsFor("link");
  });

  // perubahan dropdown kolom → regenerasi chips & reset chip aktif pada scope itu
  el("#byMitra") ?.addEventListener("change", () => { state.chipSel.mitra  = null; renderChipsFor("mitra");  });
  el("#byCabang")?.addEventListener("change", () => { state.chipSel.cabang = null; renderChipsFor("cabang"); });
  el("#byLink")  ?.addEventListener("change", () => { state.chipSel.link   = null; renderChipsFor("link");   });

  // Ekspor sesuai filter → gunakan subset per scope
  btnExportFilter()?.addEventListener("click", () => {
    const rows = [
      ...filteredRowsFor("mitra"),
      ...filteredRowsFor("cabang"),
      ...filteredRowsFor("link"),
    ];
    downloadCsv("direktori-filter.csv", rows);
  });

  // Ekspor keseluruhan (akses sesuai policy user login) — TANPA filter UI
  btnExportAll()?.addEventListener("click", async () => {
    const [m, c, l] = await Promise.all([
      fetchProfilesByRole(ROLE_MITRA),
      fetchProfilesByRole(ROLE_CABANG),
      fetchProfilesByRole(ROLE_LINK),
    ]);
    downloadCsv("direktori-semua.csv", [...m, ...c, ...l]);
  });
}

/* ==========================
   Boot
   ========================== */

async function boot() {
  // Ambil profil login
  state.me = await getProfile("id, role, owner_id, username, full_name");
  if (!state.me) {
    location.href = "./index.html";
    return;
  }
  state.role = normRole(state.me.role);
  // owner: owner_id = id sendiri; user lain: owner_id diisi saat dibuat
  state.ownerId = state.me.owner_id || state.me.id;

  // Muat dropdown hirarki & panel nilai
  await loadMitraOptions();
  await loadCabangOptions(); // akan kosong jika belum pilih mitra
  await loadLinkOptions();   // akan kosong jika belum pilih cabang

  bindFilterEvents();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
