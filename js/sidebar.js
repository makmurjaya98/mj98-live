// js/sidebar.js — MJ98
// Sidebar konsisten + tandai item aktif + cegah render ganda + stabilkan logo.

'use strict';

// ========= KONFIG =========
const LOGO_SRC = 'assets/gold.png';
const LOGO_ALT = 'MJ98';

// Urutan menu sesuai desain
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

// ========= UTIL =========
function currentFile() {
  const p = (location.pathname.split('/').pop() || '').toLowerCase();
  return (p || 'index.html').split('?')[0].split('#')[0];
}

function injectBaseStyles() {
  if (document.getElementById('sidebar-runtime-css')) return;
  const css = `
  /* ==== Sidebar runtime (aman & minimal) ==== */
  .sidebar{ position:sticky; top:0; align-self:flex-start; }
  .sidebar .brand-left{
    display:flex; align-items:center; justify-content:center;
    padding:14px 8px 10px; min-height:56px;
  }
  .sidebar .brand-left img{
    height:36px; width:auto; display:block; object-fit:contain;
  }
  .sidebar .menu{ display:grid; gap:10px; padding:10px; }
  .sidebar .menu .btn.active{ filter:brightness(1.06); border:2px solid rgba(255,255,255,.6) }
  `;
  const tag = document.createElement('style');
  tag.id = 'sidebar-runtime-css';
  tag.textContent = css;
  document.head.appendChild(tag);
}

// ========= CORE =========
function ensureStructure() {
  const root = document.querySelector('.layout') || document.body;

  // <aside.sidebar>
  let aside = document.querySelector('aside.sidebar');
  if (!aside) {
    aside = document.createElement('aside');
    aside.className = 'sidebar';
    root.prepend(aside);
  }

  // .brand-left + <img>
  let brand = aside.querySelector('.brand-left');
  if (!brand) {
    brand = document.createElement('div');
    brand.className = 'brand-left';
    aside.prepend(brand);
  }
  let logo = brand.querySelector('img');
  if (!logo) {
    logo = document.createElement('img');
    brand.appendChild(logo);
  }
  // Stabilkan: selalu set src/alt + eager untuk mencegah "kedip"
  logo.src = LOGO_SRC;
  logo.alt = LOGO_ALT;
  logo.loading = 'eager';
  logo.decoding = 'async';

  // <nav.menu>
  let nav = aside.querySelector('nav.menu');
  if (!nav) {
    nav = document.createElement('nav');
    nav.className = 'menu';
    nav.setAttribute('aria-label', 'Menu utama');
    aside.appendChild(nav);
  }
  return nav;
}

function buildMenuHTML(activeFile, overrideActive = '') {
  const target = overrideActive.toLowerCase();
  return ITEMS.map(i => {
    const isActive = target
      ? (target === i.label.toLowerCase() || target === i.href.toLowerCase())
      : (activeFile === i.href.toLowerCase());
    const cls = 'btn' + (isActive ? ' active' : '');
    const extra = isActive ? ' aria-current="page"' : '';
    return `<a class="${cls}" href="${i.href}"${extra}>${i.label}</a>`;
  }).join('');
}

function renderSidebar(opts = {}) {
  injectBaseStyles();
  const nav = ensureStructure();

  // Idempotent: hindari render berulang dalam satu lifecycle
  if (nav.dataset.rendered === 'true' && !opts.force) return;

  const html = buildMenuHTML(currentFile(), (opts.active || '').toString());
  nav.innerHTML = html;
  nav.dataset.rendered = 'true';

  // Penjaga: jika ada skrip lain yang menimpa/menghapus item (mis. “Jual Voucher”),
  // kita pulihkan lagi sekali (tanpa loop).
  if (!nav.dataset.guard) {
    nav.dataset.guard = '1';
    const mo = new MutationObserver(() => {
      const hasJual = !!nav.querySelector('a[href="jual-voucher.html"]');
      const countOk = nav.querySelectorAll('a').length === ITEMS.length;
      if (!hasJual || !countOk) {
        nav.innerHTML = buildMenuHTML(currentFile());
        nav.dataset.rendered = 'true';
      }
    });
    mo.observe(nav, { childList: true, subtree: false });
  }
}

// Back-compat API
export function ensureSidebar() { renderSidebar(); }
export { renderSidebar };

// Auto-render ketika DOM siap (sekali saja)
document.addEventListener('DOMContentLoaded', () => renderSidebar());
