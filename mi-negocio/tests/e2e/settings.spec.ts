import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('subir el QR de cobro: se muestra completo y se puede descargar con URL firmada', async ({ page }) => {
  await login(page);
  await page.goto('/app/settings');
  const qrCard = page.locator('section', { has: page.getByRole('heading', { name: 'QR de cobro' }) });
  // Un SVG se rechaza en el cliente (y el bucket solo acepta JPG/PNG/WebP).
  await qrCard.locator('input[type=file]').setInputFiles({ name: 'qr.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') });
  await expect(qrCard.getByText('Solo se aceptan imágenes JPG, PNG o WebP.')).toBeVisible();

  await qrCard.locator('input[type=file]').setInputFiles('public/icons/icon-512.png');
  await qrCard.getByRole('button', { name: 'Guardar imagen' }).click();
  await expect(qrCard.getByText('Imagen guardada.')).toBeVisible();
  const img = qrCard.getByRole('img', { name: 'QR de cobro del negocio' });
  await expect(img).toBeVisible();
  const src = await img.getAttribute('src');
  expect(src).toContain('/storage/v1/object/sign/business-files/');
  expect(src).toContain('token=');
  await expect(qrCard.getByRole('link', { name: 'Descargar QR' })).toBeVisible();
});

test('sin conexión: aviso visible y envíos financieros deshabilitados', async ({ page, context }) => {
  await login(page);
  await page.goto('/app/cash');
  await page.getByRole('button', { name: 'Registrar gasto' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Monto (Bs)').fill('12.50');
  await context.setOffline(true);
  await expect(page.getByText(/Sin conexión\. Podés seguir viendo esta pantalla/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Registrar gasto' })).toBeDisabled();
  await context.setOffline(false);
  await expect(dialog.getByRole('button', { name: 'Registrar gasto' })).toBeEnabled();
  await expect(dialog.getByLabel('Monto (Bs)')).toHaveValue('12.50');
});
