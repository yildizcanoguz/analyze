// Calendar. Day 0 = 1066-09-15. Julian-ish: 365.25 handled with simple leap rule.
// The game speaks in dates because dates make consequences feel dated.

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTHS_TR = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
const DIM = [31,28,31,30,31,30,31,31,30,31,30,31];

export const EPOCH = { y: 1066, m: 9, d: 15 };

function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
function daysInMonth(y, m) { return m === 2 && isLeap(y) ? 29 : DIM[m - 1]; }

function toAbs(y, m, d) {
  // days since year 0 (proleptic). Cheap and monotonic; only differences matter.
  let n = 0;
  const yy = y - 1;
  n = yy * 365 + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400);
  for (let i = 1; i < m; i++) n += daysInMonth(y, i);
  return n + d;
}
const ABS_EPOCH = toAbs(EPOCH.y, EPOCH.m, EPOCH.d);

export function fromDay(day) {
  let abs = ABS_EPOCH + day;
  let y = Math.floor(abs / 365.2425) + 1;
  while (toAbs(y, 1, 1) > abs) y--;
  while (toAbs(y + 1, 1, 1) <= abs) y++;
  let rem = abs - toAbs(y, 1, 1);
  let m = 1;
  while (rem >= daysInMonth(y, m)) { rem -= daysInMonth(y, m); m++; }
  return { y, m, d: rem + 1 };
}

export function toDay(y, m, d) { return toAbs(y, m, d) - ABS_EPOCH; }

export function fmtDate(day, lang = 'tr') {
  const { y, m, d } = fromDay(day);
  const names = lang === 'tr' ? MONTHS_TR : MONTHS;
  return `${d} ${names[m - 1]} ${y}`;
}
export function fmtShort(day) { const { y, m, d } = fromDay(day); return `${String(d).padStart(2,'0')}.${String(m).padStart(2,'0')}.${y}`; }
export function yearOf(day) { return fromDay(day).y; }
export function seasonOf(day) {
  const m = fromDay(day).m;
  if (m === 12 || m <= 2) return 'winter';
  if (m <= 5) return 'spring';
  if (m <= 8) return 'summer';
  return 'autumn';
}
/** Age in whole years at `day` for someone born on `birthDay`. */
export function ageAt(birthDay, day) {
  const b = fromDay(birthDay), n = fromDay(day);
  let a = n.y - b.y;
  if (n.m < b.m || (n.m === b.m && n.d < b.d)) a--;
  return a;
}
export const YEAR = 365;
export const MONTH = 30;
