// The egress hint tells a hosted customer which source IPs to allow through
// their database firewall. Two pure pieces: parsing the deployment's env value,
// and deciding which engines the hint is even meaningful for.
import { describe, it, expect } from 'vitest';
import { parseEgressIps, connectionTypeNeedsEgressHint } from '../egress-hint';

describe('parseEgressIps', () => {
  it('is empty when unset — an unset value is how self-hosted installs opt out', () => {
    expect(parseEgressIps(undefined)).toEqual([]);
    expect(parseEgressIps('')).toEqual([]);
    expect(parseEgressIps('   ')).toEqual([]);
  });

  it('parses one or many, tolerating spacing and trailing separators', () => {
    expect(parseEgressIps('34.34.220.153')).toEqual(['34.34.220.153']);
    expect(parseEgressIps('34.34.220.153, 35.1.2.3')).toEqual(['34.34.220.153', '35.1.2.3']);
    expect(parseEgressIps(' 34.34.220.153 ,35.1.2.3, ')).toEqual(['34.34.220.153', '35.1.2.3']);
    expect(parseEgressIps('34.34.220.153\n35.1.2.3')).toEqual(['34.34.220.153', '35.1.2.3']);
  });

  it('keeps CIDR and IPv6 forms intact — firewalls accept both', () => {
    expect(parseEgressIps('34.34.220.0/29')).toEqual(['34.34.220.0/29']);
    expect(parseEgressIps('2600:1f18::/64, 34.34.220.153'))
      .toEqual(['2600:1f18::/64', '34.34.220.153']);
  });

  it('de-duplicates so a copy-paste slip does not render the same IP twice', () => {
    expect(parseEgressIps('1.2.3.4, 1.2.3.4')).toEqual(['1.2.3.4']);
  });
});

describe('connectionTypeNeedsEgressHint', () => {
  it('applies to engines reached over the network at host:port', () => {
    expect(connectionTypeNeedsEgressHint('postgresql')).toBe(true);
    expect(connectionTypeNeedsEgressHint('clickhouse')).toBe(true);
  });

  it('does not apply to cloud APIs authenticated by IAM', () => {
    // BigQuery and Athena are reached over public service endpoints and gated by
    // credentials, not by source IP — an allowlist hint points at the wrong lever.
    expect(connectionTypeNeedsEgressHint('bigquery')).toBe(false);
    expect(connectionTypeNeedsEgressHint('athena')).toBe(false);
  });

  it('does not apply to file-backed sources, which make no outbound connection', () => {
    for (const t of ['csv', 'xlsx', 'google-sheets', 'duckdb', 'sqlite', 'internal_db']) {
      expect(connectionTypeNeedsEgressHint(t), `${t} should not prompt an IP hint`).toBe(false);
    }
    expect(connectionTypeNeedsEgressHint(undefined)).toBe(false);
  });
});
