// js/env.js — runtime config untuk Supabase (client-side)
(function () {
  'use strict';

  // GANTI dengan nilai proyek kamu (anon key aman untuk publik)
  var URL  = "https://mguxpcbskqxnbpbuhdjj.supabase.co";
  var ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1ndXhwY2Jza3F4bmJwYnVoZGpqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTMyMzU1MDEsImV4cCI6MjA2ODgxMTUwMX0.MujhdOQF_aSUWX7XJkQ0ybMNtTPsO-FZggg4DYSHFYY";

  var w = (typeof globalThis !== 'undefined' ? globalThis : window);

  // Objek ENV utama
  w.__ENV = w.__ENV || {};
  w.__ENV.SUPABASE_URL = URL;
  w.__ENV.SUPABASE_ANON_KEY = ANON;

  // Back-compat: jika ada kode yang membaca VITE_*
  w.VITE_SUPABASE_URL = URL;
  w.VITE_SUPABASE_ANON_KEY = ANON;
})();
