import { DatePipe } from '@angular/common';
import { Component, computed, DestroyRef, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { startWith, Subject, switchMap } from 'rxjs';
import { ToastService } from '../../shared/application/toast.service';
import { EvidenceCheck, monitorEvidence } from '../application/anchoring-monitor';
import { criticalSnapshot, Evidence, isVerified } from '../domain/traceability';
import { TraceabilityApi } from '../infrastructure/traceability-api';

@Component({
  selector: 'fs-evidence-panel',
  standalone: true,
  imports: [DatePipe, TranslateModule],
  templateUrl: './evidence.panel.html',
  styleUrl: './traceability.css',
})
export class EvidencePanel {
  private readonly api = inject(TraceabilityApi);
  private readonly toast = inject(ToastService);
  private readonly translate = inject(TranslateService);
  private readonly refreshRequests = new Subject<void>();
  readonly evidence = input.required<Evidence>();
  protected readonly result = signal<EvidenceCheck | null>(null);
  protected readonly checking = signal(false);
  protected readonly critical = computed(() => criticalSnapshot(this.evidence()));
  protected readonly local = computed(() => this.result()?.local.value ?? null);
  protected readonly anchor = computed(() => this.result()?.anchor.value ?? null);
  protected readonly verified = computed(() => isVerified(this.evidence().id, this.local(), this.anchor()));

  protected readonly chainLabel = computed(() => {
    const state = this.anchor()?.blockchainVerification;
    if (state === 'VERIFIED' && !this.verified()) return 'INCOMPLETE';
    return state ?? 'UNCHECKED';
  });

  constructor() {
    const destroy = inject(DestroyRef);
    toObservable(this.evidence).pipe(
      switchMap(evidence => this.refreshRequests.pipe(startWith(undefined), switchMap(() => {
        this.result.set(null);
        return monitorEvidence(this.api, evidence.id, () => this.checking.set(true));
      }))),
      takeUntilDestroyed(destroy),
    ).subscribe(result => {
      this.result.set(result);
      this.checking.set(false);
    });
  }

  protected refresh(): void { this.refreshRequests.next(); }

  protected async copy(value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      this.toast.success(this.translate.instant('traceability.copied'));
    } catch {
      this.toast.error(this.translate.instant('traceability.copyFailed'));
    }
  }
}
