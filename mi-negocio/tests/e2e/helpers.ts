import { expect, type Page } from '@playwright/test';

export const DEMO = { email: 'demo@luna-boutique.test', password: 'demo-luna-2026' };

export async function login(page: Page, email = DEMO.email, password = DEMO.password) {
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await page.waitForURL(/\/app$/);
}

/** Crea una cuenta nueva y su negocio desde la interfaz. */
export async function signupAndOnboard(page: Page, businessName = 'Tienda E2E') {
  const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`;
  await page.goto('/signup');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill('clave-e2e-segura');
  await page.getByLabel('Repetí la contraseña').fill('clave-e2e-segura');
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await page.waitForURL(/\/onboarding/);
  await page.getByLabel('Nombre del negocio').fill(businessName);
  await page.getByLabel('¿Cómo te llamamos?').fill('Dueña');
  await page.getByLabel('WhatsApp del negocio').fill('71234567');
  await page.getByRole('button', { name: 'Crear mi negocio' }).click();
  await page.waitForURL(/\/app$/);
  return email;
}

export async function createProduct(page: Page, name: string, price: string, stock: string) {
  await page.goto('/app/products/new');
  await page.getByLabel('Nombre', { exact: true }).fill(name);
  await page.getByLabel('Talla').fill('M');
  await page.getByLabel('Color').fill('Negra');
  await page.getByLabel('Precio de venta (Bs)').fill(price);
  await page.getByLabel('Stock inicial').fill(stock);
  await page.getByRole('button', { name: 'Guardar producto' }).click();
  await page.waitForURL(/\/app\/products\/[0-9a-f-]{36}$/);
}

/** Crea y confirma un pedido de 2 unidades con envío Bs 15 para un cliente nuevo; opcionalmente con anticipo. */
export async function createOrderWithNewCustomer(page: Page, opts: { customer: string; product: string; deposit?: string }) {
  await page.goto('/app/orders/new');
  await page.getByRole('button', { name: 'Nuevo cliente' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nombre').fill(opts.customer);
  await dialog.getByRole('button', { name: 'Guardar cliente' }).click();
  await expect(page.getByText(opts.customer).first()).toBeVisible();

  await page.getByLabel('Agregar producto').click();
  await page.getByLabel('Agregar producto').fill(opts.product);
  await page.getByRole('button', { name: new RegExp(opts.product) }).first().click();
  await page.getByRole('button', { name: 'Sumar uno' }).click();
  await page.getByText('Envío a domicilio').click();
  await page.getByLabel('Costo de envío (Bs)').fill('15');
  await expect(page.getByText('Bs 175.00').first()).toBeVisible();
  if (opts.deposit) {
    await page.getByLabel(/Registrar un pago al confirmar/).check();
    await page.getByLabel('Monto (Bs)').fill(opts.deposit);
    await page.getByLabel('Medio').selectOption('qr');
  }
  await page.getByRole('button', { name: 'Confirmar pedido' }).click();
  await page.waitForURL(/\/app\/orders\/[0-9a-f-]{36}\?created=1/);
}

export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}
