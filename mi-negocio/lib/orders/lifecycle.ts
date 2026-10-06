import type { OrderStatus } from '@/lib/money/order-math';

// Transiciones permitidas (la base de datos aplica las mismas reglas).
export const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  new: ['confirmed', 'canceled'],
  confirmed: ['preparing', 'delivered', 'canceled'],
  preparing: ['delivered', 'canceled'],
  // Solo mediante el flujo explícito de cancelación/devolución del pedido completo.
  delivered: ['canceled'],
  canceled: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export type PrimaryAction = 'confirm' | 'prepare' | 'deliver' | null;

/** Próxima acción principal sugerida según el estado. */
export function primaryAction(status: OrderStatus): PrimaryAction {
  switch (status) {
    case 'new':
      return 'confirm';
    case 'confirmed':
      return 'prepare';
    case 'preparing':
      return 'deliver';
    default:
      return null;
  }
}

export function isEditableDraft(status: OrderStatus): boolean {
  return status === 'new';
}

export function isOpen(status: OrderStatus): boolean {
  return status === 'new' || status === 'confirmed' || status === 'preparing';
}
