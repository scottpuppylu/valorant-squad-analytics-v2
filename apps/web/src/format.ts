/** Display formatting only (calculation precision stays in the snapshot). */
export const formatRatio = (value: number | null) => (value === null ? '—' : value.toFixed(2));
export const formatAdr = (value: number | null) => (value === null ? '—' : value.toFixed(1));
export const formatInstant = (iso: string | null) => (iso === null ? '—' : `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`);
export const formatDate = (iso: string | null) => (iso === null ? '—' : iso.slice(0, 10));
