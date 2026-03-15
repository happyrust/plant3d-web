import { describe, expect, it } from 'vitest';
import { createApp, h, nextTick, ref } from 'vue';

import { Search } from 'lucide-vue-next';

import Input from './Input.vue';

describe('Input', () => {
  it('renders placeholder and updates v-model value on input', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const model = ref('');

    createApp({
      setup() {
        return { model };
      },
      render() {
        return h(Input, {
          modelValue: this.model,
          'onUpdate:modelValue': (value: string) => {
            this.model = value;
          },
          placeholder: 'Search tasks',
        });
      },
    }).mount(host);

    const input = host.querySelector('input') as HTMLInputElement | null;

    expect(input?.getAttribute('placeholder')).toBe('Search tasks');

    if (!input) throw new Error('Input element not found');
    input.value = 'Alpha';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();

    expect(model.value).toBe('Alpha');
  });

  it('applies focus-ready blue border styles in the default state', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    createApp({
      render: () => h(Input),
    }).mount(host);

    const wrapper = host.querySelector('label');

    expect(wrapper?.className).toContain('focus-within:border-[#3B82F6]');
    expect(wrapper?.className).toContain('border-[#D1D5DB]');
  });

  it('renders the error state with a red border and aria-invalid', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    createApp({
      render: () => h(Input, { error: true, modelValue: 'Broken value' }),
    }).mount(host);

    const wrapper = host.querySelector('label');
    const input = host.querySelector('input');

    expect(wrapper?.className).toContain('border-[#EF4444]');
    expect(wrapper?.getAttribute('data-error')).toBe('true');
    expect(input?.getAttribute('aria-invalid')).toBe('true');
  });

  it('renders the disabled state with gray background and non-editable input', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    createApp({
      render: () => h(Input, { disabled: true, modelValue: 'Locked' }),
    }).mount(host);

    const wrapper = host.querySelector('label');
    const input = host.querySelector('input') as HTMLInputElement | null;

    expect(wrapper?.className).toContain('bg-[#F3F4F6]');
    expect(wrapper?.className).toContain('cursor-not-allowed');
    expect(wrapper?.getAttribute('data-disabled')).toBe('true');
    expect(input?.disabled).toBe(true);
  });

  it('renders a prefix icon slot and keeps the input value visible', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    createApp({
      render: () =>
        h(Input, { modelValue: 'Filter' }, {
          prefixIcon: () => h(Search, { class: 'h-4 w-4', 'data-testid': 'prefix-icon' }),
        }),
    }).mount(host);

    const icon = host.querySelector('[data-testid="prefix-icon"]');
    const input = host.querySelector('input') as HTMLInputElement | null;

    expect(icon).toBeTruthy();
    expect(input?.value).toBe('Filter');
  });
});
