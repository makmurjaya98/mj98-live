// js/supabase-init.js — MJ98 (ESM singleton, RLS-friendly helpers)
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

/* ===== KONFIG PROYEK (DEFAULT HARDCODE) ===== */
export const SUPABASE_URL = "https://mguxpcbskqxnbpbuhdjj.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1ndXhwY2Jza3F4bmJwYnVoZGpqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTMyMzU1MDEsImV4cCI6MjA2ODgxMTUwMX0.MujhdOQF_aSUWX7XJkQ0ybMNtTPsO-FZggg4DYSHFYY";

/* ===== OVERRIDE DARI RUNTIME (env.js) — kalau ada, dipakai ===== */
const __URL =
  globalThis.__ENV?.SUPABASE_URL ||
  globalThis.VITE_SUPABASE_URL ||
  SUPABASE_URL;

const __KEY =
  globalThis.__ENV?.SUPABASE_ANON_KEY ||
  globalThis.VITE_SUPABASE_ANON_KEY ||
  SUPABASE_ANON_KEY;

// Ekspor nilai AKTIF yang dipakai client (biar gampang debug)
export const CURRENT_SUPABASE_URL = __URL;
export const CURRENT_SUPABASE_ANON_KEY = __KEY;

/* ===== Supabase Client (singleton) ===== */
const existing = globalThis.__mj98Supabase;
export const supabase =
  existing ??
  createClient(__URL, __KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: "mj98.auth",
      flowType: "pkce",
    },
    db: { schema: "public" },
    global: { headers: { "x-client-info": "mj98-web/2025-08" } },
  });

if (!existing) {
  // expose untuk dipakai di Console (diagnostik cepat)
  globalThis.__mj98Supabase = supabase;
  if (!__URL || !__KEY) {
    console.error(
      "[supabase-init] ENV kosong. Pastikan <script src='js/env.js'></script> dimuat SEBELUM file ini."
    );
  }
}

/* =========================================================================
   AUTH & PROFIL
   ========================================================================= */
export async function getCurrentUser() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error) console.debug("getCurrentUser:", error.message);
  return user ?? null;
}

// normalisasi ejaan role: 'mitracabang' -> 'mitra-cabang'
export function normalizeRole(s) {
  s = String(s || "").toLowerCase();
  return s === "mitracabang" ? "mitra-cabang" : s;
}

export async function getProfile(
  // tambah kolom alamat/telepon agar halaman direktori bisa langsung pakai
  columns = "id, role, owner_id, mitracabang_id, cabang_id, username, full_name, email, address, phone_number, phone"
) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select(columns)
    .eq("id", user.id)
    .maybeSingle();
  if (error) {
    console.error("getProfile error:", error);
    throw error;
  }
  if (data?.role) data.role = normalizeRole(data.role);
  return data;
}

export const orgIdOf = (prof) => prof?.owner_id || prof?.id;

/**
 * Terapkan scope sesuai role ke query Supabase.
 * HINTS membolehkan mapping nama kolom per tabel
 * (contoh: di tabel `profiles`, “link scope” = `id`, bukan `link_id`).
 */
export function applyScope(q, prof, hints = {}) {
  const role = normalizeRole(prof?.role || "");
  const ownerId = orgIdOf(prof);

  const col = {
    owner: hints.owner || "owner_id",
    mitra: hints.mitra || "mitracabang_id",
    cabang: hints.cabang || "cabang_id",
    link: hints.link || "link_id",
  };

  if (role === "owner" || role === "admin") return q.eq(col.owner, ownerId);
  if (role === "mitra-cabang") return q.eq(col.mitra, prof.id);
  if (role === "cabang") return q.eq(col.cabang, prof.id);
  if (role === "link") {
    // default: filter berdasarkan kolom “link scope”
    return q.eq(col.link, prof.id);
  }
  return q;
}

export function requireRole(allowed = []) {
  return (async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      location.href = "./index.html";
      return null;
    }
    const { data: prof, error } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    if (error) {
      console.error(error);
      alert("Gagal memuat profil.");
      return null;
    }
    const r = normalizeRole(prof?.role);
    if (allowed.length && !allowed.includes(String(r))) {
      alert("Akses ditolak.");
      location.href = "./index.html";
      return null;
    }
    return { ...prof, role: r };
  })();
}

export async function signOutAndRedirect(to = "./index.html") {
  try {
    await supabase.auth.signOut();
  } finally {
    location.href = to;
  }
}

export function bindLogout(selector = "#btnLogout, #logout") {
  document.querySelectorAll(selector).forEach((btn) =>
    btn.addEventListener("click", () => signOutAndRedirect("./index.html"))
  );
}

export function onAuthStateChanged(cb) {
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") console.debug("Signed out");
    cb?.(event, session);
  });
  return data.subscription;
}

/* =========================================================================
   HELPERS UMUM
   ========================================================================= */
export const toRp = (n) => "Rp " + Number(n || 0).toLocaleString("id-ID");

export function isoRangeFromInputs(fromSel = "#from", toSel = "#to") {
  const fromEl = document.querySelector(fromSel);
  const toEl = document.querySelector(toSel);
  const vFrom = fromEl?.value ? new Date(fromEl.value) : null;
  const vTo = toEl?.value ? new Date(toEl.value) : null;
  if (!vFrom && !vTo) return { gte: null, lt: null };
  let start = vFrom ? new Date(vFrom) : null;
  let end = vTo ? new Date(vTo) : null;
  if (start) start.setHours(0, 0, 0, 0);
  if (end) end.setHours(23, 59, 59, 999);
  if (start && end && start > end) [start, end] = [end, start];
  return {
    gte: start ? start.toISOString() : null,
    lt: end ? new Date(end.getTime() + 1).toISOString() : null,
  };
}

/* ======== ⬇️ PEMETAAN ERROR YANG LEBIH RAMAH ⬇️ ======== */
export function explainSupabaseError(err) {
  if (!err) return "";
  const s = [err?.message, err?.hint, err?.details].filter(Boolean).join(" | ");

  // stok & penjualan
  if (/Stok tidak cukup|Stok tidak mencukupi/i.test(s)) return "Stok tidak cukup untuk transaksi ini.";
  if (/violates check constraint/i.test(s)) return "Data tidak valid (melanggar constraint).";

  // kolom / relasi / view
  if (/record .* has no field/i.test(s)) return "Kolom yang diminta tidak ada. Pastikan nama kolom & versi view tepat.";
  if (/column .* does not exist/i.test(s)) return "Kolom yang dipilih tidak ada. Cek nama kolom & versi view.";
  if (/relation .* does not exist/i.test(s)) return "Tabel/view yang dirujuk tidak ada. Cek nama schema (public) & versi migrasi.";
  if (/missing FROM-clause/i.test(s)) return "Alias/CTE tidak dikenali (cek WITH/alias di query).";

  // fungsi / RPC
  if (/function .* does not exist|no function matches/i.test(s)) return "RPC/fungsi tidak cocok dengan parameter. Sesuaikan argumen/nama.";
  if (/cannot change name of input parameter/i.test(s)) return "Signature fungsi berubah. Drop & buat ulang fungsi tersebut.";
  if (/cannot remove parameter defaults/i.test(s)) return "Ubah default parameter butuh DROP FUNCTION lalu CREATE ulang.";
  if (/is an aggregate function/i.test(s)) return "Salah pakai fungsi agregat di tempat yang bukan SELECT agregat.";

  // RLS / policy
  if (/permission denied|row-level security/i.test(s)) return "Ditolak RLS/Policy. Periksa policy & role pengguna.";
  if (/infinite recursion detected in policy/i.test(s)) return "Policy saling memanggil (rekursi). Rapikan fungsi/policy RLS terkait.";

  // umum
  if (/syntax error/i.test(s)) return "Syntax SQL salah. Cek kembali perintah.";
  if (/No API key|apikey/i.test(s)) return "Kredensial tidak terkirim. Pastikan inisialisasi Supabase client benar.";
  return err?.message || String(err);
}
/* ======== ⬆️ PEMETAAN ERROR YANG LEBIH RAMAH ⬆️ ======== */

/* =========================================================================
   RPC & DATA LAYER — SELARAS DENGAN FUNGSI DI DB
   ========================================================================= */

/** Catat penjualan voucher (now).
 * DB: record_voucher_sale(p_link uuid, p_vtype uuid, p_qty int, p_note text)
 */
export async function rpcRecordVoucherSale({
  link_id,
  voucher_type_id,
  qty,
  note,
}) {
  const { error } = await supabase.rpc("record_voucher_sale", {
    p_link: link_id,
    p_vtype: voucher_type_id,
    p_qty: Number(qty || 0),
    p_note: note ?? null,
  });
  if (error) throw new Error(explainSupabaseError(error));
  return true;
}

/** Catat penjualan voucher di waktu tertentu (opsional).
 * DB: record_voucher_sale_at(p_link_id uuid, p_voucher_type_id uuid, p_qty int, p_note text, p_created_at timestamptz)
 */
export async function rpcRecordVoucherSaleAt({
  link_id,
  voucher_type_id,
  qty,
  note,
  created_at = null,
}) {
  const { error } = await supabase.rpc("record_voucher_sale_at", {
    p_link_id: link_id,
    p_voucher_type_id: voucher_type_id,
    p_qty: Number(qty || 0),
    p_note: note ?? null,
    p_created_at: created_at,
  });
  if (error) throw new Error(explainSupabaseError(error));
  return true;
}

/** Ambil daftar voucher type milik owner (untuk dropdown). */
export async function fetchVoucherTypesForOwner(
  ownerId,
  columns = "id, owner_id, nama, harga_pokok, harga_jual"
) {
  const q = supabase
    .from("voucher_types")
    .select(columns)
    .eq("owner_id", ownerId)
    .order("nama", { ascending: true });
  const { data, error } = await q;
  if (error) throw new Error(explainSupabaseError(error));
  return data || [];
}

/** Ambil pengaturan share/komisi (opsional untuk pratinjau). */
export async function fetchShareSetting({
  owner_id,
  voucher_type_id,
  mitracabang_id = null,
  cabang_id = null,
}) {
  let q = supabase
    .from("voucher_share_settings")
    .select(
      "id, owner_id, voucher_type_id, mitracabang_id, cabang_id, share_link, share_cabang, komisi_link_persen, komisi_cabang_persen, komisi_mitra_persen"
    )
    .eq("owner_id", owner_id)
    .eq("voucher_type_id", voucher_type_id);

  if (mitracabang_id === null) q = q.is("mitracabang_id", null);
  else q = q.eq("mitracabang_id", mitracabang_id);

  if (cabang_id === null) q = q.is("cabang_id", null);
  else q = q.eq("cabang_id", cabang_id);

  const { data, error } = await q.limit(1);
  if (error) throw new Error(explainSupabaseError(error));
  return data?.[0] || null;
}

/** Daftar LINK sesuai scope user. (tabel: profiles)
 * NOTE: karena tabelnya `profiles`, untuk role=link scope-nya adalah `id` (bukan `link_id`).
 */
export async function listLinksByScope(
  prof,
  columns = "id, username, full_name, owner_id, mitracabang_id, cabang_id, role"
) {
  let q = supabase.from("profiles").select(columns).eq("role", "link");
  // hint kolom agar applyScope tidak memaksa memakai link_id di tabel profiles
  q = applyScope(q, prof, { owner: "owner_id", mitra: "mitracabang_id", cabang: "cabang_id", link: "id" });
  const { data, error } = await q.order("username", { ascending: true });
  if (error) throw new Error(explainSupabaseError(error));
  return data || [];
}

/** KPI dashboard contoh. */
export async function rpcKpiDashboard({
  ts_col = "created_at",
  setoran_col = "amount",
  g_from = null,
  g_to = null,
} = {}) {
  const { data, error } = await supabase.rpc("fn_kpi_dashboard", {
    ts_col,
    setoran_col,
    g_from,
    g_to,
  });
  if (error) throw new Error(explainSupabaseError(error));
  return (
    data?.[0] || {
      total_jual: 0,
      total_pokok: 0,
      pendapatan_owner: 0,
      pendapatan_mitracabang: 0,
      pendapatan_cabang: 0,
      pendapatan_link: 0,
      total_setoran: 0,
    }
  );
}

/** Laporan per mitracabang / cabang. */
export async function rpcReportPerMitra({
  owner_id,
  from,
  to,
  only_mitracabang_id = null,
}) {
  const { data, error } = await supabase.rpc("report_per_mitracabang", {
    p_owner_id: owner_id,
    p_from: from,
    p_to: to,
    p_only_mitracabang_id: only_mitracabang_id,
  });
  if (error) throw new Error(explainSupabaseError(error));
  return data || [];
}

export async function rpcReportPerCabang({
  owner_id,
  from,
  to,
  only_mitracabang_id = null,
  only_cabang_id = null,
}) {
  const { data, error } = await supabase.rpc("report_per_cabang", {
    p_owner_id: owner_id,
    p_from: from,
    p_to: to,
    p_only_mitracabang_id: only_mitracabang_id,
    p_only_cabang_id: only_cabang_id,
  });
  if (error) throw new Error(explainSupabaseError(error));
  return data || [];
}

/** Ringkasan tagihan vs setoran (periode). */
export async function rpcSummaryTagihanDeposits({ owner_id, from, to }) {
  const { data, error } = await supabase.rpc("summary_tagihan_deposits", {
    p_owner: owner_id,
    p_from: from,
    p_to: to,
  });
  if (error) throw new Error(explainSupabaseError(error));
  return data?.[0] || { total_tagihan: 0, total_setoran: 0, sisa_setoran: 0 };
}

/* =========================================================================
   SIDEBAR KONSISTEN LINTAS HALAMAN
   ========================================================================= */

// Konfigurasi item default (termasuk Kartu Tagihan)
const __SIDEBAR_ITEMS__ = [
  { href: "dashboard.html",     label: "Dashboard"     },
  { href: "kartu-tagihan.html", label: "Kartu Tagihan" },
  { href: "laporan.html",       label: "Laporan"       },
  { href: "setoran.html",       label: "Setoran"       },
  { href: "stok.html",          label: "Stok"          },
  { href: "voucher.html",       label: "Voucher"       },
  { href: "daftar-user.html",   label: "Daftar User"   },
  { href: "pengumuman.html",    label: "Pengumuman"    },
  { href: "pengaturan.html",    label: "Pengaturan"    },
];

// Role gating sederhana (kalau perlu batasi, ganti arraynya)
const __ALLOW_BY_ROLE__ = {
  owner: "all",
  admin: "all",
  "mitra-cabang": "all",
  mitracabang: "all",
  cabang: "all",
  link: "all",
};

/** Render sidebar ke .sidebar .menu */
export async function renderSidebar(opt = {}) {
  const sel = opt.containerSelector || ".sidebar .menu";
  const menu = document.querySelector(sel);
  if (!menu) return;

  // Baca role (jangan bikin redirect apapun di sini)
  let role = "owner";
  try {
    const prof = await getProfile("role");
    role = normalizeRole(prof?.role || "owner");
  } catch (_) {}

  const items = opt.items || __SIDEBAR_ITEMS__;
  const allowed =
    __ALLOW_BY_ROLE__[role] === "all"
      ? items
      : items.filter((i) => (__ALLOW_BY_ROLE__[role] || []).includes(i.href));

  const current = location.pathname.split("/").pop() || "dashboard.html";
  menu.innerHTML = allowed
    .map((i) => {
      const active = current === i.href;
      return `<a class="btn ${active ? "active" : ""}" href="${i.href}" ${
        active ? 'aria-current="page"' : ""
      }>${i.label}</a>`;
    })
    .join("");
}

/* =========================================================================
   BOOT GLOBAL UI TIPIS
   ========================================================================= */
function bootGlobalUi() {
  try {
    bindLogout();

    const body = document.body;
    const isAuthPage =
      body?.classList?.contains("page-login") ||
      body?.classList?.contains("page-register");

    // Auto render sidebar bila elemen tersedia dan tidak dimatikan
    const shouldSkipSidebar =
      document.body.hasAttribute("data-skip-autosidebar");
    if (!isAuthPage && !shouldSkipSidebar && document.querySelector(".sidebar .menu")) {
      renderSidebar().catch(() => {});
    }

    const hasContainer = document.querySelector(".content .container");
    if (!isAuthPage && hasContainer) {
      import("./global-alert.js")
        .then((mod) => mod.initGlobalSetoranAlert?.())
        .catch(() => {});
    }
  } catch (e) {
    console.debug("Global UI init skipped:", e?.message || e);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootGlobalUi, { once: true });
} else {
  bootGlobalUi();
}
