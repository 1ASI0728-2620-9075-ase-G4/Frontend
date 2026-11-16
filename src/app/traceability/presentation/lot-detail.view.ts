import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { catchError, distinctUntilChanged, forkJoin, map, of, startWith, Subject, switchMap } from 'rxjs';
import { InventoryApi } from '../../inventory/infrastructure/inventory-api';
import { ProductResponse } from '../../inventory/infrastructure/inventory-response';
import { DeviceResponse, DevicesApi } from '../../monitoring/infrastructure/devices-api';
import { ToastService } from '../../shared/application/toast.service';
import { Evidence, Lot, LotAssignment, traceError } from '../domain/traceability';
import { TraceabilityApi } from '../infrastructure/traceability-api';
import { EvidencePanel } from './evidence.panel';

@Component({
  standalone: true,
  imports: [DatePipe, DecimalPipe, EvidencePanel, FormsModule, RouterLink, TranslateModule],
  templateUrl: './lot-detail.view.html',
  styleUrl: './traceability.css',
})
export class LotDetailView {
  private readonly api = inject(TraceabilityApi);
  private readonly inventory = inject(InventoryApi);
  private readonly devices = inject(DevicesApi);
  private readonly destroy = inject(DestroyRef);
  private readonly toast = inject(ToastService);
  private readonly translate = inject(TranslateService);
  private readonly refreshRequests = new Subject<void>();
  private readonly availabilityRequests = new Subject<Lot>();

  protected readonly lot = signal<Lot | null>(null);
  protected readonly assignments = signal<LotAssignment[]>([]);
  protected readonly evidences = signal<Evidence[]>([]);
  protected readonly selected = signal<string | null>(null);
  protected readonly product = signal<ProductResponse | null>(null);
  protected readonly ownedDevices = signal<DeviceResponse[]>([]);
  protected readonly occupied = signal<Set<string> | null>(null);
  protected readonly loading = signal(true);
  protected readonly checkingDevices = signal(false);
  protected readonly loadError = signal('');
  protected readonly deviceError = signal('');
  protected readonly actionError = signal('');
  protected readonly writing = signal(false);
  protected readonly confirmClose = signal<string | null>(null);
  protected deviceId = '';

  protected readonly active = computed(() => this.assignments().filter(row => row.status === 'ACTIVE'));
  protected readonly history = computed(() => this.assignments().filter(row => row.status === 'CLOSED'));
  protected readonly availableDevices = computed(() => {
    const occupied = this.occupied();
    if (!occupied) return [];
    const active = new Set(this.active().map(row => row.deviceId));
    return this.ownedDevices().filter(device => !occupied.has(device.deviceId) && !active.has(device.deviceId));
  });

  constructor() {
    this.availabilityRequests.pipe(switchMap(lot => {
      this.checkingDevices.set(true);
      this.deviceError.set('');
      this.occupied.set(null);
      const others = this.api.lots().pipe(switchMap(lots => this.api.assignmentsByLot(lots.filter(row => row.id !== lot.id))));
      return forkJoin({ devices: this.devices.list(), others }).pipe(
        map(data => ({ id: lot.id, data, error: '' })),
        catchError(error => of({ id: lot.id, data: null, error: traceError(error) })),
      );
    }), takeUntilDestroyed(this.destroy)).subscribe(result => {
      if (result.id !== this.lot()?.id) return;
      this.checkingDevices.set(false);
      if (!result.data) {
        this.deviceError.set(result.error);
        return;
      }
      this.ownedDevices.set(result.data.devices);
      const rows = [...result.data.others.values()];
      if (rows.some(row => row === null)) {
        this.deviceError.set('traceability.deviceAvailability');
        return;
      }
      this.occupied.set(new Set(rows.flatMap(row => row ?? [])
        .filter(row => row.status === 'ACTIVE').map(row => row.deviceId)));
      if (!this.availableDevices().some(device => device.deviceId === this.deviceId)) this.deviceId = '';
    });

    inject(ActivatedRoute).paramMap.pipe(
      map(params => params.get('lotId') ?? ''),
      distinctUntilChanged(),
      switchMap(id => {
        this.lot.set(null);
        this.selected.set(null);
        this.product.set(null);
        this.assignments.set([]);
        this.evidences.set([]);
        this.confirmClose.set(null);
        this.actionError.set('');
        this.deviceId = '';
        return this.refreshRequests.pipe(startWith(undefined), switchMap(() => {
          this.loading.set(true);
          this.loadError.set('');
          return forkJoin({
            lot: this.api.lot(id),
            assignments: this.api.assignments(id),
            evidences: this.api.evidences(id),
            products: this.inventory.getProducts().pipe(catchError(() => of([]))),
          }).pipe(map(data => ({ data, error: '' })), catchError(error => of({ data: null, error: traceError(error) })));
        }));
      }),
      takeUntilDestroyed(this.destroy),
    ).subscribe(result => {
      this.loading.set(false);
      if (!result.data) {
        this.loadError.set(result.error);
        this.lot.set(null);
        return;
      }
      const { lot, assignments, evidences, products } = result.data;
      this.lot.set(lot);
      this.assignments.set(assignments);
      this.evidences.set(evidences);
      this.product.set(products.find(product => product.id === lot.productId) ?? null);
      if (!evidences.some(e => e.id === this.selected())) {
        this.selected.set(evidences.find(e => e.id === lot.initialEvidenceId)?.id ?? evidences[0]?.id ?? null);
      }
      this.availabilityRequests.next(lot);
    });
  }

  protected refresh(): void { this.refreshRequests.next(); }

  protected deviceName(id: string): string | undefined {
    return this.ownedDevices().find(device => device.deviceId === id)?.name;
  }

  protected assign(): void {
    const lot = this.lot();
    if (!lot || this.writing() || !this.availableDevices().some(device => device.deviceId === this.deviceId)) return;
    this.writing.set(true);
    this.actionError.set('');
    this.api.assign(lot.id, this.deviceId).pipe(takeUntilDestroyed(this.destroy)).subscribe({
      next: row => {
        this.writing.set(false);
        if (this.lot()?.id !== lot.id) return;
        this.assignments.update(rows => [...rows, row]);
        this.deviceId = '';
        this.toast.success(this.translate.instant('traceability.assigned'));
        this.availabilityRequests.next(lot);
      },
      error: error => this.assignmentError(lot, error),
    });
  }

  protected close(row: LotAssignment): void {
    const lot = this.lot();
    if (!lot || this.writing() || this.confirmClose() !== row.id || row.status !== 'ACTIVE') return;
    this.writing.set(true);
    this.actionError.set('');
    this.api.close(lot.id, row.id).pipe(takeUntilDestroyed(this.destroy)).subscribe({
      next: closed => {
        this.writing.set(false);
        if (this.lot()?.id !== lot.id) return;
        this.assignments.update(rows => rows.map(assignment => assignment.id === closed.id ? closed : assignment));
        this.confirmClose.set(null);
        this.toast.success(this.translate.instant('traceability.closed'));
        this.availabilityRequests.next(lot);
      },
      error: error => this.assignmentError(lot, error),
    });
  }

  private assignmentError(lot: Lot, error: unknown): void {
    this.writing.set(false);
    if (this.lot()?.id !== lot.id) return;
    this.actionError.set(traceError(error));
    this.confirmClose.set(null);
    this.refresh();
  }
}
