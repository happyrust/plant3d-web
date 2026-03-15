import { describe, expect, it } from 'vitest';
import { createApp, h } from 'vue';

import Card from './Card.vue';

describe('Card', () => {
  it('renders the expected base shell styles', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    createApp({
      render: () => h(Card, null, { default: () => 'Card content' }),
    }).mount(host);

    const card = host.querySelector('section');
    const body = host.querySelector('div');

    expect(card?.className).toContain('bg-white');
    expect(card?.className).toContain('rounded-[12px]');
    expect(card?.className).toContain('shadow-[0_4px_12px_rgba(0,0,0,0.1)]');
    expect(body?.className).toContain('px-5');
    expect(body?.className).toContain('py-5');
  });

  it('renders the title in the header when provided', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    createApp({
      render: () => h(Card, { title: 'Pipeline Summary' }, { default: () => 'Details' }),
    }).mount(host);

    const header = host.querySelector('header');

    expect(header).toBeTruthy();
    expect(header?.textContent).toContain('Pipeline Summary');
    expect(header?.className).toContain('p-5');
    expect(header?.className).not.toContain('px-5');
    expect(header?.className).not.toContain('py-4');
  });

  it('supports a custom header slot', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    createApp({
      render: () =>
        h(Card, null, {
          header: () => h('div', { 'data-testid': 'custom-header' }, 'Custom Header'),
          default: () => 'Body content',
        }),
    }).mount(host);

    const customHeader = host.querySelector('[data-testid="custom-header"]');

    expect(customHeader).toBeTruthy();
    expect(customHeader?.textContent).toBe('Custom Header');
  });

  it('keeps long content constrained within the card body', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const longText = 'A'.repeat(300);

    createApp({
      render: () => h(Card, null, { default: () => longText }),
    }).mount(host);

    const card = host.querySelector('section');
    const body = host.querySelector('div');

    expect(card?.className).toContain('overflow-hidden');
    expect(body?.className).toContain('break-words');
    expect(body?.textContent).toBe(longText);
  });

  it('forwards custom class names to card sections', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    createApp({
      render: () =>
        h(
          Card,
          {
            class: 'ring-1',
            headerClass: 'pb-6',
            bodyClass: 'pt-6',
            title: 'Styled card',
          },
          { default: () => 'Body' }
        ),
    }).mount(host);

    const card = host.querySelector('section');
    const header = host.querySelector('header');
    const body = host.querySelector('div');

    expect(card?.className).toContain('ring-1');
    expect(header?.className).toContain('pb-6');
    expect(body?.className).toContain('pt-6');
  });
});
