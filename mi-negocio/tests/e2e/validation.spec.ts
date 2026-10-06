import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('valida campos obligatorios y recupera un fallo de guardado sin perder datos', async ({ page }) => {
  await login(page);
  await page.goto('/app/products/new');
  await page.getByRole('button', { name: 'Guardar producto' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Revisá los campos marcados' })).toBeVisible();
  await expect(page.getByText('Ingresá el nombre del producto.')).toBeVisible();
  await expect(page.getByText('Ingresá un monto.')).toBeVisible();

  await page.getByLabel('Nombre', { exact: true }).fill('Producto que no se guarda');
  await page.getByLabel('Precio de venta (Bs)').fill('12.345');
  await page.getByRole('button', { name: 'Guardar producto' }).click();
  await expect(page.getByText(/dos decimales/)).toBeVisible();

  // Simular caída de red en el envío.
  await page.getByLabel('Precio de venta (Bs)').fill('99.90');
  await page.route('**/app/products/new', (route) => (route.request().method() === 'POST' ? route.abort('failed') : route.continue()));
  await page.getByRole('button', { name: 'Guardar producto' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Tus datos siguen en el formulario' })).toBeVisible();
  await expect(page.getByLabel('Nombre', { exact: true })).toHaveValue('Producto que no se guarda');
  await expect(page.getByLabel('Precio de venta (Bs)')).toHaveValue('99.90');
  await page.unroute('**/app/products/new');
});

test('el acceso a rutas privadas exige sesión y vuelve a la ruta pedida', async ({ page }) => {
  await page.goto('/app/cash');
  await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Fcash/);
  await page.getByLabel('Correo electrónico').fill('demo@luna-boutique.test');
  await page.getByLabel('Contraseña').fill('demo-luna-2026');
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page).toHaveURL(/\/app\/cash$/);
  // Cerrar sesión impide volver a ver datos privados.
  await page.goto('/app/settings');
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page).toHaveURL(/\/login\?signedout=1/);
  await page.goto('/app/cash');
  await expect(page).toHaveURL(/\/login/);
});
