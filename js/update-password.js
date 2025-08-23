// js/update-password.js — MJ98
import { supabase } from "./supabase-init.js";

const $ = (s)=>document.querySelector(s);
const pwd = $("#password");
const msg = $("#msg");
const btn = $("#btnSave");

// Pastikan user login
(async ()=>{
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) { console.error(error); toast("Gagal memuat sesi."); return; }
  if (!user) { toast("Anda belum login. Silakan login terlebih dulu."); return; }
})();

function toast(t, ok=false){
  msg.textContent = t || "";
  msg.style.color = ok ? "#0ea5e9" : "#ef4444";
}

// Toggle eye
$("#toggle")?.addEventListener("click", ()=>{
  if (!pwd) return;
  const isPwd = pwd.type === "password";
  pwd.type = isPwd ? "text" : "password";
  $("#toggle").setAttribute("title", isPwd ? "Sembunyikan password" : "Lihat password");
});

// Submit
$("#formPass")?.addEventListener("submit", async (e)=>{
  e.preventDefault();
  if (!pwd.value || pwd.value.length < 6) {
    return toast("Minimal 6 karakter.");
  }

  btn?.setAttribute("disabled","disabled");
  toast("Menyimpan…", true);

  const { error } = await supabase.auth.updateUser({ password: pwd.value });
  btn?.removeAttribute("disabled");

  if (error) {
    console.error(error);
    return toast(error.message || "Gagal mengubah password.");
  }
  toast("Password berhasil diubah.", true);
  pwd.value = "";
});
