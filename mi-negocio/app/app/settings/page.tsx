import { LogOut } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { buttonClass, Card, PageHeader, SectionTitle } from '@/components/ui/primitives';
import { AssetForm, BusinessForm } from '@/features/settings/settings-forms';
import { requireBusiness } from '@/lib/auth/session';
import { formatPhone } from '@/lib/phone';
import { signedImageUrl } from '@/lib/storage/images';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Ajustes' };

export default async function SettingsPage() {
  const { business, email, displayName } = await requireBusiness('/app/settings');
  const supabase = await createClient();
  const [qrUrl, qrDownload, logoUrl] = await Promise.all([
    signedImageUrl(supabase, business.payment_qr_path, 300),
    signedImageUrl(supabase, business.payment_qr_path, 300, 'qr-cobro.png'),
    signedImageUrl(supabase, business.logo_path, 300),
  ]);
  return (
    <>
      <PageHeader title="Ajustes" />
      <div className="flex flex-col gap-4">
        <BusinessForm
          initial={{
            revision: business.revision,
            name: business.name,
            whatsapp_phone: business.whatsapp_phone ? formatPhone(business.whatsapp_phone) : '',
            pickup_address: business.pickup_address ?? '',
            pickup_reference: business.pickup_reference ?? '',
            payment_qr_label: business.payment_qr_label ?? '',
            timezone: business.timezone,
            display_name: displayName ?? '',
          }}
        />
        <AssetForm
          kind="payment_qr"
          title="QR de cobro"
          description="Subí el QR que te dio tu banco o billetera. Mi Negocio no genera QR bancarios ni verifica pagos: los pagos se registran manualmente."
          currentUrl={qrUrl}
          downloadUrl={qrDownload}
          label={business.payment_qr_label}
        />
        <AssetForm kind="logo" title="Logo" description="Opcional." currentUrl={logoUrl} />
        <Card>
          <SectionTitle>Cuenta</SectionTitle>
          <p className="mb-3">
            <span className="text-muted">Correo:</span> {email}
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href="/reset-password" className={buttonClass('secondary')}>
              Cambiar contraseña
            </Link>
            <form action="/auth/signout" method="post">
              <button className={buttonClass('secondary')}>
                <LogOut aria-hidden className="size-4" /> Cerrar sesión
              </button>
            </form>
          </div>
        </Card>
      </div>
    </>
  );
}
