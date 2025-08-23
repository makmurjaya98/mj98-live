// js/register.js — MJ98 (Register bertahap via RPC, tampilkan username, simpan UUID)
import { supabase } from "./supabase-init.js";

/* =============== UTIL =============== */
const params   = new URLSearchParams(location.search);
const formRoot = () => document.getElementById("regForm");
const q        = (sel) => formRoot()?.querySelector(sel) || document.querySelector(sel);

function toast(msg, ok = false) {
  const el = q("#msg") || (() => {
    const n = document.createElement("div");
    n.id = "msg"; n.className = "center mt-12"; n.style.minHeight = "18px";
    (formRoot() || document.body).appendChild(n); return n;
  })();
  el.textContent = msg || "";
  el.style.color = ok ? "#2e7d32" : "#b42318";
}
const val = (el) => (typeof el?.value === "string" ? el.value.trim() : "");

// UI role → DB role (standar: "mitracabang" TANPA tanda hubung)
function normRole(r) {
  const x = String(r || "").toLowerCase();
  if (x === "mitra-cabang" || x === "mitra_cabang") return "mitracabang";
  return x;
}

/* ------- refs aman (scoped ke #regForm) ------- */
const els = {
  form:       () => formRoot(),
  role:       () => q("#role"),
  username:   () => q("#username"),
  email:      () => q("#email"),
  pass:       () => q("#password"),
  pass2:      () => q("#password2"),
  full_name:  () => q("#full_name"),
  nomor_id:   () => q("#nomor_id"),
  phone:      () => q("#phone"),
  address:    () => q("#address"),
  nik:        () => q("#nik"),

  // bertahap
  boxOwner:   () => q("#ownerBox"),
  boxMitra:   () => q("#mitraBox"),
  boxCabang:  () => q("#cabangBox"),
  pickOwner:  () => q("#owner_pick"),
  pickMitra:  () => q("#mitra_pick"),
  pickCabang: () => q("#cabang_pick"),

  // btn & eye
  submitBtn:  () => q("button[type='submit']"),
  eye1:       () => q("#eye1"),
  eye2:       () => q("#eye2"),
};

/* =============== DATA VIA RPC (bypass RLS) =============== */
async function listOwners() {
  const { data, error } = await supabase.rpc("list_public_profiles", { p_role: "owner" });
  if (error) { console.error("[owners]", error); return []; }
  return data || [];
}
async function listMitraByOwner(owner_id) {
  if (!owner_id) return [];
  const { data, error } = await supabase.rpc("list_public_profiles", {
    p_role: "mitracabang",     // <- STANDAR
    p_owner: owner_id
  });
  if (error) { console.error("[mitra]", error); return []; }
  return data || [];
}
async function listCabangByMitra(mitracabang_id) {
  if (!mitracabang_id) return [];
  const { data, error } = await supabase.rpc("list_public_profiles", {
    p_role: "cabang",
    p_mitracabang: mitracabang_id
  });
  if (error) { console.error("[cabang]", error); return []; }
  return data || [];
}
async function usernameTaken(name) {
  if (!name) return false;
  try {
    const { data, error } = await supabase.rpc("username_exists", { p_username: name });
    if (error) throw error;
    return !!(Array.isArray(data) ? (data[0]?.exists ?? data?.exists) : data);
  } catch {
    const { count } = await supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .ilike("username", name);
    return (count || 0) > 0;
  }
}

/* =============== UI HELPERS =============== */
function fillSelect(sel, rows, placeholder = "— pilih —") {
  if (!sel) return;
  sel.innerHTML = "";
  const opt0 = document.createElement("option");
  opt0.value = ""; opt0.textContent = placeholder;
  sel.appendChild(opt0);
  for (const r of rows) {
    const o = document.createElement("option");
    o.value = r.id;             // SIMPAN UUID
    o.textContent = r.username; // TAMPILKAN username
    sel.appendChild(o);
  }
}
function show(el, yes) { if (el) el.hidden = !yes; }

/* =============== PREFILL via URL (username/uuid) =============== */
function pickBy(select, wanted) {
  if (!select || !wanted) return false;
  const w = String(wanted).trim().toLowerCase();
  for (const opt of select.options) {
    if (opt.value.toLowerCase() === w || opt.textContent.trim().toLowerCase() === w) {
      select.value = opt.value; return true;
    }
  }
  return false;
}
async function tryPrefillChainFromURL() {
  const pOwner  = params.get("owner")  || "";
  const pMitra  = params.get("mitra")  || "";
  const pCabang = params.get("cabang") || "";

  if (pickBy(els.pickOwner(), pOwner)) await onOwnerChange();
  if (pickBy(els.pickMitra(), pMitra)) await onMitraChange();
  pickBy(els.pickCabang(), pCabang);
}

/* =============== ROLE LOGIC (bertahap sesuai aturan) =============== */
async function applyRoleUI(initial = false) {
  const uiRole = (els.role()?.value || "link").toLowerCase();

  // reset pilihan kalau ganti role
  if (!initial) {
    els.pickOwner()  && (els.pickOwner().value  = "");
    els.pickMitra()  && (els.pickMitra().value  = "");
    els.pickCabang() && (els.pickCabang().value = "");
  }

  // Owner: tidak perlu apa pun
  if (uiRole === "owner") {
    show(els.boxOwner(),  false);
    show(els.boxMitra(),  false);
    show(els.boxCabang(), false);
    return;
  }

  // Ambil daftar owner (sekali)
  show(els.boxOwner(), true);
  if (els.pickOwner() && els.pickOwner().options.length <= 1) {
    fillSelect(els.pickOwner(), await listOwners(), "— pilih owner —");
  }

  // Mitracabang: hanya butuh owner
  if (uiRole === "mitracabang") {
    show(els.boxMitra(),  false);
    show(els.boxCabang(), false);
    return;
  }

  // Cabang: butuh owner → kalau owner terpilih, tampilkan mitra
  if (uiRole === "cabang") {
    const ownerId = els.pickOwner()?.value || "";
    if (ownerId) {
      show(els.boxMitra(), true);
      fillSelect(els.pickMitra(), await listMitraByOwner(ownerId), "— pilih mitracabang —");
    } else {
      show(els.boxMitra(), false);
    }
    show(els.boxCabang(), false);
    return;
  }

  // Link: owner → mitra → cabang
  if (uiRole === "link") {
    const ownerId = els.pickOwner()?.value || "";
    if (ownerId) {
      show(els.boxMitra(), true);
      if (els.pickMitra().options.length <= 1) {
        fillSelect(els.pickMitra(), await listMitraByOwner(ownerId), "— pilih mitracabang —");
      }
      const mitraId = els.pickMitra()?.value || "";
      if (mitraId) {
        show(els.boxCabang(), true);
        fillSelect(els.pickCabang(), await listCabangByMitra(mitraId), "— pilih cabang —");
      } else {
        show(els.boxCabang(), false);
      }
    } else {
      show(els.boxMitra(), false);
      show(els.boxCabang(), false);
    }
    if (initial) await tryPrefillChainFromURL();
    return;
  }
}

/* =============== CHAINING SELECT HANDLERS =============== */
async function onOwnerChange() {
  const uiRole = (els.role()?.value || "link").toLowerCase();
  const ownerId = els.pickOwner()?.value || "";

  // reset bawah
  fillSelect(els.pickMitra(),  [], "— pilih mitracabang —");
  fillSelect(els.pickCabang(), [], "— pilih cabang —");

  if (!ownerId) { applyRoleUI(false); return; }

  if (uiRole === "cabang" || uiRole === "link") {
    show(els.boxMitra(), true);
    fillSelect(els.pickMitra(), await listMitraByOwner(ownerId), "— pilih mitracabang —");
  }
  // untuk link, cabang baru muncul setelah mitra dipilih
  show(els.boxCabang(), false);
}

async function onMitraChange() {
  const uiRole = (els.role()?.value || "link").toLowerCase();
  const mitraId = els.pickMitra()?.value || "";
  fillSelect(els.pickCabang(), [], "— pilih cabang —");

  if (uiRole === "link" && mitraId) {
    show(els.boxCabang(), true);
    fillSelect(els.pickCabang(), await listCabangByMitra(mitraId), "— pilih cabang —");
  } else {
    show(els.boxCabang(), false);
  }
}

/* =============== EYE TOGGLE =============== */
function hookEyes() {
  const p1 = els.pass(); const p2 = els.pass2();
  els.eye1()?.addEventListener("click", () => { if (p1) p1.type = (p1.type === "password" ? "text" : "password"); });
  els.eye2()?.addEventListener("click", () => { if (p2) p2.type = (p2.type === "password" ? "text" : "password"); });
}

/* =============== VALIDASI RANTAI =============== */
function currentChainIds() {
  const uiRole = (els.role()?.value || "link").toLowerCase();
  const owner_id  = els.pickOwner()?.value || null;
  const mitra_id  = els.pickMitra()?.value || null;
  const cabang_id = els.pickCabang()?.value || null;

  if (uiRole === "owner")        return { owner_id: null,               mitracabang_id: null,     cabang_id: null };
  if (uiRole === "mitracabang")  return { owner_id,                     mitracabang_id: null,     cabang_id: null };
  if (uiRole === "cabang")       return { owner_id,                     mitracabang_id: mitra_id, cabang_id: null };
  return { owner_id, mitracabang_id: mitra_id, cabang_id }; // link
}
function validateChain(uiRole, ids) {
  if (uiRole === "mitracabang" && !ids.owner_id)       return "Silakan pilih owner.";
  if (uiRole === "cabang"      && !ids.owner_id)       return "Silakan pilih owner.";
  if (uiRole === "cabang"      && !ids.mitracabang_id) return "Silakan pilih mitra.";
  if (uiRole === "link"        && !ids.owner_id)       return "Silakan pilih owner.";
  if (uiRole === "link"        && !ids.mitracabang_id) return "Silakan pilih mitra.";
  if (uiRole === "link"        && !ids.cabang_id)      return "Silakan pilih cabang.";
  return "";
}

/* =============== BOOTSTRAP & SUBMIT =============== */
const formEl = els.form();
if (formEl) {
  (async () => { hookEyes(); await applyRoleUI(true); })();

  els.role()?.addEventListener("change", () => applyRoleUI(false));
  els.pickOwner()?.addEventListener("change", onOwnerChange);
  els.pickMitra()?.addEventListener("change", onMitraChange);

  // cek username unik
  els.username()?.addEventListener("blur", async () => {
    const used = await usernameTaken(val(els.username()));
    if (used) {
      toast("Username sudah dipakai, silakan pilih yang lain.");
      els.submitBtn()?.setAttribute("disabled","disabled");
    } else {
      toast("");
      els.submitBtn()?.removeAttribute("disabled");
    }
  });

  formEl.addEventListener("submit", async (e) => {
    e.preventDefault();
    toast("");

    const uiRole    = (els.role()?.value || "link").toLowerCase();
    const dbRole    = normRole(uiRole);        // pastikan "mitracabang"
    const email     = val(els.email());
    const password  = val(els.pass());
    const password2 = val(els.pass2());

    const chain = currentChainIds();
    const chainErr = validateChain(uiRole, chain);
    if (chainErr) return toast(chainErr);

    const payload = {
      role:      dbRole,                     // simpan role versi DB (mitracabang)
      username:  val(els.username()),
      full_name: val(els.full_name()),
      nomor_id:  val(els.nomor_id()),
      phone:     val(els.phone()) || null,
      address:   val(els.address()) || null,
      nik:       val(els.nik()) || null,
      ...chain,
    };

    if (!payload.username)      return toast("Username wajib diisi.");
    if (!email)                 return toast("Email wajib diisi.");
    if (!password)              return toast("Password wajib diisi.");
    if (password.length < 6)    return toast("Password minimal 6 karakter.");
    if (password !== password2) return toast("Ulangi password tidak sama.");
    if (!payload.nomor_id)      return toast("Nomor ID wajib diisi.");

    const btn = els.submitBtn(); btn?.setAttribute("disabled","disabled");

    try {
      // 1) daftar auth
      const { data, error } = await supabase.auth.signUp({
        email, password,
        options: {
          data: payload,
          emailRedirectTo: `${location.origin}/index.html`,
        },
      });
      if (error) throw error;

      // 2) jika ada session, coba RPC, lalu fallback upsert
      let session = data.session;
      if (!session) {
        const g = await supabase.auth.getSession();
        session = g.data.session || null;
      }

      if (session) {
        let rpcFailed = false;
        try {
          const { error: eRpc } = await supabase.rpc("fn_register_profile", {
            p_role: payload.role, // "mitracabang"
            p_username: payload.username,
            p_full_name: payload.full_name,
            p_nomor_id: payload.nomor_id,
            p_phone: payload.phone,
            p_address: payload.address,
            p_nik: payload.nik,
            p_owner_id: payload.owner_id,
            p_mitracabang_id: payload.mitracabang_id,
            p_cabang_id: payload.cabang_id,
          });
          if (eRpc) rpcFailed = true;
        } catch { rpcFailed = true; }

        if (rpcFailed) {
          const prof = {
            id: session.user.id,
            role: payload.role,
            username: payload.username,
            full_name: payload.full_name,
            email,
            nomor_id: payload.nomor_id,
            phone: payload.phone,
            address: payload.address,
            nik: payload.nik,
            owner_id: payload.owner_id,
            mitracabang_id: payload.mitracabang_id,
            cabang_id: payload.cabang_id,
            is_active: true,
          };
          const { error: upErr } = await supabase.from("profiles").upsert(prof, { onConflict: "id" });
          if (upErr) throw upErr;
        }

        toast("Registrasi berhasil. Profil dibuat.", true);
        setTimeout(() => (location.href = "index.html"), 1200);
      } else {
        toast("Registrasi berhasil. Cek email untuk verifikasi, lalu login.", true);
      }
    } catch (err) {
      console.error(err);
      const msg = err?.message || String(err);
      toast(msg.includes("Database error saving new user")
        ? "Gagal simpan user di database. Cek role & relasi (owner/mitra/cabang)."
        : msg);
    } finally {
      btn?.removeAttribute("disabled");
    }
  });
} else {
  console.warn('Form register tidak ditemukan (id="regForm").');
}

// === Kirim ulang email verifikasi ===
const resendBtn = document.getElementById('resendBtn');
if (resendBtn) {
  resendBtn.addEventListener('click', async () => {
    const email = (document.getElementById('email')?.value || '').trim();
    if (!email) return toast('Masukkan email yang didaftarkan di kolom Email.');

    resendBtn.setAttribute('disabled', 'disabled');
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email,
        options: { emailRedirectTo: `${location.origin}/index.html` },
      });
      if (error) throw error;
      toast('Link verifikasi dikirim ulang. Cek inbox/spam.', true);
    } catch (e) {
      toast(e.message || 'Gagal kirim ulang verifikasi.');
    } finally {
      resendBtn.removeAttribute('disabled');
    }
  });
}
