import { HttpErrorResponse } from '@angular/common/http';

export const lotUnits = ['UNIT', 'KG', 'G', 'L', 'ML'] as const;
export type LotUnit = typeof lotUnits[number];

export interface Lot {
  id: string;
  code: string;
  productId: number;
  initialQuantity: number;
  unit: LotUnit;
  receivedAt: string;
  expiresOn: string | null;
  createdAt: string;
  status: 'REGISTERED';
  initialEvidenceId: string;
}

export interface LotAssignment {
  id: string;
  lotId: string;
  deviceId: string;
  startedAt: string;
  endedAt: string | null;
  status: 'ACTIVE' | 'CLOSED';
}

export interface Evidence {
  id: string;
  lotId: string;
  type: 'LOT_REGISTERED' | 'CRITICAL_TEMPERATURE';
  canonicalSnapshot: string;
  sha256: string;
  schemaVersion: number;
  source: 'AUTHENTICATED_USER' | 'AUTHENTICATED_GATEWAY' | 'SIMULATED';
  createdAt: string;
}

export type Publication = 'NOT_QUEUED' | 'PENDING' | 'PREPARED' | 'SUBMITTED' | 'CONFIRMED'
  | 'RETRYABLE_FAILURE' | 'PERMANENT_FAILURE';
export type ChainVerification = 'DISABLED' | 'NO_TARGET' | 'VERIFIED' | 'ON_CHAIN_PRESENT'
  | 'EVIDENCE_MISSING' | 'EVIDENCE_CONFLICT' | 'TRANSACTION_PENDING' | 'TRANSACTION_MISSING'
  | 'RECEIPT_INVALID' | 'RPC_UNAVAILABLE' | 'CHAIN_MISMATCH' | 'CONTRACT_MISSING'
  | 'CONTRACT_INCOMPATIBLE' | 'DEPLOYMENT_MISSING' | 'WRITER_UNAUTHORIZED' | 'TRANSACTION_REVERTED'
  | 'NONCE_CONSUMED' | 'RPC_REJECTED';

export interface LocalVerification { evidenceId: string; matches: boolean; }

export interface Anchoring {
  evidenceId: string;
  publicationStatus: Publication;
  blockchainVerification: ChainVerification;
  localMatches: boolean;
  onChainExists: boolean | null;
  onChainDigestMatches: boolean | null;
  onChainMetadataMatches: boolean | null;
  chainId: number | null;
  contractAddress: string | null;
  transactionHash: string | null;
  blockNumber: number | null;
  blockHash: string | null;
  confirmedAt: string | null;
  attempts: number;
  lastError: ChainVerification | null;
  nextAttemptAt: string | null;
}

export interface NewLot {
  productId: number;
  code: string;
  initialQuantity: number;
  unit: LotUnit;
  receivedAt: string;
  expiresOn: string | null;
}

export interface LotFields {
  productId: string;
  code: string;
  quantity: string;
  unit: LotUnit;
  receivedAt: string;
  expiresOn: string;
}

export function lotPayload(fields: LotFields): NewLot | string {
  const code = fields.code.trim().toUpperCase();
  const quantity = fields.quantity.trim().replace(',', '.');
  const productId = Number(fields.productId);
  if (!Number.isSafeInteger(productId) || productId <= 0) return 'product';
  if (!/^[A-Z0-9][A-Z0-9._-]{0,63}$/.test(code)) return 'code';
  if (!/^\d{1,12}(\.\d{1,3})?$/.test(quantity) || Number(quantity) <= 0) return 'quantity';
  if (!lotUnits.includes(fields.unit)) return 'unit';
  const received = new Date(fields.receivedAt);
  if (!fields.receivedAt || !Number.isFinite(received.getTime())) return 'receivedAt';
  const receivedAt = received.toISOString();
  if (!/^[1-9]\d{3}-/.test(receivedAt)) return 'receivedAt';
  if (fields.expiresOn && (!/^[1-9]\d{3}-\d{2}-\d{2}$/.test(fields.expiresOn)
      || fields.expiresOn < receivedAt.slice(0, 10))) return 'expiresOn';
  return { productId, code, initialQuantity: Number(quantity), unit: fields.unit, receivedAt,
    expiresOn: fields.expiresOn || null };
}

export function traceError(error: unknown): string {
  const status = error instanceof HttpErrorResponse ? error.status : -1;
  const messages: Record<number, string> = {
    0: 'network', 400: 'invalid', 401: 'session', 403: 'forbidden',
    404: 'missing', 409: 'conflict', 429: 'rateLimit',
  };
  return 'traceability.errors.' + (messages[status] ?? 'server');
}

export function isVerified(id: string, local: LocalVerification | null, anchor: Anchoring | null): boolean {
  return local?.evidenceId === id && local.matches === true && anchor?.evidenceId === id
    && anchor.blockchainVerification === 'VERIFIED' && anchor.localMatches === true
    && anchor.onChainExists === true && anchor.onChainDigestMatches === true && anchor.onChainMetadataMatches === true;
}

const criticalFields = ['readingId', 'deviceId', 'assignmentId', 'temperatureC', 'rule',
  'ruleVersion', 'direction', 'thresholdC', 'measuredAt', 'receivedAt'] as const;
type CriticalSnapshot = Record<typeof criticalFields[number], string>;

export function criticalSnapshot(evidence: Evidence): CriticalSnapshot | null {
  if (evidence.type !== 'CRITICAL_TEMPERATURE' || evidence.schemaVersion !== 1) return null;
  try {
    const value: unknown = JSON.parse(evidence.canonicalSnapshot);
    if (!value || typeof value !== 'object') return null;
    const snapshot = value as Record<string, unknown>;
    if (snapshot['domain'] !== 'freshsense.trace.critical-temperature' || snapshot['schemaVersion'] !== 1
        || snapshot['eventType'] !== evidence.type || snapshot['evidenceId'] !== evidence.id
        || snapshot['lotId'] !== evidence.lotId || snapshot['source'] !== evidence.source
        || !criticalFields.every(field => typeof snapshot[field] === 'string')
        || !Number.isFinite(Date.parse(snapshot['measuredAt'] as string))
        || !Number.isFinite(Date.parse(snapshot['receivedAt'] as string))
        || (snapshot['direction'] !== 'ABOVE' && snapshot['direction'] !== 'BELOW')) return null;
    return snapshot as CriticalSnapshot;
  } catch {
    return null;
  }
}
