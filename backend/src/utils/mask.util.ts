/** "Ravi Kumar" -> "Ra** Ku***": enough for an employer to match, useless for scraping. */
export function maskName(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((part) => (part.length <= 2 ? part[0] + '*' : part.slice(0, 2) + '*'.repeat(part.length - 2)))
    .join(' ');
}

/** "+919876543210" -> "+91******3210" */
export function maskPhone(phone: string): string {
  if (phone.length <= 4) return '****';
  return phone.slice(0, 3) + '*'.repeat(Math.max(phone.length - 7, 0)) + phone.slice(-4);
}
