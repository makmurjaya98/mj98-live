import { supabase, signOutAndRedirect } from "./supabase-init.js";

const $ = (s) => document.querySelector(s);
function toast(el, msg, ok=false) { el.textContent = msg || ""; el.style.color = ok ? "#b0ffb0" : "#ffbfbf"; }

(async () => {
  // Ambil profil & email via RPC (patuh RLS)
  const profRes = await supabase.rpc("fn_profile_self");
  if (profRes.error) { alert(profRes.error.message); location.href="index.html"; return; }
  const prof = (Array.isArray(profRes.data) ? profRes.data[0] : profRes.data) || null;
  if (!prof) { location.href="index.html"; return; }

  const auRes = await supabase.rpc("fn_auth_me");
  const authInfo = Array.isArray(auRes.data) ? auRes.data[0] : auRes.data;

  // Header + prefill
  $("#who").textContent   = `${prof.full_name || prof.username || ""} (${prof.role || "-"})`;
  $("#logout").addEventListener("click", () => signOutAndRedirect("index.html"));
  $("#role").value        = prof.role || "";
  $("#email").value       = authInfo?.email || "";
  $("#username").value    = prof.username || "";
  $("#full_name").value   = prof.full_name || "";
  $("#nomor_id").value    = prof.nomor_id || "";
  $("#phone").value       = prof.phone || "";
  $("#address").value     = prof.address || "";
  $("#nik").value         = prof.nik || "";

  // Simpan profil
  $("#formProfile").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("#msgProfile");
    const payload = {
      p_username:  $("#username").value.trim(),
      p_full_name: $("#full_name").value.trim(),
      p_nomor_id:  $("#nomor_id").value.trim(),
      p_phone:     $("#phone").value.trim() || null,
      p_address:   $("#address").value.trim() || null,
      p_nik:       $("#nik").value.trim() || null,
    };
    const { error } = await supabase.rpc("fn_profile_update_self", payload);
    if (error) return toast(msg, error.message, false);
    toast(msg, "Profil tersimpan.", true);
  });

  // Ganti email
  $("#formEmail").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("#msgEmail");
    const newEmail = $("#newEmail").value.trim();
    if (!newEmail) return toast(msg, "Email baru tidak boleh kosong.", false);
    const { error } = await supabase.auth.updateUser({ email: newEmail });
    if (error) return toast(msg, error.message, false);
    toast(msg, "Email diperbarui. Jika perlu verifikasi, cek inbox.", true);
    $("#email").value = newEmail; $("#newEmail").value = "";
  });

  // Ganti password
  $("#formPass").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("#msgPass");
    const newPass = $("#newpass").value;
    if (!newPass) return toast(msg, "Password baru wajib diisi.", false);
    const { error } = await supabase.auth.updateUser({ password: newPass });
    if (error) return toast(msg, error.message, false);
    toast(msg, "Password berhasil diganti.", true);
    $("#newpass").value = "";
  });
})();