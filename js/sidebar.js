// js/sidebar.js — MJ98
// Pastikan semua halaman punya sidebar yang sama & aktifkan item yg sedang dibuka.

'use strict';

const ITEMS = [
  { href: 'dashboard.html',  label: 'Dashboard' },
  { href: 'laporan.html',    label: 'Laporan' },
  { href: 'setoran.html',    label: 'Setoran' },
  { href: 'stok.html',       label: 'Stok' },
  { href: 'voucher.html',    label: 'Voucher' },
  { href: 'pengumuman.html', label: 'Pengumuman' },
  { href: 'pengaturan.html', label: 'Pengaturan' },
];

function activeStyle(href) {
  const current = location.pathname.split('/').pop().toLowerCase();
  return current === href.toLowerCase()
    ? 'style="filter:brightness(1.06); border:2px solid rgba(255,255,255,.6)"'
    : '';
}

function ensureAsideExists() {
  const layout = document.querySelector('.layout');
  if (!layout) return null;

  let aside = document.querySelector('.sidebar');
  if (!aside) {
    aside = document.createElement('aside');
    aside.className = 'sidebar';
    aside.innerHTML = `
      <img class="logo" alt="MJ98"/>
      <nav class="menu"></nav>
    `;
    layout.prepend(aside);
  } else if (!aside.querySelector('.menu')) {
    const nav = document.createElement('nav');
    nav.className = 'menu';
    aside.appendChild(nav);
  }
  return aside;
}

export function ensureSidebar() {
  const aside = ensureAsideExists();
  if (!aside) return;

  const nav = aside.querySelector('.menu');
  // (Re)render semua item agar konsisten di setiap halaman
  nav.innerHTML = ITEMS.map(i => `<a class="btn" href="${i.href}" ${activeStyle(i.href)}>${i.label}</a>`).join('');
}
