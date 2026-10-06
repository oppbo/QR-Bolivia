// Tipos y ayudas del formulario de productos (sin 'use client': se usan también en el servidor).
import { centsToInput } from '@/lib/money/money';

export interface VariantDraft {
  key: string;
  id?: string;
  remove?: boolean;
  sku: string;
  size: string;
  color: string;
  price: string;
  cost: string;
  track_inventory: boolean;
  initial_stock: string;
  low_stock_threshold: string;
  reserved?: number;
  on_hand?: number;
}

export interface ProductDraft {
  id?: string;
  revision?: number;
  name: string;
  description: string;
  category: string;
  imageUrl?: string | null;
  variants: VariantDraft[];
}

let counter = 0;
const newKey = () => `v${Date.now()}-${counter++}`;

export function emptyVariant(): VariantDraft {
  return { key: newKey(), sku: '', size: '', color: '', price: '', cost: '', track_inventory: true, initial_stock: '0', low_stock_threshold: '2' };
}

export function variantFromRow(v: {
  id: string;
  sku: string | null;
  size: string | null;
  color: string | null;
  price_cents: number;
  cost_cents: number | null;
  track_inventory: boolean;
  low_stock_threshold: number;
  reserved: number;
  on_hand: number;
}): VariantDraft {
  return {
    key: v.id,
    id: v.id,
    sku: v.sku ?? '',
    size: v.size ?? '',
    color: v.color ?? '',
    price: centsToInput(v.price_cents),
    cost: v.cost_cents == null ? '' : centsToInput(v.cost_cents),
    track_inventory: v.track_inventory,
    initial_stock: '0',
    low_stock_threshold: String(v.low_stock_threshold),
    reserved: v.reserved,
    on_hand: v.on_hand,
  };
}
