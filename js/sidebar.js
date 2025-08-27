// js/sidebar.js — MJ98
// Sidebar konsisten untuk semua halaman + tandai item aktif + logo center.

'use strict';

// ====== KONFIGURASI ======
const LOGO_SRC = 'assets/gold.png';       // lokasi logo sidebar
const LOGO_ALT = 'MJ98';

// Daftar menu lengkap (urut seperti di desain)
const ITEMS = [
  { href: 'dashboard.html',     label: 'Dashboard' },
  { href: 'jual-voucher.html',  label: 'Jual Voucher' },
  { href: 'kartu-tagihan.html', label: 'Kartu Tagihan' },
  { href: 'laporan.html',       label: 'Laporan' },
  { href: 'setoran.html',       label: 'Setoran' },
  { href: 'stok.html',          label: 'Stok' },
  { href: 'voucher.html',       label: 'Voucher' },
  { href: 'daftar-user.html',   label: 'Daftar User' },
  { href: 'pengumuman.html',    label: 'Pengumuman' },
  { href: 'pengaturan.html',    label: 'Pengaturan' },
];

// ====== UTIL ======
function currentFile() {
  // Ambil nama file tanpa path & tanpa query/hash
  const p = (location.pathname.split('/').pop() || '').toLowerCase();
  return (p || 'index.html').split('?')[0].split('#')[0];
}

// Suntik CSS ringan agar tampilan sidebar seragam di semua halaman
function injectBaseStyles() {
  if (document.getElementById('sidebar-runtime-css')) return;
  const css = `
    /* CSS runtime sidebar (aman & minimal) */
    .sidebar { position: sticky; top: 0; }
    .sidebar .brand-left{
      display:flex; align-items:center; justify-content:center;
      padding: 14px 8px 10px;
    }
    .sidebar .brand-left .logo{
      height: 42px; max-width: 80%;
      object-fit: contain; display: block;
    }
    .sidebar .menu{
      display:flex; flex-direction:column; gap:10px;
      padding: 4px 8px 16px;
    }
    .sidebar .menu .btn{ display:block; width:100%; text-align:left; }
    .sidebar .menu .btn.active{
      filter: brightness(1.06);
      border: 2px solid rgba(255,255,255,.6);
    }
  `;
  const tag = document.createElement('style');
  tag.id = 'sidebar-runtime-css';
  tag.textContent = css;
  document.head.appendChild(tag);
}

// Pastikan struktur dasar sidebar ada; buat bila belum ada
function ensureStructure() {
  const root = document.querySelector('.layout') || document.body;

  let aside = root.querySelector('aside.sidebar');
  if (!aside) {
    aside = document.createElement('aside');
    aside.className = 'sidebar';
    root.prepend(aside);
  }

  let brand = aside.querySelector('.brand-left');
  if (!brand) {
    brand = document.createElement('div');
    brand.className = 'brand-left';
    aside.prepend(brand);
  }

  let logo = brand.querySelector('img.logo') || brand.querySelector('img');
  if (!logo) {
    logo = document.createElement('img');
    brand.appendChild(logo);
  }
  logo.className = 'logo';
  logo.alt = LOGO_ALT;
  logo.loading = 'lazy';
  if (!logo.getAttribute('src')) logo.src = LOGO_SRC;

  let nav = aside.querySelector('nav.menu');
  if (!nav) {
    nav = document.createElement('nav');
    nav.className = 'menu';
    nav.setAttribute('aria-label', 'Menu utama');
    aside.appendChild(nav);
  }
  return nav;
}

// ====== RENDER ======
export function renderSidebar(opts = {}) {
  injectBaseStyles();
  const nav = ensureStructure();

  const override = (opts.active || '').toString().toLowerCase();
  const current = currentFile();

  nav.innerHTML = ITEMS.map(i => {
    const isActive = override
      ? (override === i.label.toLowerCase() || override === i.href.toLowerCase())
      : (current === i.href.toLowerCase());
    const cls = 'btn' + (isActive ? ' active' : '');
    const aria = isActive ? ' aria-current="page"' : '';
    return `<a class="${cls}" href="${i.href}"${aria}>${i.label}</a>`;
  }).join('');
}

// Back-compat alias (dipakai beberapa halaman)
export function ensureSidebar() { renderSidebar(); }

// Auto render saat DOM siap
document.addEventListener('DOMContentLoaded', () => {
  renderSidebar();
});
