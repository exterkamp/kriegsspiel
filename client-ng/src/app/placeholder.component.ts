import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

@Component({
  selector: 'ks-placeholder',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<h1>{{ title }}</h1>`,
  styles: `
    h1 {
      color: #efe6c8;
      padding: 16px;
    }
  `,
})
export class PlaceholderComponent {
  protected readonly title = String(inject(ActivatedRoute).snapshot.data['title'] ?? '');
}
