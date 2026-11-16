import { Routes } from '@angular/router';

export const TRACEABILITY_ROUTES: Routes = [
  { path: '', pathMatch: 'full', loadComponent: () => import('./lots.view').then(m => m.LotsView) },
  { path: ':lotId', loadComponent: () => import('./lot-detail.view').then(m => m.LotDetailView) },
];
