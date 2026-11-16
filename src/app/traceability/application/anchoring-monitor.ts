import { HttpErrorResponse } from '@angular/common/http';
import { catchError, defer, forkJoin, map, Observable, of, repeat, takeWhile } from 'rxjs';
import { Anchoring, LocalVerification, traceError } from '../domain/traceability';
import { TraceabilityApi } from '../infrastructure/traceability-api';

interface Result<T> { value: T | null; error: string; retry: boolean; }
export interface EvidenceCheck { local: Result<LocalVerification>; anchor: Result<Anchoring>; }

const pending = new Set(['PENDING', 'PREPARED', 'SUBMITTED', 'RETRYABLE_FAILURE']);

export function shouldContinue(check: EvidenceCheck): boolean {
  const anchor = check.anchor.value;
  return check.anchor.retry || check.local.retry || (anchor !== null && (
    pending.has(anchor.publicationStatus) && anchor.blockchainVerification !== 'DISABLED'
    || anchor.blockchainVerification === 'RPC_UNAVAILABLE'
    || anchor.blockchainVerification === 'TRANSACTION_PENDING'
  ));
}

export function monitorEvidence(
  api: TraceabilityApi, id: string, checking: () => void, intervalMs = 5000, limit = 12,
): Observable<EvidenceCheck> {
  return defer(() => {
    checking();
    return forkJoin({ local: request(api.verify(id)), anchor: request(api.anchoring(id)) });
  }).pipe(repeat({ count: limit, delay: intervalMs }), takeWhile(shouldContinue, true));
}

function request<T>(source: Observable<T>): Observable<Result<T>> {
  return source.pipe(
    map(value => ({ value, error: '', retry: false })),
    catchError(error => of({
      value: null,
      error: traceError(error),
      retry: error instanceof HttpErrorResponse && (error.status === 0 || error.status >= 500),
    })),
  );
}
