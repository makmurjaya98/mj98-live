/* js/kpi-helper.js — shared metrics untuk Dashboard & Laporan (DATA-ONLY)
   Semua angka diambil dari sales, deposits, stok. Scope mengikuti role user. */

import { supabase } from './supabase-init.js';

/* ---------- Scope util ---------- */
export function scopeOf(me) {
  const r = String(me?.role || '').toLowerCase();
  if (r === 'owner' || r === 'admin') return { col: 'owner_id',       val: (me.owner_id || me.id) };
  if (['mitra-cabang','mitracabang'].includes(r)) return { col: 'mitracabang_id', val: me.id };
  if (r === 'cabang') return { col: 'cabang_id',  val: me.id };
  if (r === 'link')   return { col: 'link_id',    val: me.id };
  return { col: null, val: null };
}

/* ---------- LOW-LEVEL FETCHERS ---------- */
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

export async function fetchDeposits({ ownerId, scope }) {
  let q = supabase.from('deposits').select(
    'amount,tanggal_setor,created_at,owner_id,mitracabang_id,cabang_id,link_id'
  ).eq('owner_id', ownerId);
  if (scope?.col && scope?.val) q = q.eq(scope.col, scope.val);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function fetchStokLinkOnly({ ownerId, scope, linkIds = null }) {
  if (Array.isArray(linkIds) && linkIds.length) {
    const { data, error } = await supabase.from('stok')
      .select('jumlah, owner_id, link_id')
      .eq('owner_id', ownerId)
      .in('link_id', linkIds);
    if (error) throw error;
    return data || [];
  }

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

/* ---------- HELPERS PERHITUNGAN ---------- */
export function sum(arr, pick) { let x = 0; for (const r of (arr || [])) x += Number(pick(r) || 0); return x; }
export const sumQty = (rows) => sum(rows, r => r?.qty);

export function sumDepositsInRange(depRows, { fromISO, toISO }) {
  const lo = fromISO ? new Date(fromISO).getTime() : -Infinity;
  const hi = toISO   ? new Date(toISO).getTime()   :  Infinity;
  const rows = (depRows || []).filter(r => {
    const raw = (r && r.tanggal_setor) ? r.tanggal_setor : r?.created_at;
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

/* ---------- HIGH-LEVEL AGGREGATOR ---------- */
export async function loadAllMetrics({ ownerId, me, fromISO, toISO }) {
  const scope = scopeOf(me);

  const [sales, deposits, stok] = await Promise.all([
    fetchSales({ ownerId, scope, fromISO, toISO }),
    fetchDeposits({ ownerId, scope }),
    fetchStokLinkOnly({ ownerId, scope })
  ]);

  const totalVoucherAda     = sum(stok, r => r?.jumlah);
  const totalVoucherTerjual = sumQty(sales);
  const totalTagihan        = calcTagihanFromSales(sales);
  const totalSetoran        = sumDepositsInRange(deposits, { fromISO, toISO });
  const sisaSetoran         = totalTagihan - totalSetoran;

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
