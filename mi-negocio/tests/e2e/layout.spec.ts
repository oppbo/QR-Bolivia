import { expect, test } from '@playwright/test';
import { expectNoHorizontalOverflow, login } from './helpers';

test('pantallas clave sin desbordamiento horizontal', async ({ page }) => {
  await login(page);
  for (const path of ['/app', '/app/orders', '/app/orders/new', '/app/products', '/app/products/new', '/app/customers', '/app/cash', '/app/settings']) {
    await page.goto(path);
    await expect(page.locator('h1').first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
  }
});

test('diálogos accesibles con teclado: foco dentro, Escape cierra y devuelve el foco', async ({ page }) => {
  await login(page);
  await page.goto('/app/cash');
  const trigger = page.getByRole('button', { name: 'Registrar gasto' });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Registrar gasto' });
  await expect(dialog).toBeVisible();
  const inside = await page.evaluate(() => document.querySelector('[role="dialog"]')?.contains(document.activeElement));
  expect(inside).toBe(true);
  for (let i = 0; i < 15; i++) await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.querySelector('[role="dialog"]')?.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});
