// js/jual-voucher.js — MJ98
// Skeleton aman: wiring UI + placeholder aksi. Lengkap, tanpa HTML.

'use strict';

(function () {
  // ===== Helpers kecil
  const $ = (sel) => document.querySelector(sel);
  const on = (el, ev, fn) => el && el.addEventListener(ev, fn);
  const show = (el) => el && (el.hidden = false);
  const hide = (el) => el && (el.hidden = true);

  // ===== Elemen yang dipakai
  const el = {
    // Panel A (owner/admin)
    filterMitra:  $('#filterMitra'),
    filterCabang: $('#filterCabang'),
    filterLink:   $('#filterLink'),

    btnFilterJenis_admin:   $('#btnFilterJenis_admin'),
    btnUploadCodes:         $('#btnUploadCodes'),
    btnEditUpload:          $('#btnEditUpload'),
    btnExportPenjualanLink: $('#btnExportPenjualanLink'),
    btnSuspendLink:         $('#btnSuspendLink'),
    btnExportRiwayatUpload: $('#btnExportRiwayatUpload'),

    // Panel B (link)
    btnExportPenjualan:  $('#btnExportPenjualan'),
    btnFilterJenis_link: $('#btnFilterJenis_link'),
    btnInputPembeli:     $('#btnInputPembeli'),
    btnRefund:           $('#btnRefund'),
    btnCart:             $('#btnCart'),
    cartBadge:           $('#cartBadge'),

    // Dialog Jual
    dlgJual:            $('#dialogJual'),
    tblVoucherList:     $('#tblVoucherList'),
    grandTotal:         $('#grandTotal'),
    btnOpenCartFromDialog: $('#btnOpenCartFromDialog'),
    btnSimpanKeranjang: $('#btnSimpanKeranjang'),
    btnJual:            $('#btnJual'),
    suspendBanner:      $('#suspendBanner'),

    // Dialog Cart
    dlgCart:    $('#dialogCart'),
    cartList:   $('#cartList'),

    // Dialog Refund
    dlgRefund:      $('#dialogRefund'),
    refundSaleId:   $('#refundSaleId'),
    btnRefundLast:  $('#btnRefundLast'),
    btnRefundById:  $('#btnRefundById'),

    // Misc
    alertArea: $('#alertArea'),
  };

  // ===== Notifier sederhana
  function flash(msg, type = 'info') {
    if (!el.alertArea) return console.log(`[${type}]`, msg);
    const div = document.createElement('div');
    div.className = `alert ${type}`;
    div.textContent = msg;
    el.alertArea.appendChild(div);
    setTimeout(() => div.remove(), 3500);
  }

  // ===== Enable/disable dropdown hirarki
  on(el.filterMitra, 'change', () => {
    const has = !!el.filterMitra.value;
    el.filterCabang.disabled = !has;
    if (!has) {
      el.filterCabang.value = '';
      el.filterLink.value = '';
      el.filterLink.disabled = true;
    }
  });

  on(el.filterCabang, 'change', () => {
    const has = !!el.filterCabang.value;
    el.filterLink.disabled = !has;
    if (!has) el.filterLink.value = '';
  });

  // ====== Tombol Panel A
  on(el.btnFilterJenis_admin, 'click', () => {
    show(el.dlgJual);
    flash('Buka dialog pilih jenis voucher (Admin).');
  });

  on(el.btnUploadCodes, 'click', () => {
    flash('Upload kode voucher: buka dialog/form upload.', 'info');
    // TODO: buka dialog upload
  });

  on(el.btnEditUpload, 'click', () => {
    flash('Edit upload voucher: buka dialog edit.', 'info');
  });

  on(el.btnExportPenjualanLink, 'click', () => {
    flash('Mengekspor penjualan per-link (Excel)…', 'success');
    // TODO: implement export
  });

  on(el.btnSuspendLink, 'click', (e) => {
    const pressed = e.currentTarget.getAttribute('aria-pressed') === 'true';
    const next = !pressed;
    e.currentTarget.setAttribute('aria-pressed', String(next));
    e.currentTarget.textContent = next ? 'NON (aktif)' : 'NON';
    if (next) show(el.suspendBanner); else hide(el.suspendBanner);
  });

  on(el.btnExportRiwayatUpload, 'click', () => {
    flash('Mengekspor riwayat tambah kode voucher (Excel)…', 'success');
    // TODO: implement export
  });

  // ====== Tombol Panel B
  on(el.btnExportPenjualan, 'click', () => {
    flash('Mengekspor penjualan (Excel)…', 'success');
  });

  on(el.btnFilterJenis_link, 'click', () => {
    show(el.dlgJual);
    flash('Buka dialog pilih jenis voucher (Link).');
  });

  on(el.btnInputPembeli, 'click', () => {
    flash('Buka form pengisian data pembeli.', 'info');
  });

  on(el.btnRefund, 'click', () => {
    show(el.dlgRefund);
  });

  on(el.btnCart, 'click', () => {
    show(el.dlgCart);
  });

  // ====== Dialog jual
  on(el.btnOpenCartFromDialog, 'click', () => {
    show(el.dlgCart);
  });

  on(el.btnSimpanKeranjang, 'click', () => {
    // contoh badge naik
    let n = Number(el.cartBadge?.textContent || '0');
    n += 1;
    if (el.cartBadge) {
      el.cartBadge.textContent = String(n);
      el.cartBadge.hidden = n <= 0;
    }
    flash('Disimpan ke keranjang.');
  });

  on(el.btnJual, 'click', () => {
    flash('Proses JUAL… (validasi stok & simpan transaksi).', 'success');
    // TODO: implement jual
  });

  // ====== Close dialog dengan atribut [data-close-dialog]
  document.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-close-dialog]');
    if (!btn) return;
    const card = btn.closest('.modal');
    if (card) card.hidden = true;
  });

  // ====== Inisialisasi awal
  document.addEventListener('DOMContentLoaded', () => {
    // Pastikan badge keranjang konsisten
    if (el.cartBadge) el.cartBadge.hidden = !Number(el.cartBadge.textContent || '0');

    // (Opsional) isi dropdown awal
    // NOTE: ganti dengan fetch ke backend/supabase kalau perlu
    if (el.filterMitra && !el.filterMitra.options.length > 1) {
      // contoh dummy agar UI terlihat hidup
      ['mitra_demo', 'mitra_baru'].forEach(v => {
        const o = document.createElement('option'); o.value = v; o.textContent = v;
        el.filterMitra.appendChild(o);
      });
    }
  });
})();
