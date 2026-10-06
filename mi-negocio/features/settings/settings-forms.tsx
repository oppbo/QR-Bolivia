'use client';

import { Download } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { ImagePicker } from '@/components/image-picker';
import { Alert, buttonClass, Card, Field, Input, Select, SectionTitle } from '@/components/ui/primitives';
import { SubmitButton } from '@/components/ui/submit-button';
import { TIMEZONES } from '@/lib/dates';
import { setBusinessAsset, updateSettings } from './actions';

export interface SettingsInitial {
  revision: number;
  name: string;
  whatsapp_phone: string;
  pickup_address: string;
  pickup_reference: string;
  payment_qr_label: string;
  timezone: string;
  display_name: string;
}

export function BusinessForm({ initial }: { initial: SettingsInitial }) {
  const router = useRouter();
  const [d, setD] = useState(initial);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: 'danger' | 'success'; text: string } | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});
  const set = (k: keyof SettingsInitial) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setD((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Card>
      <SectionTitle>Negocio</SectionTitle>
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setMsg(null);
          setFe({});
          start(async () => {
            const r = await updateSettings({ ...d, revision: initial.revision }).catch(() => null);
            if (!r) return setMsg({ tone: 'danger', text: 'No pudimos guardar los cambios. Tus datos siguen en el formulario.' });
            if (!r.ok) {
              setFe(r.fieldErrors ?? {});
              return setMsg({ tone: 'danger', text: r.error });
            }
            setMsg({ tone: 'success', text: 'Cambios guardados.' });
            router.refresh();
          });
        }}
      >
        {msg ? <Alert tone={msg.tone} role={msg.tone === 'danger' ? 'alert' : 'status'}>{msg.text}</Alert> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="s-name" label="Nombre del negocio" error={fe.name}>
            <Input id="s-name" value={d.name} onChange={set('name')} maxLength={80} />
          </Field>
          <Field id="s-display" label="Tu nombre" error={fe.display_name}>
            <Input id="s-display" value={d.display_name} onChange={set('display_name')} maxLength={80} />
          </Field>
          <Field id="s-phone" label="WhatsApp del negocio" error={fe.whatsapp_phone}>
            <Input id="s-phone" inputMode="tel" value={d.whatsapp_phone} onChange={set('whatsapp_phone')} />
          </Field>
          <Field id="s-tz" label="Zona horaria" hint="Define qué es «hoy» en reportes. Predeterminada: America/La_Paz.">
            <Select id="s-tz" value={d.timezone} onChange={set('timezone')}>
              {TIMEZONES.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </Field>
          <Field id="s-addr" label="Dirección para retiros" optional>
            <Input id="s-addr" value={d.pickup_address} onChange={set('pickup_address')} maxLength={300} />
          </Field>
          <Field id="s-ref" label="Referencia para retiros" optional>
            <Input id="s-ref" value={d.pickup_reference} onChange={set('pickup_reference')} maxLength={300} />
          </Field>
          <Field id="s-qr-label" label="Datos para el cobro por QR" optional hint="Ej.: titular y banco, tal como querés mostrarlos." className="sm:col-span-2">
            <Input id="s-qr-label" value={d.payment_qr_label} onChange={set('payment_qr_label')} maxLength={160} />
          </Field>
        </div>
        <p className="text-sm text-muted">Moneda: bolivianos (Bs). No se puede cambiar en esta versión.</p>
        <div>
          <SubmitButton pending={pending}>Guardar cambios</SubmitButton>
        </div>
      </form>
    </Card>
  );
}

export function AssetForm({
  kind,
  title,
  description,
  currentUrl,
  downloadUrl,
  label,
}: {
  kind: 'logo' | 'payment_qr';
  title: string;
  description: string;
  currentUrl: string | null;
  downloadUrl?: string | null;
  label?: string | null;
}) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [remove, setRemove] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: 'danger' | 'success'; text: string } | null>(null);
  const [pickerKey, setPickerKey] = useState(0);
  const isQr = kind === 'payment_qr';
  return (
    <Card>
      <SectionTitle>{title}</SectionTitle>
      <p className="mb-3 text-muted">{description}</p>
      {isQr && currentUrl ? (
        <figure className="mb-4 flex flex-col items-center gap-2 rounded-[var(--radius-field)] border border-line bg-white p-4">
          {/* Sin recortes ni superposiciones: el QR debe poder escanearse tal cual. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={currentUrl} alt="QR de cobro del negocio" className="h-auto max-h-80 w-auto max-w-full object-contain" />
          {label ? <figcaption className="text-center font-medium">{label}</figcaption> : null}
          {downloadUrl ? (
            <a href={downloadUrl} className={buttonClass('secondary')} download>
              <Download aria-hidden className="size-4" /> Descargar QR
            </a>
          ) : null}
          <p className="text-center text-sm text-muted">
            Descargalo para adjuntarlo en WhatsApp. Es el QR que subiste: no indica un monto ni confirma pagos.
          </p>
        </figure>
      ) : null}
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setMsg(null);
          if (!file && !remove) return setMsg({ tone: 'danger', text: 'Elegí una imagen primero.' });
          const fd = new FormData();
          if (file) fd.set('file', file);
          start(async () => {
            const r = await setBusinessAsset(kind, fd).catch(() => null);
            if (!r || !r.ok) return setMsg({ tone: 'danger', text: r?.error ?? 'No pudimos subir la imagen. Intentá de nuevo.' });
            setMsg({ tone: 'success', text: remove && !file ? 'Imagen eliminada.' : 'Imagen guardada.' });
            setFile(null);
            setRemove(false);
            setPickerKey((k) => k + 1);
            router.refresh();
          });
        }}
      >
        {msg ? <Alert tone={msg.tone} role={msg.tone === 'danger' ? 'alert' : 'status'}>{msg.text}</Alert> : null}
        <ImagePicker
          key={pickerKey}
          label={isQr ? 'Imagen del QR' : 'Logo'}
          currentUrl={isQr ? null : currentUrl}
          compress={!isQr}
          hint={isQr ? 'JPG, PNG o WebP, hasta 5 MB. Se guarda sin recortar ni comprimir.' : undefined}
          onChange={(f, rm) => {
            setFile(f);
            setRemove(rm);
          }}
        />
        {isQr && currentUrl && !file ? (
          <label className="flex min-h-11 items-center gap-3">
            <input type="checkbox" className="size-5" checked={remove} onChange={(e) => setRemove(e.target.checked)} />
            Quitar el QR actual
          </label>
        ) : null}
        <div>
          <SubmitButton pending={pending} disabled={!file && !remove}>
            {remove && !file ? 'Quitar imagen' : 'Guardar imagen'}
          </SubmitButton>
        </div>
      </form>
    </Card>
  );
}
