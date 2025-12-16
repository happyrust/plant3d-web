import type { Component } from 'vue';

export type RibbonIconComponent = Component;

export type RibbonButtonItem = {
  kind: 'button';
  id: string;
  label: string;
  icon?: string;
  commandId: string;
  disabled?: boolean;
};

export type RibbonStackItem = {
  kind: 'stack';
  id: string;
  items: RibbonButtonItem[];
};

export type RibbonSeparatorItem = {
  kind: 'separator';
  id: string;
};

export type RibbonItem = RibbonButtonItem | RibbonStackItem | RibbonSeparatorItem;

export type RibbonGroupConfig = {
  id: string;
  label: string;
  items: RibbonItem[];
};

export type RibbonTabConfig = {
  id: string;
  label: string;
  groups: RibbonGroupConfig[];
};
