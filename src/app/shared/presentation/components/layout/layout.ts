import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { LanguageService } from '../../../../core/i18n/language.service';
import { AccountStore } from '../../../../accounts/application/accounts.store';
import { ToastService } from '../../../application/toast.service';
import { ToastComponent } from '../toast/toast.component';

@Component({
    selector: 'fs-layout',
    standalone: true,
    imports: [RouterLink, RouterLinkActive, RouterOutlet, TranslateModule, ToastComponent],
    templateUrl: './layout.html',
    styleUrls: ['./layout.css'],
})
export class LayoutComponent {
    private readonly accounts = inject(AccountStore);
    private readonly router = inject(Router);
    private readonly toast = inject(ToastService);
    private readonly translate = inject(TranslateService);
    protected readonly signingOut = signal(false);
    constructor(public lang: LanguageService) {}
    curr() { return this.lang.current(); }
    toggleLang() { this.lang.toggle(); }
    setLang(l: 'en'|'es') { this.lang.use(l); }

    protected async logout(): Promise<void> {
        if (this.signingOut()) return;
        this.signingOut.set(true);
        const ended = await this.accounts.logout();
        this.signingOut.set(false);
        if (ended) void this.router.navigate(['/login']);
        else this.toast.error(this.translate.instant('app.logoutError'));
    }
}
