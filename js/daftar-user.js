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
};

const el  = (sel) => document.querySelector(sel);
const els = (sel) => Array.from(document.querySelectorAll(sel));

const safeText    = (v) => (v ?? "").toString().trim();
const pickPhone   = (r) => safeText(r.phone_number ?? r.phone ?? "");
const pickIdNum   = (r) => safeText(r.nik ?? r.id_number ?? r.nomor_id ?? "");
const pickAddress = (r) => safeText(r.address ?? "");
const pickName    = (r) => safeText(r.full_name ?? r.username ?? "");

/* === util: dukung dua versi id (#filter-* dan #sel*) tanpa memotong kode === */
function pickSel(idA, idB){
  return el(idA) ?? el(idB) ?? null;
}
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
   Isi dropdown filter
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
}

async function loadCabangOptions() {
  const sel = elsFilter.cabang();
  if (!sel) return;

  if (!state.selMitra) {
    setOptions(sel, [], "— pilih mitra dulu —");
    sel.disabled = true;
    state.cache.cabang = [];
    renderRows("#tblCabang", [], el("#qCabang")?.value || "");
    return;
  }

  const rows = await fetchProfilesByRole(ROLE_CABANG, (q) =>
    q.eq("mitracabang_id", state.selMitra)
  );
  state.cache.cabang = rows;

  setOptions(sel, rows, "— pilih cabang —");
  sel.disabled = rows.length === 0;
}

async function loadLinkOptions() {
  const sel = elsFilter.link();
  if (!sel) return;

  if (!state.selCabang) {
    setOptions(sel, [], "— pilih cabang dulu —");
    sel.disabled = true;
    state.cache.link = [];
    renderRows("#tblLink", [], el("#qLink")?.value || "");
    return;
  }

  const rows = await fetchProfilesByRole(ROLE_LINK, (q) =>
    q.eq("cabang_id", state.selCabang)
  );
  state.cache.link = rows;

  setOptions(sel, rows, "— pilih link —");
  sel.disabled = rows.length === 0;
}

/* ==========================
   Render tabel
   ========================== */

// otomatis pakai <tbody> kalau selector yang diberikan adalah <table>
function resolveTbody(tbodySel){
  const node = el(tbodySel);
  if (!node) return null;
  if (node.tagName === "TBODY") return node;
  return node.querySelector("tbody") || node; // fallback kompat lama
}

function renderRows(tbodySel, rows, q = "") {
  const tb = resolveTbody(tbodySel);
  if (!tb) return;
  const term = (q || "").toLowerCase().trim();

  const filtered = rows.filter((r) => {
    if (!term) return true;
    const hay = [
      pickName(r),
      safeText(r.username),
      pickAddress(r),
      pickPhone(r),
      safeText(r.email),
      pickIdNum(r),
    ]
      .join(" | ")
      .toLowerCase();
    return hay.includes(term);
  });

  if (!filtered.length) {
    tb.innerHTML = `<tr><td colspan="6" class="text-center">Tidak ada data</td></tr>`;
    return;
  }

  tb.innerHTML = filtered
    .map((r) => {
      const nm   = pickName(r) || "-";
      const un   = safeText(r.username) || "-";
      const addr = pickAddress(r) || "-";
      const hp   = pickPhone(r) || "-";
      const mail = safeText(r.email) || "-";
      const idn  = pickIdNum(r) || "-";
      return `<tr>
        <td>${nm}</td>
        <td>${un}</td>
        <td>${addr}</td>
        <td>${hp}</td>
        <td>${mail}</td>
        <td>${idn}</td>
      </tr>`;
    })
    .join("");
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

/* ==========================
   Event bindings
   ========================== */

function bindFilterEvents() {
  const selM = elsFilter.mitra();
  const selC = elsFilter.cabang();
  const selL = elsFilter.link();

  selM?.addEventListener("change", async (e) => {
    state.selMitra = e.target.value || null;
    // reset setelah mitra berganti
    state.selCabang = null;
    await loadCabangOptions();
    await loadLinkOptions();

    renderRows("#tblCabang", state.cache.cabang, el("#qCabang")?.value || "");
    renderRows("#tblLink", state.cache.link, el("#qLink")?.value || "");
  });

  selC?.addEventListener("change", async (e) => {
    state.selCabang = e.target.value || null;
    await loadLinkOptions();
    renderRows("#tblLink", state.cache.link, el("#qLink")?.value || "");
  });

  selL?.addEventListener("change", (e) => {
    state.selLink = e.target.value || null;
  });

  // quick search
  el("#qMitra") ?.addEventListener("input", (e) => {
    renderRows("#tblMitra", state.cache.mitra, e.target.value);
  });
  el("#qCabang")?.addEventListener("input", (e) => {
    renderRows("#tblCabang", state.cache.cabang, e.target.value);
  });
  el("#qLink")  ?.addEventListener("input", (e) => {
    renderRows("#tblLink", state.cache.link, e.target.value);
  });

  // export (sesuai filter yang sedang tampil)
  btnExportFilter()?.addEventListener("click", () => {
    const rows = [
      ...state.cache.mitra,
      ...state.cache.cabang,
      ...state.cache.link,
    ];
    downloadCsv("direktori-filter.csv", rows);
  });

  // export keseluruhan (akses sesuai policy user login)
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

  // Muat dropdown & tabel awal
  await loadMitraOptions();
  await loadCabangOptions(); // akan kosong jika belum pilih mitra
  await loadLinkOptions();   // akan kosong jika belum pilih cabang

  renderRows("#tblMitra", state.cache.mitra, el("#qMitra")?.value || "");
  renderRows("#tblCabang", state.cache.cabang, el("#qCabang")?.value || "");
  renderRows("#tblLink", state.cache.link, el("#qLink")?.value || "");

  bindFilterEvents();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}

