/* js/kpi-helper.js — shared metrics untuk Dashboard, Laporan, Setoran (DATA-ONLY)
   Semua angka diambil dari: sales, deposits, stok. Scope mengikuti role user.

   ⚠️ Konsistensi tanggal setoran:
   - Default: gunakan CREATED_AT (sesuai setoran.js & laporan.js terbaru)
   - Alternatif: 'tanggal_setor_first' → pakai tanggal_setor bila ada, fallback created_at
*/

import { supabase } from './supabase-init.js';

/* =========================
   Konfigurasi tanggal setoran
   ========================= */
export const DEPOSIT_DATE_MODE = 'created_at'; // 'created_at' | 'tanggal_setor_first'
let _depositDateMode = DEPOSIT_DATE_MODE;

export function setDepositDateMode(mode){
  if (mode === 'created_at' || mode === 'tanggal_setor_first') {
    _depositDateMode = mode;
  }
}

/* =========================
   Scope util
   ========================= */
export function scopeOf(me) {
  const r = String(me?.role || '').toLowerCase();
  if (r === 'owner' || r === 'admin') return { col: 'owner_id',       val: (me.owner_id || me.id) };
  if (['mitra-cabang','mitracabang'].includes(r)) return { col: 'mitracabang_id', val: me.id };
  if (r === 'cabang') return { col: 'cabang_id',  val: me.id };
  if (r === 'link')   return { col: 'link_id',    val: me.id };
  return { col: null, val: null };
}

/* =========================
   LOW-LEVEL FETCHERS
   ========================= */
export async function fetchSales({ ownerId, scope, fromISO, toISO }) {
  let q = supabase.from('sales').select(
    'qty,total_jual,total_pokok,pendapatan_link,pendapatan_cabang,pendapatan_mitracabang,owner_id,mitracabang_id,cabang_id,link_id,created_at'
  ).eq('owner_id', ownerId);

  if (scope?.col && scope?.val) q = q.eq(scope.col, scope.val);
  if (fromISO) q = q.gte('created_at', fromISO);
  if (toISO)   q = q.lt ('created_at', toISO); // eksklusif
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function fetchDeposits({ ownerId, scope, linkIds = null }) {
  let q = supabase.from('deposits').select(
    'amount,tanggal_setor,created_at,owner_id,mitracabang_id,cabang_id,link_id'
  ).eq('owner_id', ownerId);

  if (Array.isArray(linkIds) && linkIds.length){
    q = q.in('link_id', linkIds);
  } else if (scope?.col && scope?.val) {
    q = q.eq(scope.col, scope.val);
  }

  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

/* Cepat ambil stok agregat per link (dipakai untuk kartu stok) */
export async function fetchStokLinkOnly({ ownerId, scope, linkIds = null }) {
  if (Array.isArray(linkIds) && linkIds.length) {
    const { data, error } = await supabase.from('stok')
      .select('jumlah, owner_id, link_id')
      .eq('owner_id', ownerId)
      .in('link_id', linkIds);
    if (error) throw error;
    return data || [];
  }

  // Kumpulkan id link dalam scope
  let qp = supabase.from('profiles').select('id').eq('owner_id', ownerId).eq('role','link');
  if (scope?.col === 'mitracabang_id') qp = qp.eq('mitracabang_id', scope.val);
  if (scope?.col === 'cabang_id')      qp = qp.eq('cabang_id', scope.val);
  if (scope?.col === 'link_id')        qp = qp.eq('id', scope.val);

  const { data: links, error: lErr } = await qp;
  if (lErr) throw lErr;
  const ids = (links || []).map(x => x.id);
  if (!ids.length) return [];

  const { data, error } = await supabase.from('stok')
    .select('jumlah, owner_id, link_id')
    .eq('owner_id', ownerId)
    .in('link_id', ids);
  if (error) throw error;
  return data || [];
}

/* =========================
   HELPERS PERHITUNGAN
   ========================= */
export function sum(arr, pick) { let x = 0; for (const r of (arr || [])) x += Number(pick(r) || 0); return x; }
export const sumQty = (rows) => sum(rows, r => r?.qty);

function pickDepositTimestamp(row, mode){
  if (mode === 'tanggal_setor_first'){
    return row?.tanggal_setor || row?.created_at;
  }
  // default & fallback:
  return row?.created_at;
}

/** Jumlahkan setoran di periode sesuai mode tanggal yang disepakati. */
export function sumDepositsInRange(depRows, { fromISO, toISO, mode = _depositDateMode }) {
  const lo = fromISO ? new Date(fromISO).getTime() : -Infinity;
  const hi = toISO   ? new Date(toISO).getTime()   :  Infinity;

  const rows = (depRows || []).filter(r => {
    const raw = pickDepositTimestamp(r, mode);
    const t = raw ? new Date(raw).getTime() : 0;
    return t >= lo && t < hi;
  });
  return rows.reduce((a,r)=> a + Number(r?.amount || 0), 0);
}

export function calcOwnerRevenueFromSales(salesRows) {
  // pendapatan_owner = total_jual − (pendapatan_link + pendapatan_cabang + pendapatan_mitracabang)
  return (salesRows || []).reduce((acc, r) => {
    const tj = Number(r?.total_jual || 0);
    const pl = Number(r?.pendapatan_link || 0);
    const pc = Number(r?.pendapatan_cabang || 0);
    const pm = Number(r?.pendapatan_mitracabang || 0);
    return acc + (tj - (pl + pc + pm));
  }, 0);
}

export function calcTagihanFromSales(salesRows) {
  // Tagihan = Σ(total_jual − pendapatan_link)
  return (salesRows || []).reduce((acc, r) =>
    acc + (Number(r?.total_jual || 0) - Number(r?.pendapatan_link || 0)), 0);
}

/* =========================
   HIGH-LEVEL AGGREGATOR (untuk kartu ringkasan global)
   ========================= */
export async function loadAllMetrics({
  ownerId,
  me,
  fromISO,
  toISO,
  depositDateMode = _depositDateMode, // opsional override per-pemanggil
}) {
  const scope = scopeOf(me);

  const [sales, deposits, stok] = await Promise.all([
    fetchSales({ ownerId, scope, fromISO, toISO }),
    fetchDeposits({ ownerId, scope }),
    fetchStokLinkOnly({ ownerId, scope })
  ]);

  const totalVoucherAda     = sum(stok, r => r?.jumlah);
  const totalVoucherTerjual = sumQty(sales);
  const totalTagihan        = calcTagihanFromSales(sales);
  const totalSetoran        = sumDepositsInRange(deposits, { fromISO, toISO, mode: depositDateMode });
  const sisaSetoran         = Math.max(0, totalTagihan - totalSetoran); // clamp biar konsisten dengan UI

  const r = String(me?.role || '').toLowerCase();
  let pendapatan = 0;
  if (r === 'owner' || r === 'admin') {
    pendapatan = calcOwnerRevenueFromSales(sales);
  } else if (['mitra-cabang','mitracabang'].includes(r)) {
    pendapatan = sum(sales, s => s?.pendapatan_mitracabang);
  } else if (r === 'cabang') {
    pendapatan = sum(sales, s => s?.pendapatan_cabang);
  } else if (r === 'link') {
    pendapatan = sum(sales, s => s?.pendapatan_link);
  }

  return {
    totalVoucherAda,
    totalVoucherTerjual,
    totalTagihan,
    totalSetoran,
    sisaSetoran,
    pendapatan,
    sales, deposits, stok
  };
}

/* =========================
   RPC HELPERS (per-cabang / per-mitra)
   ========================= */

/**
 * Ambil total setoran per grup (mitracabang / cabang / link) pada periode.
 * groupBy: 'mitracabang_id' | 'cabang_id' | 'link_id'
 * mode tanggal mengikuti _depositDateMode (default 'created_at').
 */
export async function computeDepositsByGroups({
  ownerId,
  groupBy = 'cabang_id',
  ids = [],
  fromISO,
  toISO,
  mode = _depositDateMode
}) {
  const allowed = new Set(['mitracabang_id','cabang_id','link_id']);
  if (!allowed.has(groupBy)) throw new Error(`groupBy tidak valid: ${groupBy}`);
  const uniq = Array.from(new Set((ids || []).filter(Boolean)));
  if (!uniq.length) return new Map();

  let q = supabase
    .from('deposits')
    .select('amount, created_at, tanggal_setor, owner_id, mitracabang_id, cabang_id, link_id')
    .eq('owner_id', ownerId)
    .in(groupBy, uniq);

  // Untuk mode default (created_at), filter di SQL agar hemat bandwidth.
  if (mode === 'created_at') {
    if (fromISO) q = q.gte('created_at', fromISO);
    if (toISO)   q = q.lt ('created_at', toISO); // eksklusif
  }

  const { data, error } = await q;
  if (error) throw error;

  const lo = fromISO ? new Date(fromISO).getTime() : -Infinity;
  const hi = toISO   ? new Date(toISO).getTime()   :  Infinity;

  const totals = new Map(); // id -> total amount
  (data || []).forEach(row => {
    // Filter waktu di sisi JS untuk mendukung 'tanggal_setor_first'
    const rawTs = pickDepositTimestamp(row, mode);
    const t = rawTs ? new Date(rawTs).getTime() : 0;
    if (t < lo || t >= hi) return;

    const key = row?.[groupBy];
    if (!key) return;
    const amt = Number(row?.amount || 0);
    totals.set(key, (totals.get(key) || 0) + amt);
  });

  // Pastikan setiap id ada entry (meski 0)
  uniq.forEach(id => { if (!totals.has(id)) totals.set(id, 0); });

  return totals;
}

/**
 * Override kolom total_setoran & sisa_setoran pada rows hasil RPC
 * agar konsisten dengan aturan deposits.amount + tanggal created_at.
 * kind: 'mitra' | 'cabang'  (menentukan key mana yang dipakai dari rows)
 */
export async function overrideRpcRowsWithDepositTotals({
  rows,
  kind,
  ownerId,
  fromISO,
  toISO,
  mode = _depositDateMode
}) {
  const groupBy = (kind === 'mitra') ? 'mitracabang_id' : 'cabang_id';
  const ids = Array.from(
    new Set((rows || []).map(r => r?.[groupBy]).filter(Boolean))
  );

  if (!ids.length || !Array.isArray(rows) || !rows.length) return rows || [];

  const totals = await computeDepositsByGroups({
    ownerId, groupBy, ids, fromISO, toISO, mode
  });

  (rows || []).forEach(r => {
    const key = r?.[groupBy];
    const dep = totals.get(key) || 0;
    const tag = Number(r?.total_tagihan || 0);
    r.total_setoran = dep;
    r.sisa_setoran  = Math.max(0, tag - dep);
  });

  return rows;
}
