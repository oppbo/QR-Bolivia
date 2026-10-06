import { expect, test } from '@playwright/test';
import { createOrderWithNewCustomer, createProduct, signupAndOnboard } from './helpers';

const stockRow = (page: import('@playwright/test').Page) => page.locator('li', { hasText: 'M / Negra' }).filter({ has: page.getByText('Disponible') }).first();

test('recorrido principal: registro, producto, cliente, pedido con anticipo, entrega y pago final', async ({ page }) => {
  await signupAndOnboard(page, 'Boutique Recorrido');
  await expect(page.getByRole('heading', { name: 'Empecemos por tus productos' })).toBeVisible();

  await createProduct(page, 'Polera básica', '80', '10');
  await expect(stockRow(page)).toContainText(/Disponible\s*10/);

  await createOrderWithNewCustomer(page, { customer: 'Ana Prueba', product: 'Polera básica', deposit: '50' });
  await expect(page.getByText('Pedido guardado')).toBeVisible();
  await expect(page.getByText('Parcial').first()).toBeVisible();
  await expect(page.locator('dl').getByText('Bs 125.00')).toBeVisible();
  const orderUrl = page.url().replace('?created=1', '');

  // Stock reservado: 10 en existencia, 2 reservadas, 8 disponibles.
  await page.goto('/app/products');
  await page.getByRole('link', { name: /Polera básica/ }).click();
  await expect(stockRow(page)).toContainText(/Disponible\s*8/);
  await expect(stockRow(page)).toContainText(/Reservado\s*2/);
  await expect(stockRow(page)).toContainText(/En existencia\s*10/);

  // Entregar con saldo: advertencia visible.
  await page.goto(orderUrl);
  await page.getByRole('button', { name: 'Marcar entregado' }).click();
  const dlg = page.getByRole('dialog');
  await expect(dlg.getByText('Saldo pendiente: Bs 125.00')).toBeVisible();
  await dlg.getByRole('button', { name: 'Entregar igualmente' }).click();
  await expect(page.getByText('Entregado').first()).toBeVisible();

  // Pago final en efectivo.
  await page.getByRole('button', { name: 'Registrar pago' }).click();
  const pay = page.getByRole('dialog');
  await expect(pay.getByLabel('Monto (Bs)')).toHaveValue('125.00');
  await pay.getByLabel('Medio').selectOption('cash');
  await pay.getByRole('button', { name: 'Registrar pago' }).click();
  await expect(page.getByText('Pagado').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Registrar pago' })).toHaveCount(0);

  await page.goto('/app/products');
  await page.getByRole('link', { name: /Polera básica/ }).click();
  await expect(stockRow(page)).toContainText(/Disponible\s*8/);
  await expect(stockRow(page)).toContainText(/Reservado\s*0/);
  await expect(stockRow(page)).toContainText(/En existencia\s*8/);
});

test('cancelar un pedido con anticipo y registrar el reembolso', async ({ page }) => {
  await signupAndOnboard(page, 'Boutique Cancelación');
  await createProduct(page, 'Gorra urbana', '80', '10');
  await createOrderWithNewCustomer(page, { customer: 'Bea Prueba', product: 'Gorra urbana', deposit: '50' });
  const orderUrl = page.url().replace('?created=1', '');

  await page.getByRole('button', { name: 'Cancelar pedido' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Motivo').fill('El cliente desistió');
  await dlg.getByRole('button', { name: 'Cancelar pedido' }).click();
  await expect(page.getByText('Reembolso pendiente: Bs 50.00')).toBeVisible();

  await page.getByRole('button', { name: 'Registrar reembolso' }).click();
  const r = page.getByRole('dialog');
  await expect(r.getByLabel('Monto (Bs)')).toHaveValue('50.00');
  await r.getByLabel('Medio').selectOption('qr');
  await r.getByLabel('Motivo').fill('Devolución del anticipo');
  await r.getByRole('button', { name: 'Registrar reembolso' }).click();
  await expect(page.getByText('Cancelado sin saldo').first()).toBeVisible();
  // El pago y el reembolso siguen visibles.
  await expect(page.getByText('Pago Bs 50.00 · QR')).toBeVisible();
  await expect(page.getByText('Reembolso −Bs 50.00 · QR')).toBeVisible();

  // Stock liberado sin aumentar existencia.
  await page.goto('/app/products');
  await page.getByRole('link', { name: /Gorra urbana/ }).click();
  await expect(page.locator('li', { hasText: 'M / Negra' }).first()).toContainText(/Disponible\s*10/);
  void orderUrl;
});
