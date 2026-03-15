import { describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';

import Button from './Button.vue';

describe('Button', () => {
  it('renders with primary variant and medium size by default', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    createApp({
      render: () => h(Button, null, { default: () => 'Create Task' }),
    }).mount(host);

    const button = host.querySelector('button');

    expect(button?.textContent).toContain('Create Task');
    expect(button?.className).toContain('bg-[#FF6B00]');
    expect(button?.className).toContain('h-10');
    expect(button?.getAttribute('type')).toBe('button');
    expect(button?.hasAttribute('disabled')).toBe(false);
  });

  it('applies secondary and danger variant styles', () => {
    const secondaryHost = document.createElement('div');
    const dangerHost = document.createElement('div');
    document.body.appendChild(secondaryHost);
    document.body.appendChild(dangerHost);

    createApp({
      render: () => h(Button, { variant: 'secondary' }, { default: () => 'Secondary' }),
    }).mount(secondaryHost);
    createApp({
      render: () => h(Button, { variant: 'danger' }, { default: () => 'Danger' }),
    }).mount(dangerHost);

    const secondary = secondaryHost.querySelector('button');
    const danger = dangerHost.querySelector('button');

    expect(secondary?.className).toContain('border');
    expect(secondary?.className).toContain('bg-white');
    expect(danger?.className).toContain('bg-[#EF4444]');
    expect(danger?.className).toContain('text-white');
  });

  it('supports sm and lg sizes', () => {
    const smallHost = document.createElement('div');
    const largeHost = document.createElement('div');
    document.body.appendChild(smallHost);
    document.body.appendChild(largeHost);

    createApp({
      render: () => h(Button, { size: 'sm' }, { default: () => 'Small' }),
    }).mount(smallHost);
    createApp({
      render: () => h(Button, { size: 'lg' }, { default: () => 'Large' }),
    }).mount(largeHost);

    const small = smallHost.querySelector('button');
    const large = largeHost.querySelector('button');

    expect(small?.className).toContain('h-8');
    expect(small?.className).toContain('text-xs');
    expect(large?.className).toContain('h-12');
    expect(large?.className).toContain('text-base');
  });

  it('forwards custom class names', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    createApp({
      render: () => h(Button, { class: 'w-full justify-between' }, { default: () => 'Wide' }),
    }).mount(host);

    const button = host.querySelector('button');

    expect(button?.className).toContain('w-full');
    expect(button?.className).toContain('justify-between');
  });

  it('disables interaction when disabled is true', async () => {
    const onClick = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);

    createApp({
      render: () => h(Button, { disabled: true, onClick }, { default: () => 'Disabled' }),
    }).mount(host);
    const button = host.querySelector('button') as HTMLButtonElement | null;

    button?.click();
    await nextTick();

    expect(button?.disabled).toBe(true);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('shows loading indicator and disables clicks while loading', async () => {
    const onClick = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);

    createApp({
      render: () => h(Button, { loading: true, onClick }, { default: () => 'Saving' }),
    }).mount(host);
    const button = host.querySelector('button') as HTMLButtonElement | null;

    button?.click();
    await nextTick();

    expect(button?.disabled).toBe(true);
    expect(button?.getAttribute('aria-busy')).toBe('true');
    expect(button?.getAttribute('aria-label')).toBe('加载中');
    expect(host.querySelector('svg')).toBeTruthy();
    expect(host.querySelector('.sr-only')?.textContent).toBe('加载中');
    expect(button?.getAttribute('data-loading')).toBe('true');
    expect(onClick).not.toHaveBeenCalled();
  });

  it('keeps loading state accessible when there is no visible label', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    createApp({
      render: () => h(Button, { loading: true }),
    }).mount(host);

    const button = host.querySelector('button');

    expect(button?.textContent).toContain('加载中');
    expect(button?.getAttribute('aria-label')).toBe('加载中');
    expect(host.querySelector('.sr-only')).toBeTruthy();
  });

  it('emits click when interactive', async () => {
    const onClick = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);

    createApp({
      render: () => h(Button, { onClick }, { default: () => 'Submit' }),
    }).mount(host);
    const button = host.querySelector('button') as HTMLButtonElement | null;

    button?.click();
    await nextTick();

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
