/** MySQL identifiers escape embedded backticks by doubling; backslashes are literal. */
export function quoteMySqlIdentifier(name: string): string {
  return '`' + name.replace(/`/g, '``') + '`';
}
