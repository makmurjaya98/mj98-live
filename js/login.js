// js/login.js — single-dashboard flow (semua role → dashboard.html)
import { supabase } from "./supabase-init.js";

// ---------- Helpers ----------
const $ = (s) => document.querySelector(s);

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
  el.textContent = text;
  el.classList.remove("error", "success", "info");
  if (text) el.classList.add(tone);
}

function setBusy(btn, busy) {
  if (!btn) return;
  btn.disabled = !!busy;
  btn.setAttribute("aria-busy", busy ? "true" : "false");
}

function goDashboard(role) {
  // Satu halaman untuk semua role; hash opsional kalau mau dipakai
  const hash = (role === "owner" || role === "admin")
    ? ""
    : role === "mitra-cabang" || role === "mitracabang"
      ? "#mitra"
      : role === "cabang"
        ? "#cabang"
        : role === "link"
          ? "#link"
          : "";
  location.replace(`dashboard.html${hash}`);
}

// ---------- Redirect jika sudah login ----------
async function redirectIfLoggedIn() {
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error || !session) return;

    // sudah login → ambil role lalu ke dashboard.html (satu halaman)
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return goDashboard();

    const { data: profile, error: pErr } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (pErr) {
      console.warn("profiles role load error:", pErr);
      return goDashboard(); // tetap ke dashboard tanpa hash
    }

    goDashboard(String(profile?.role || "").toLowerCase());
  } catch (err) {
    console.error("redirectIfLoggedIn exception:", err);
  }
}
redirectIfLoggedIn();

// ---------- Init setelah DOM siap ----------
function init() {
  const form   = $("#loginForm");
  const emailEl = $("#email");
  const passEl  = $("#password");
  const toggleBtn = $("#togglePass"); // kalau ada tombol
  const showCb   = $("#showPass");    // checkbox pada index.html

  // Toggle via tombol (jika ada)
  if (toggleBtn && passEl) {
    toggleBtn.addEventListener("click", () => {
      const newType = passEl.type === "password" ? "text" : "password";
      passEl.type = newType;
      toggleBtn.setAttribute("aria-pressed", newType === "text" ? "true" : "false");
    });
  }
  // Toggle via checkbox (default pada index.html)
  if (showCb && passEl) {
    showCb.addEventListener("change", () => {
      passEl.type = showCb.checked ? "text" : "password";
    });
  }

  if (!form || !emailEl || !passEl) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    setMsg("");

    const email = (emailEl.value || "").trim();
    const password = passEl.value || "";

    if (!email) {
      setMsg("Email wajib diisi.", "error");
      emailEl.focus(); return;
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setMsg("Format email tidak valid.", "error");
      emailEl.focus(); return;
    }
    if (!password) {
      setMsg("Password wajib diisi.", "error");
      passEl.focus(); return;
    }

    const btn =
      (e.submitter && /** @type {HTMLElement} */ (e.submitter)) ||
      form.querySelector('button[type="submit"], [type="submit"]');

    setBusy(btn, true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      setBusy(btn, false);

      if (error) {
        setMsg(error.message || "Login gagal. Periksa kredensial Anda.", "error");
        (String(error.message || "").toLowerCase().includes("password") ? passEl : emailEl).focus();
        return;
      }

      if (data?.session) {
        // login sukses → ambil role, lalu ke dashboard.html
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return goDashboard();

        const { data: profile, error: pErr } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", user.id)
          .single();

        if (pErr) {
          console.warn("profiles role load error:", pErr);
          setMsg("Berhasil masuk. Mengalihkan…", "success");
          return goDashboard(); // fallback tanpa hash
        }

        setMsg("Berhasil masuk. Mengalihkan…", "success");
        return goDashboard(String(profile?.role || "").toLowerCase());
      }

      setMsg("Login berhasil, namun sesi belum tersedia. Coba lagi.", "error");
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
