// js/reset-password.js — MJ98
import { supabase } from "./supabase-init.js";

const $ = (s)=>document.querySelector(s);
const email = $("#email");
const btn = $("#btnSend");
const msg = $("#msg");

function toast(t, ok=false){ msg.textContent = t || ""; msg.style.color = ok ? "#0ea5e9" : "#ef4444"; }

// Toggle “mata” untuk menampilkan/menyembunyikan email (ubah type text<->email)
$("#toggle")?.addEventListener("click", ()=>{
  if (!email) return;
  const isEmail = email.type === "email";
  email.type = isEmail ? "text" : "email";
  $("#toggle").setAttribute("title", isEmail ? "Sembunyikan email" : "Lihat email");
});

// Submit: kirim email reset
$("#formReset")?.addEventListener("submit", async (e)=>{
  e.preventDefault();
  const v = (email.value || "").trim();
  if (!v) return toast("Email wajib diisi.");
  btn?.setAttribute("disabled","disabled");
  toast("Mengirim…", true);

  // redirectTo harus ada di Supabase Auth -> Authentication -> URL configuration (Redirect URLs)
  const redirectTo = `${location.origin}/update-password.html`;

  const { error } = await supabase.auth.resetPasswordForEmail(v, { redirectTo });
  btn?.removeAttribute("disabled");

  if (error) return toast(error.message || "Gagal mengirim tautan reset.");
  toast("Tautan reset dikirim. Cek inbox/spam.", true);
});
