export const $ = (s) => document.querySelector(s);
export const $$ = (s) => Array.from(document.querySelectorAll(s));
export const toID = (n) => (Number(n||0)).toLocaleString('id-ID');
export const toRp = (n) => 'Rp '+(Number(n||0)).toLocaleString('id-ID');