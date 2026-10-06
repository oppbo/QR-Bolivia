'use client';

import { ImagePlus, Trash2 } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/primitives';

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = 'image/jpeg,image/png,image/webp';

/** Reduce fotos grandes a WebP (máx. 1600 px) antes de subir. No se usa para QR. */
async function compressPhoto(file: File): Promise<File> {
  if (typeof createImageBitmap !== 'function') return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 600 * 1024) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', 0.82));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], 'foto.webp', { type: 'image/webp' });
  } catch {
    return file;
  }
}

export function ImagePicker({
  label,
  currentUrl,
  compress = true,
  onChange,
  hint,
}: {
  label: string;
  currentUrl?: string | null;
  compress?: boolean;
  onChange: (file: File | null, removeCurrent: boolean) => void;
  hint?: string;
}) {
  const id = useId();
  const [preview, setPreview] = useState<string | null>(currentUrl ?? null);
  const [error, setError] = useState<string | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }, [objectUrl]);

  async function handle(file: File | undefined) {
    setError(null);
    if (!file) return;
    if (!ACCEPT.split(',').includes(file.type)) {
      setError('Solo se aceptan imágenes JPG, PNG o WebP.');
      return;
    }
    const ready = compress ? await compressPhoto(file) : file;
    if (ready.size > MAX_BYTES) {
      setError('La imagen supera 5 MB. Elegí una más liviana.');
      return;
    }
    const url = URL.createObjectURL(ready);
    setObjectUrl(url);
    setPreview(url);
    onChange(ready, false);
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="font-medium">{label} <span className="font-normal text-muted">(opcional)</span></span>
      <div className="flex flex-wrap items-center gap-3">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" className="size-24 rounded-[var(--radius-field)] border border-line object-contain bg-page" />
        ) : null}
        <label
          htmlFor={id}
          className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-[var(--radius-field)] border border-line-strong bg-surface px-4 font-semibold hover:bg-page focus-within:outline-3 focus-within:outline-blue-600"
        >
          <ImagePlus aria-hidden className="size-5" />
          {preview ? 'Cambiar imagen' : 'Elegir imagen'}
          <input id={id} type="file" accept={ACCEPT} className="sr-only" onChange={(e) => handle(e.target.files?.[0])} />
        </label>
        {preview ? (
          <Button
            variant="ghost"
            onClick={() => {
              setPreview(null);
              onChange(null, true);
            }}
          >
            <Trash2 aria-hidden className="size-4" /> Quitar
          </Button>
        ) : null}
      </div>
      <p className="text-sm text-muted">{hint ?? 'JPG, PNG o WebP, hasta 5 MB.'}</p>
      {error ? <p role="alert" className="text-sm font-medium text-danger">{error}</p> : null}
    </div>
  );
}
