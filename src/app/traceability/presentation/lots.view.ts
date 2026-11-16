import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { catchError, forkJoin, map, of, switchMap } from 'rxjs';
import { InventoryApi } from '../../inventory/infrastructure/inventory-api';
import { ProductResponse } from '../../inventory/infrastructure/inventory-response';
import { ToastService } from '../../shared/application/toast.service';
import { Lot, LotAssignment, LotUnit, lotPayload, lotUnits, traceError } from '../domain/traceability';
import { TraceabilityApi } from '../infrastructure/traceability-api';

@Component({
  standalone: true,
  imports: [DatePipe, DecimalPipe, ReactiveFormsModule, RouterLink, TranslateModule],
  templateUrl: './lots.view.html',
  styleUrl: './traceability.css',
})
export class LotsView {
  private readonly api = inject(TraceabilityApi);
  private readonly inventory = inject(InventoryApi);
  private readonly router = inject(Router);
  private readonly destroy = inject(DestroyRef);
  private readonly toast = inject(ToastService);
  private readonly translate = inject(TranslateService);

  protected readonly lots = signal<Lot[]>([]);
  protected readonly products = signal<ProductResponse[] | null>(null);
  protected readonly associations = signal(new Map<string, LotAssignment[] | null>());
  protected readonly loading = signal(false);
  protected readonly loadError = signal('');
  protected readonly formError = signal('');
  protected readonly productError = signal('');
  protected readonly showForm = signal(false);
  protected readonly submitting = signal(false);
  protected readonly units = lotUnits;
  protected readonly form = inject(FormBuilder).nonNullable.group({
    productId: '', code: '', quantity: '', unit: 'UNIT' as LotUnit, receivedAt: '', expiresOn: '',
  });

  constructor() { this.refresh(); }

  protected refresh(): void {
    if (this.loading()) return;
    this.loading.set(true);
    this.loadError.set('');
    this.productError.set('');
    const products = this.inventory.getProducts().pipe(catchError(error => {
      this.productError.set(traceError(error));
      return of(null);
    }));
    const lots = this.api.lots().pipe(switchMap(items => this.api.assignmentsByLot(items).pipe(
      map(associations => ({ items, associations })),
    )));
    forkJoin({ products, lots }).pipe(takeUntilDestroyed(this.destroy)).subscribe({
      next: ({ products, lots }) => {
        this.products.set(products);
        this.lots.set(lots.items);
        this.associations.set(lots.associations);
        this.loading.set(false);
      },
      error: error => {
        this.loadError.set(traceError(error));
        this.loading.set(false);
      },
    });
  }

  protected productName(id: number): string | undefined {
    return this.products()?.find(product => product.id === id)?.name;
  }

  protected active(lot: Lot): LotAssignment[] | null {
    return this.associations().get(lot.id)?.filter(item => item.status === 'ACTIVE') ?? null;
  }

  protected submit(): void {
    if (this.submitting()) return;
    const payload = lotPayload(this.form.getRawValue());
    if (typeof payload === 'string') {
      this.formError.set('traceability.formErrors.' + payload);
      return;
    }
    if (!this.products()?.some(product => product.id === payload.productId)) {
      this.formError.set('traceability.formErrors.product');
      return;
    }
    this.formError.set('');
    this.submitting.set(true);
    this.api.register(payload).pipe(takeUntilDestroyed(this.destroy)).subscribe({
      next: lot => {
        this.submitting.set(false);
        this.toast.success(this.translate.instant('traceability.lotCreated'));
        void this.router.navigate(['/traceability', lot.id]);
      },
      error: error => {
        this.formError.set(traceError(error));
        this.submitting.set(false);
      },
    });
  }
}
