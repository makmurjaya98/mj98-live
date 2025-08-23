// js/login.js — single-dashboard flow (semua role → dashboard.html)
import { supabase } from "./supabase-init.js";

/* ================= Helpers ================= */
const $ = (s) => document.querySelector(s);
const EMAIL_REDIRECT_TO = `${location.origin}/index.html`;

function ensureMsgEl() {
  let el = $("#msg");
  if (!el) {
    el = document.createElement("div");
    el.id = "msg";
    el.setAttribute("role", "alert");
    el.className = "mt-2";
    const anchor = $("#loginForm") || document.body;
    anchor.prepend(el);
  }
  return el;
}
function setMsg(text = "", tone = "info") {
  const el = ensureMsgEl();
  el.textContent = text || "";
  el.classList.remove("error", "success", "info");
  if (text) el.classList.add(tone);
}
function setBusy(btn, busy) {
  if (!btn) return;
  btn.disabled = !!busy;
  btn.setAttribute("aria-busy", busy ? "true" : "false");
}

/* ---- Normalisasi & Navigasi ---- */
// DB menggunakan 'mitracabang' (tanpa tanda hubung)
function normalizeRole(r) {
  const x = String(r || "").trim().toLowerCase();
  if (x === "mitra-cabang" || x === "mitra_cabang") return "mitracabang";
  if (x === "branch") return "cabang";
  if (x === "pemilik") return "owner";
  return x; // "owner" | "mitracabang" | "cabang" | "link" | "admin" | "" | lainnya
}
function targetHashForRole(role) {
  const r = normalizeRole(role);
  if (r === "mitracabang") return "#mitra";
  if (r === "cabang") return "#cabang";
  if (r === "link") return "#link";
  // owner/admin/unknown → tanpa hash
  return "";
}
function goDashboard(role) {
  location.replace(`dashboard.html${targetHashForRole(role)}`);
}

/* ================= Redirect jika sudah login ================= */
async function redirectIfLoggedIn() {
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error || !session) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return goDashboard("");

    // Utama: baca dari profiles
    let role = "";
    try {
      const { data: profile, error: pErr } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();
      if (!pErr) role = String(profile?.role || "");
    } catch { /* abaikan; fallback di bawah */ }

    if (!role) role = String(user.user_metadata?.role || "");
    goDashboard(role);
  } catch (err) {
    console.error("redirectIfLoggedIn exception:", err);
  }
}
redirectIfLoggedIn();

/* ================= Init setelah DOM siap ================= */
function init() {
  const form       = $("#loginForm");
  const emailEl    = $("#email");
  const passEl     = $("#password");
  const toggleBtn  = $("#togglePass");  // tombol (opsional)
  const showCb     = $("#showPass");    // checkbox (opsional)
  const resendBtn  = $("#resendVerify");// tombol kirim ulang (opsional)

  // Toggle via tombol
  if (toggleBtn && passEl) {
    toggleBtn.addEventListener("click", () => {
      const newType = passEl.type === "password" ? "text" : "password";
      passEl.type = newType;
      toggleBtn.setAttribute("aria-pressed", newType === "text" ? "true" : "false");
    });
  }
  // Toggle via checkbox
  if (showCb && passEl) {
    showCb.addEventListener("change", () => {
      passEl.type = showCb.checked ? "text" : "password";
    });
  }

  // Kirim ulang verifikasi (opsional tombol)
  if (resendBtn) {
    resendBtn.addEventListener("click", async () => {
      const email = (emailEl?.value || "").trim();
      if (!email) {
        setMsg("Masukkan email terlebih dahulu, lalu klik kirim ulang verifikasi.", "error");
        emailEl?.focus();
        return;
      }
      resendBtn.setAttribute("disabled", "disabled");
      try {
        const { error } = await supabase.auth.resend({
          type: "signup",
          email,
          options: { emailRedirectTo: EMAIL_REDIRECT_TO },
        });
        if (error) throw error;
        setMsg("Tautan verifikasi baru sudah dikirim. Cek Inbox/Spam, lalu klik tautannya.", "success");
      } catch (e) {
        setMsg(e?.message || "Gagal mengirim ulang verifikasi.", "error");
      } finally {
        resendBtn.removeAttribute("disabled");
      }
    });
  }

  if (!form || !emailEl || !passEl) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    setMsg("");

    const email = (emailEl.value || "").trim();
    const password = passEl.value || "";

    if (!email) { setMsg("Email wajib diisi.", "error"); emailEl.focus(); return; }
    if (!/^\S+@\S+\.\S+$/.test(email)) { setMsg("Format email tidak valid.", "error"); emailEl.focus(); return; }
    if (!password) { setMsg("Password wajib diisi.", "error"); passEl.focus(); return; }

    const btn =
      (e.submitter && /** @type {HTMLElement} */ (e.submitter)) ||
      form.querySelector("button[type='submit'], [type='submit']");

    setBusy(btn, true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      setBusy(btn, false);

      if (error) {
        const raw = String(error.message || "");
        const msg = raw.toLowerCase();

        // === Kasus paling sering: email belum terkonfirmasi ===
        if (msg.includes("email not confirmed") || msg.includes("email not confirmed")) {
          setMsg("Email belum terverifikasi. Mengirim ulang tautan verifikasi…", "info");
          try {
            const { error: re } = await supabase.auth.resend({
              type: "signup",
              email,
              options: { emailRedirectTo: EMAIL_REDIRECT_TO },
            });
            if (re) throw re;
            setMsg("Tautan verifikasi baru terkirim. Cek Inbox/Spam, lalu klik tautannya.", "success");
          } catch (re) {
            setMsg(re?.message || "Gagal mengirim ulang verifikasi. Coba lagi atau hubungi admin.", "error");
          }
          return;
        }

        // Kredensial salah
        if (msg.includes("invalid login credentials") || msg.includes("invalid")) {
          setMsg("Email atau password salah.", "error");
          (msg.includes("password") ? passEl : emailEl).focus();
          return;
        }

        // Pesan lain
        setMsg(raw || "Login gagal. Periksa kredensial Anda.", "error");
        (msg.includes("password") ? passEl : emailEl).focus();
        return;
      }

      if (!data?.session) {
        setMsg("Login berhasil, namun sesi belum tersedia. Coba lagi.", "error");
        return;
      }

      // login sukses → ambil role dari profiles; fallback ke user_metadata.role
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { goDashboard(""); return; }

      let role = "";
      try {
        const { data: profile, error: pErr } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", user.id)
          .single();
        if (!pErr) role = String(profile?.role || "");
      } catch { /* abaikan */ }

      if (!role) role = String(user.user_metadata?.role || "");

      setMsg("Berhasil masuk. Mengalihkan…", "success");
      goDashboard(role);
    } catch (err) {
      setBusy(btn, false);
      console.error("signIn exception:", err);
      setMsg("Terjadi kesalahan jaringan/tidak terduga. Coba lagi.", "error");
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
