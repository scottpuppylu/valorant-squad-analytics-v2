/** Display formatting only (calculation precision stays in the snapshot). */
export const formatRatio = (value: number | null) => (value === null ? '—' : value.toFixed(2));
export const formatAdr = (value: number | null) => (value === null ? '—' : value.toFixed(1));
export const formatScore = (value: number | null | undefined) => (value === null || value === undefined ? '—' : value.toFixed(1));
export const formatInt = (value: number | null | undefined) => (value === null || value === undefined ? '—' : String(Math.round(value)));
export const formatPercent = (value: number | null | undefined, digits = 1) => (value === null || value === undefined ? '—' : `${(100 * value).toFixed(digits)}%`);
export const formatSigned = (value: number | null | undefined) => (value === null || value === undefined ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(1)}`);
export const formatInstant = (iso: string | null) => (iso === null ? '—' : `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`);
export const formatDate = (iso: string | null | undefined) => (iso === null || iso === undefined ? '—' : iso.slice(0, 10));
export const formatPer = (count: number | null | undefined, rounds: number) => (count === null || count === undefined || rounds <= 0 ? '—' : (count / rounds).toFixed(2));
