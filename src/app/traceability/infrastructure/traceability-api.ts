import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, from, map, mergeMap, of, toArray } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Anchoring, Evidence, LocalVerification, Lot, LotAssignment, NewLot } from '../domain/traceability';

const cookie = { withCredentials: true };

@Injectable({ providedIn: 'root' })
export class TraceabilityApi {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl + '/traceability';

  lots() { return this.http.get<Lot[]>(this.base + '/lots', cookie); }
  lot(id: string) { return this.http.get<Lot>(this.lotUrl(id), cookie); }
  register(payload: NewLot) { return this.http.post<Lot>(this.base + '/lots', payload, cookie); }
  assignments(id: string) { return this.http.get<LotAssignment[]>(this.lotUrl(id) + '/assignments', cookie); }
  assign(id: string, deviceId: string) {
    return this.http.post<LotAssignment>(this.lotUrl(id) + '/assignments', { deviceId }, cookie);
  }
  close(id: string, assignmentId: string) {
    return this.http.post<LotAssignment>(this.lotUrl(id) + '/assignments/'
      + encodeURIComponent(assignmentId) + '/close', {}, cookie);
  }
  evidences(id: string) { return this.http.get<Evidence[]>(this.lotUrl(id) + '/evidences', cookie); }
  verify(id: string) { return this.http.get<LocalVerification>(this.evidenceUrl(id) + '/verify', cookie); }
  anchoring(id: string) { return this.http.get<Anchoring>(this.evidenceUrl(id) + '/anchoring', cookie); }

  assignmentsByLot(lots: readonly Lot[]) {
    return from(lots).pipe(
      mergeMap(lot => this.assignments(lot.id).pipe(
        map(rows => [lot.id, rows] as const),
        catchError(() => of([lot.id, null] as const)),
      ), 4),
      toArray(),
      map(entries => new Map(entries)),
    );
  }

  private lotUrl(id: string) { return this.base + '/lots/' + encodeURIComponent(id); }
  private evidenceUrl(id: string) { return this.base + '/evidences/' + encodeURIComponent(id); }
}
