import { HttpClient, HttpErrorResponse, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { of, Subject } from 'rxjs';
import { TestScheduler } from 'rxjs/testing';
import { environment } from '../../environments/environment';
import { InventoryApi } from '../inventory/infrastructure/inventory-api';
import { ToastService } from '../shared/application/toast.service';
import { authInterceptor } from '../shared/infrastructure/auth.interceptor';
import { monitorEvidence } from './application/anchoring-monitor';
import { Anchoring, criticalSnapshot, Evidence, isVerified, lotPayload, traceError } from './domain/traceability';
import { TraceabilityApi } from './infrastructure/traceability-api';
import { EvidencePanel } from './presentation/evidence.panel';
import { LotsView } from './presentation/lots.view';

const evidence: Evidence = {
  id: 'evidence-1', lotId: 'lot-1', type: 'CRITICAL_TEMPERATURE', canonicalSnapshot: JSON.stringify({
    domain: 'freshsense.trace.critical-temperature', schemaVersion: 1, eventType: 'CRITICAL_TEMPERATURE',
    evidenceId: 'evidence-1', lotId: 'lot-1', source: 'SIMULATED', readingId: '2', deviceId: 'device-1',
    assignmentId: 'assignment-1', temperatureC: '13.7', rule: 'FS-FRUIT-1', ruleVersion: '1',
    direction: 'ABOVE', thresholdC: '12', measuredAt: '2026-01-01T10:00:00Z', receivedAt: '2026-01-01T10:00:01Z',
  }), sha256: '11'.repeat(32), schemaVersion: 1, source: 'SIMULATED', createdAt: '2026-01-01T10:00:01Z',
};
const anchor: Anchoring = {
  evidenceId: evidence.id, publicationStatus: 'CONFIRMED', blockchainVerification: 'VERIFIED', localMatches: true,
  onChainExists: true, onChainDigestMatches: true, onChainMetadataMatches: true, chainId: 31337,
  transactionHash: '0xfeed', contractAddress: '0xbeef', blockHash: '0x1234', blockNumber: 3, confirmedAt: null,
  attempts: 2, lastError: null, nextAttemptAt: null,
};
const local = { evidenceId: evidence.id, matches: true };
const fields = { productId: '7', code: ' a-b.24 ', quantity: '12,345', receivedAt: '2026-01-01T10:00:00Z',
  expiresOn: '', unit: 'KG' as const };

describe('Traceability models', () => {
  it('validates code, decimal precision, product and UTC expiration before making a request', () => {
    expect(lotPayload(fields)).toEqual({ productId: 7, code: 'A-B.24', initialQuantity: 12.345, unit: 'KG',
      receivedAt: '2026-01-01T10:00:00.000Z', expiresOn: null });
    expect(lotPayload({ ...fields, quantity: '4.0001' })).toBe('quantity');
    expect(lotPayload({ ...fields, quantity: '1000000000000' })).toBe('quantity');
    expect(lotPayload({ ...fields, code: 'a/b' })).toBe('code');
    expect(lotPayload({ ...fields, productId: '' })).toBe('product');
    expect(lotPayload({ ...fields, expiresOn: '2025-12-31' })).toBe('expiresOn');
  });

  it('requires current RPC and local evidence matching, even when publication is historically confirmed', () => {
    expect(isVerified(evidence.id, local, anchor)).toBeTrue();
    expect(isVerified(evidence.id, local, { ...anchor, blockchainVerification: 'RPC_UNAVAILABLE' })).toBeFalse();
    expect(isVerified(evidence.id, { ...local, matches: false }, anchor)).toBeFalse();
    expect(isVerified(evidence.id, local, { ...anchor, onChainMetadataMatches: false })).toBeFalse();
    expect(isVerified('another-id', local, anchor)).toBeFalse();
  });

  it('accepts the critical snapshot only for the expected evidence and reports HTTP errors separately', () => {
    expect(criticalSnapshot(evidence)?.temperatureC).toBe('13.7');
    expect(criticalSnapshot({ ...evidence, lotId: 'another-lot' })).toBeNull();
    expect(criticalSnapshot({ ...evidence, canonicalSnapshot: '{' })).toBeNull();
    expect(traceError(new HttpErrorResponse({ status: 409 }))).toBe('traceability.errors.conflict');
    expect(traceError(new HttpErrorResponse({ status: 0 }))).toBe('traceability.errors.network');
  });
});

describe('TraceabilityApi', () => {
  it('uses the configured backend and scopes the CSRF header to the three writes', () => {
    TestBed.configureTestingModule({ providers: [
      provideZonelessChangeDetection(), provideRouter([]),
      provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting(),
    ] });
    const api = TestBed.inject(TraceabilityApi);
    const http = TestBed.inject(HttpTestingController);
    const base = environment.apiBaseUrl + '/traceability';
    api.register(lotPayload(fields) as Exclude<ReturnType<typeof lotPayload>, string>).subscribe();
    api.assign('lot-1', 'device-1').subscribe();
    api.close('lot-1', 'assignment-1').subscribe();
    const paths = ['/lots', '/lots/lot-1/assignments', '/lots/lot-1/assignments/assignment-1/close'];
    for (const [index, path] of paths.entries()) {
      const request = http.expectOne({ method: 'POST', url: base + path });
      expect(request.request.withCredentials).toBeTrue();
      expect(request.request.headers.get('X-FreshSense-CSRF')).toBe('traceability');
      expect(request.request.headers.has('Authorization')).toBeFalse();
      if (index === 1) expect(request.request.body).toEqual({ deviceId: 'device-1' });
      request.flush({});
    }
    api.verify('evidence-1').subscribe();
    api.anchoring('evidence-1').subscribe();
    for (const method of ['verify', 'anchoring']) {
      const request = http.expectOne({ method: 'GET', url: base + '/evidences/evidence-1/' + method });
      expect(request.request.withCredentials).toBeTrue();
      expect(request.request.headers.has('X-FreshSense-CSRF')).toBeFalse();
      request.flush({});
    }
    http.verify();
  });

  it('marks session operations and other API writes while leaving unrelated origins untouched', () => {
    TestBed.configureTestingModule({ providers: [
      provideZonelessChangeDetection(), provideRouter([]),
      provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting(),
    ] });
    const http = TestBed.inject(HttpClient);
    const testing = TestBed.inject(HttpTestingController);
    for (const [method, path] of [
      ['POST', '/accounts/login'], ['POST', '/accounts/refresh'], ['POST', '/accounts/logout'],
      ['PATCH', '/products/1'], ['POST', '/monitoring'], ['POST', '/recipes/generate-batch'],
    ]) {
      const url = environment.apiBaseUrl + path;
      http.request(method, url, { body: {} }).subscribe();
      const request = testing.expectOne({ method, url });
      expect(request.request.withCredentials).toBeTrue();
      expect(request.request.headers.get('X-FreshSense-CSRF')).toBe('traceability');
      request.flush({});
    }
    for (const url of ['https://foreign.example/api/products', environment.apiBaseUrl + '-other/api/products']) {
      http.post(url, {}).subscribe();
      const request = testing.expectOne(url);
      expect(request.request.withCredentials).toBeFalse();
      expect(request.request.headers.has('X-FreshSense-CSRF')).toBeFalse();
      request.flush({});
    }
    testing.verify();
  });
});

describe('Evidence polling', () => {
  it('waits for each request, then stops after current confirmation', () => {
    const scheduler = new TestScheduler((actual, expected) => expect(actual).toEqual(expected));
    scheduler.run(() => {
      const waiting = new Subject<Anchoring>();
      const api = jasmine.createSpyObj<TraceabilityApi>('TraceabilityApi', ['verify', 'anchoring']);
      const pending: Anchoring = { ...anchor, publicationStatus: 'PENDING', blockchainVerification: 'EVIDENCE_MISSING' };
      api.verify.and.returnValue(of(local));
      api.anchoring.and.returnValues(waiting, of(anchor));
      const status: string[] = [];
      monitorEvidence(api, evidence.id, () => {}, 10, 4).subscribe(result => {
        status.push(result.anchor.value!.publicationStatus);
      });
      scheduler.schedule(() => {
        expect(api.anchoring).toHaveBeenCalledTimes(1);
        waiting.next(pending);
        waiting.complete();
      }, 100);
      scheduler.schedule(() => {
        expect(status).toEqual(['PENDING', 'CONFIRMED']);
        expect(api.anchoring).toHaveBeenCalledTimes(2);
      }, 210);
    });
  });

  it('limits polling during RPC failures and cancels when the view unsubscribes', () => {
    const scheduler = new TestScheduler((actual, expected) => expect(actual).toEqual(expected));
    scheduler.run(() => {
      const api = jasmine.createSpyObj<TraceabilityApi>('TraceabilityApi', ['verify', 'anchoring']);
      api.verify.and.returnValue(of(local));
      api.anchoring.and.returnValue(of({ ...anchor, blockchainVerification: 'RPC_UNAVAILABLE' }));
      monitorEvidence(api, evidence.id, () => {}, 10, 3).subscribe();
      scheduler.schedule(() => {
        expect(api.anchoring).toHaveBeenCalledTimes(3);
        monitorEvidence(api, evidence.id, () => {}, 10, 3).subscribe().unsubscribe();
      }, 100);
      scheduler.schedule(() => expect(api.anchoring).toHaveBeenCalledTimes(4), 200);
    });
  });
});

describe('Traceability views', () => {
  it('blocks an invalid lot form and navigates only after a successful registration response', () => {
    const api = jasmine.createSpyObj<TraceabilityApi>('TraceabilityApi', ['lots', 'assignmentsByLot', 'register']);
    api.lots.and.returnValue(of([]));
    api.assignmentsByLot.and.returnValue(of(new Map()));
    const response = new Subject<import('./domain/traceability').Lot>();
    api.register.and.returnValue(response);
    TestBed.configureTestingModule({ imports: [LotsView], providers: [
      provideZonelessChangeDetection(), provideRouter([]), provideTranslateService(),
      { provide: TraceabilityApi, useValue: api },
      { provide: InventoryApi, useValue: { getProducts: () => of([{ id: 7, name: 'Apples' }]) } },
      { provide: ToastService, useValue: { success: () => {} } },
    ] });
    const navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    const fixture = TestBed.createComponent(LotsView);
    fixture.detectChanges();
    fixture.nativeElement.querySelector('[aria-controls="lot-form"]').click();
    fixture.detectChanges();
    const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
    const set = (name: string, value: string) => {
      const control = form.querySelector<HTMLInputElement>('[formControlName="' + name + '"]')!;
      control.value = value;
      control.dispatchEvent(new Event(control.tagName === 'SELECT' ? 'change' : 'input'));
    };
    set('productId', '7');
    set('code', 'LOT-1');
    set('receivedAt', '2026-01-01T10:00');
    set('quantity', '1.0005');
    form.dispatchEvent(new Event('submit'));
    expect(api.register).not.toHaveBeenCalled();
    set('quantity', '1.205');
    form.dispatchEvent(new Event('submit'));
    expect(api.register).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
    response.next({ id: 'lot-1' } as import('./domain/traceability').Lot);
    expect(navigate).toHaveBeenCalledWith(['/traceability', 'lot-1']);
    response.complete();
  });

  it('renders synthetic incident fields and displays RPC failure independently of recorded confirmation', async () => {
    const api = jasmine.createSpyObj<TraceabilityApi>('TraceabilityApi', ['verify', 'anchoring']);
    api.verify.and.returnValue(of(local));
    api.anchoring.and.returnValue(of({ ...anchor, blockchainVerification: 'RPC_UNAVAILABLE', onChainExists: null }));
    TestBed.configureTestingModule({ imports: [EvidencePanel], providers: [
      provideZonelessChangeDetection(), provideTranslateService(), { provide: TraceabilityApi, useValue: api },
    ] });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', {
      traceability: { publication: { CONFIRMED: 'Confirmation recorded' }, chain: {
        RPC_UNAVAILABLE: 'Blockchain unavailable', VERIFIED: 'Evidence verified',
      } },
    });
    translate.use('en').subscribe();
    const fixture = TestBed.createComponent(EvidencePanel);
    fixture.componentRef.setInput('evidence', evidence);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const panel = fixture.nativeElement.textContent;
    expect(panel).toContain('13.7 °C');
    expect(panel).toContain('Confirmation recorded');
    expect(panel).toContain('Blockchain unavailable');
    expect(panel).not.toContain('Evidence verified');
    fixture.destroy();
    expect(api.anchoring).toHaveBeenCalledTimes(1);
  });
});
