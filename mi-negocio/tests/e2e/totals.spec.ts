import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('Inicio, Caja y el detalle del pedido muestran los mismos valores', async ({ page }) => {
  await login(page);
  const collected = await page.getByText('Cobrado hoy', { exact: true }).locator('..').locator('p.tabular').textContent();
  expect(collected).toBe('Bs 200.00');

  await page.goto('/app/cash');
  const cashCollected = await page.getByText('Cobrado', { exact: true }).locator('..').locator('p.tabular').textContent();
  expect(cashCollected).toBe(collected);
  await expect(page.getByText('Movimiento neto registrado')).toBeVisible();

  // Filtro "Con saldo" + detalle.
  await page.goto('/app/orders');
  await page.getByRole('link', { name: 'Con saldo' }).click();
  await expect(page).toHaveURL(/quick=balance/);
  const card = page.locator('a', { hasText: 'PED-000004' }).locator('visible=true').first();
  await expect(card).toContainText('Saldo Bs 125.00');
  await expect(page.locator('a', { hasText: 'PED-000006' })).toHaveCount(0); // Nuevo: aún no se cobra
  await card.click();
  await expect(page.locator('dl').getByText('Bs 125.00')).toBeVisible();

  // Buscar por número y filtrar por estado conserva la URL.
  await page.goto('/app/orders?status=canceled');
  await expect(page.locator('a', { hasText: 'PED-000010' }).locator('visible=true').first()).toContainText('Reembolso Bs 80.00');
  await page.reload();
  await expect(page.getByLabel('Estado')).toHaveValue('canceled');
});

test('compartir por WhatsApp abre wa.me con el mensaje, sin enviar nada', async ({ page, context }) => {
  await context.route('https://wa.me/**', (route) => route.fulfill({ status: 200, body: 'interceptado' }));
  await login(page);
  await page.goto('/app/orders?q=PED-000004');
  await page.locator('a', { hasText: 'PED-000004' }).locator('visible=true').first().click();
  await page.getByRole('button', { name: 'Compartir resumen' }).click();
  const dlg = page.getByRole('dialog');
  await expect(dlg.getByLabel('Vista previa del mensaje')).toContainText('2 × Polera básica — M / Negra: Bs 160.00');
  await expect(dlg.getByLabel('Vista previa del mensaje')).not.toContainText('Pidió por WhatsApp'); // nota privada
  const [popup] = await Promise.all([page.waitForEvent('popup'), dlg.getByRole('link', { name: 'Abrir WhatsApp' }).click()]);
  const url = decodeURIComponent(popup.url());
  expect(url).toMatch(/^https:\/\/wa\.me\/\?text=/);
  expect(url).toContain('Saldo pendiente: Bs 125.00');
  await popup.close();
});
