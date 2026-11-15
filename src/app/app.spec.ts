import { Component, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { AppComponent } from './app';
import { LanguageService } from './core/i18n/language.service';

@Component({ template: '<p>Routed content</p>' })
class TestRouteComponent {}

describe('AppComponent', () => {
  it('renders the active route in the root outlet', async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([{ path: 'test-route', component: TestRouteComponent }]),
        { provide: LanguageService, useValue: {} },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    await TestBed.inject(Router).navigateByUrl('/test-route');
    await fixture.whenStable();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('p')?.textContent).toBe('Routed content');
  });
});
