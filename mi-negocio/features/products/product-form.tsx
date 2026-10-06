'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { ImagePicker } from '@/components/image-picker';
import { confirmDiscard, useUnsavedChangesWarning } from '@/components/use-unsaved';
import { Alert, Button, Card, cx, describedBy, Field, Input, Textarea } from '@/components/ui/primitives';
import { SubmitButton } from '@/components/ui/submit-button';
import { centsToInput } from '@/lib/money/money';
import { saveProduct } from './actions';

export interface VariantDraft {
  key: string;
  id?: string;
  remove?: boolean;
  sku: string;
  size: string;
  color: string;
  price: string;
  cost: string;
  track_inventory: boolean;
  initial_stock: string;
  low_stock_threshold: string;
  reserved?: number;
  on_hand?: number;
}

export interface ProductDraft {
  id?: string;
  revision?: number;
  name: string;
  description: string;
  category: string;
  imageUrl?: string | null;
  variants: VariantDraft[];
}

let counter = 0;
const newKey = () => `v${Date.now()}-${counter++}`;

export function emptyVariant(): VariantDraft {
  return { key: newKey(), sku: '', size: '', color: '', price: '', cost: '', track_inventory: true, initial_stock: '0', low_stock_threshold: '2' };
}

export function variantFromRow(v: {
  id: string;
  sku: string | null;
  size: string | null;
  color: string | null;
  price_cents: number;
  cost_cents: number | null;
  track_inventory: boolean;
  low_stock_threshold: number;
  reserved: number;
  on_hand: number;
}): VariantDraft {
  return {
    key: v.id,
    id: v.id,
    sku: v.sku ?? '',
    size: v.size ?? '',
    color: v.color ?? '',
    price: centsToInput(v.price_cents),
    cost: v.cost_cents == null ? '' : centsToInput(v.cost_cents),
    track_inventory: v.track_inventory,
    initial_stock: '0',
    low_stock_threshold: String(v.low_stock_threshold),
    reserved: v.reserved,
    on_hand: v.on_hand,
  };
}

export function ProductForm({ initial }: { initial: ProductDraft }) {
  const router = useRouter();
  const [draft, setDraft] = useState<ProductDraft>(initial);
  const [image, setImage] = useState<File | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  useUnsavedChangesWarning(dirty && !pending);

  const update = (patch: Partial<ProductDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
  };
  const updateVariant = (key: string, patch: Partial<VariantDraft>) => {
    setDraft((d) => ({ ...d, variants: d.variants.map((v) => (v.key === key ? { ...v, ...patch } : v)) }));
    setDirty(true);
  };
  const visible = draft.variants.filter((v) => !v.remove);

  function removeVariant(v: VariantDraft) {
    if (visible.length <= 1) return;
    if (v.id) updateVariant(v.key, { remove: true });
    else {
      setDraft((d) => ({ ...d, variants: d.variants.filter((x) => x.key !== v.key) }));
      setDirty(true);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    const payload = {
      id: draft.id,
      expected_revision: draft.revision,
      name: draft.name,
      description: draft.description,
      category: draft.category,
      remove_image: removeImage,
      variants: draft.variants.map(({ id, remove, sku, size, color, price, cost, track_inventory, initial_stock, low_stock_threshold }) => ({
        ...(id ? { id } : {}),
        remove,
        sku,
        size,
        color,
        price,
        cost,
        track_inventory,
        initial_stock: id ? '' : initial_stock,
        low_stock_threshold,
      })),
    };
    const fd = new FormData();
    fd.set('payload', JSON.stringify(payload));
    if (image) fd.set('image', image);
    startTransition(async () => {
      const result = await saveProduct(fd).catch(() => null);
      if (!result) {
        setError('No pudimos guardar los cambios. Tus datos siguen en el formulario.');
        return;
      }
      if (!result.ok) {
        setError(result.error);
        setFieldErrors(result.fieldErrors ?? {});
        return;
      }
      setDirty(false);
      router.push(`/app/products/${result.data.id}`);
      router.refresh();
    });
  }

  // Los errores del servidor usan el índice de la variante en el arreglo enviado.
  const vErr = (key: string, field: string) => {
    const index = draft.variants.findIndex((v) => v.key === key);
    return fieldErrors[`variants.${index}.${field}`];
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5 pb-24">
      {error ? (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      ) : null}
      <Card className="flex flex-col gap-4">
        <Field id="name" label="Nombre" error={fieldErrors.name}>
          <Input
            id="name"
            value={draft.name}
            onChange={(e) => update({ name: e.target.value })}
            required
            maxLength={120}
            aria-invalid={fieldErrors.name ? true : undefined}
            aria-describedby={describedBy('name', { error: fieldErrors.name })}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="category" label="Categoría" optional error={fieldErrors.category}>
            <Input id="category" value={draft.category} onChange={(e) => update({ category: e.target.value })} maxLength={60} placeholder="Ej.: Poleras" />
          </Field>
        </div>
        <Field id="description" label="Descripción" optional error={fieldErrors.description}>
          <Textarea id="description" value={draft.description} onChange={(e) => update({ description: e.target.value })} maxLength={1000} rows={3} />
        </Field>
        <ImagePicker
          label="Foto"
          currentUrl={draft.imageUrl}
          onChange={(file, remove) => {
            setImage(file);
            setRemoveImage(remove);
            setDirty(true);
          }}
        />
        {fieldErrors.image ? <p className="text-sm font-medium text-danger">{fieldErrors.image}</p> : null}
      </Card>

      <section aria-labelledby="variants-title" className="flex flex-col gap-3">
        <div>
          <h2 id="variants-title" className="text-lg font-semibold">
            Variantes
          </h2>
          <p className="text-muted">Cada combinación de talla y color se vende y se controla por separado. Si no hay opciones, dejá talla y color vacíos.</p>
        </div>
        {visible.map((v, i) => (
          <Card key={v.key} className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-semibold">Variante {i + 1}</h3>
              {visible.length > 1 ? (
                <Button
                  variant="ghost"
                  onClick={() => removeVariant(v)}
                  disabled={(v.reserved ?? 0) > 0}
                  title={(v.reserved ?? 0) > 0 ? 'Tiene unidades reservadas en pedidos' : undefined}
                >
                  <Trash2 aria-hidden className="size-4" /> Quitar
                </Button>
              ) : null}
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Field id={`${v.key}-size`} label="Talla" optional error={vErr(v.key, 'size')}>
                <Input id={`${v.key}-size`} value={v.size} onChange={(e) => updateVariant(v.key, { size: e.target.value })} maxLength={40} placeholder="M" />
              </Field>
              <Field id={`${v.key}-color`} label="Color" optional error={vErr(v.key, 'color')}>
                <Input id={`${v.key}-color`} value={v.color} onChange={(e) => updateVariant(v.key, { color: e.target.value })} maxLength={40} placeholder="Negro" />
              </Field>
              <Field id={`${v.key}-sku`} label="SKU" optional error={vErr(v.key, 'sku')} className="col-span-2 sm:col-span-1">
                <Input id={`${v.key}-sku`} value={v.sku} onChange={(e) => updateVariant(v.key, { sku: e.target.value })} maxLength={60} />
              </Field>
              <Field id={`${v.key}-price`} label="Precio de venta (Bs)" error={vErr(v.key, 'price')}>
                <Input
                  id={`${v.key}-price`}
                  inputMode="decimal"
                  value={v.price}
                  onChange={(e) => updateVariant(v.key, { price: e.target.value })}
                  placeholder="80.00"
                  aria-invalid={vErr(v.key, 'price') ? true : undefined}
                  aria-describedby={describedBy(`${v.key}-price`, { error: vErr(v.key, 'price') })}
                />
              </Field>
              <Field id={`${v.key}-cost`} label="Costo (Bs)" optional hint="Vacío = costo desconocido." error={vErr(v.key, 'cost')}>
                <Input
                  id={`${v.key}-cost`}
                  inputMode="decimal"
                  value={v.cost}
                  onChange={(e) => updateVariant(v.key, { cost: e.target.value })}
                  aria-describedby={describedBy(`${v.key}-cost`, { hint: true, error: vErr(v.key, 'cost') })}
                />
              </Field>
            </div>
            <label className="flex min-h-11 items-center gap-3">
              <input
                type="checkbox"
                className="size-5 accent-[var(--color-primary)]"
                checked={v.track_inventory}
                disabled={v.track_inventory && (v.reserved ?? 0) > 0}
                onChange={(e) => updateVariant(v.key, { track_inventory: e.target.checked })}
              />
              <span>
                Controlar stock
                {v.track_inventory && (v.reserved ?? 0) > 0 ? (
                  <span className="block text-sm text-muted">No se puede desactivar: hay {v.reserved} reservadas en pedidos.</span>
                ) : null}
              </span>
            </label>
            {v.track_inventory ? (
              <div className="grid grid-cols-2 gap-4">
                {!v.id ? (
                  <Field id={`${v.key}-stock`} label="Stock inicial" error={vErr(v.key, 'initial_stock')}>
                    <Input
                      id={`${v.key}-stock`}
                      inputMode="numeric"
                      value={v.initial_stock}
                      onChange={(e) => updateVariant(v.key, { initial_stock: e.target.value })}
                    />
                  </Field>
                ) : (
                  <div className="text-sm text-muted">
                    <p className="font-medium text-ink">En existencia: {v.on_hand}</p>
                    <p>Para cambiar el stock usá «Ajustar stock» en el detalle del producto.</p>
                  </div>
                )}
                <Field id={`${v.key}-low`} label="Avisar con stock bajo en" hint="unidades disponibles" error={vErr(v.key, 'low_stock_threshold')}>
                  <Input
                    id={`${v.key}-low`}
                    inputMode="numeric"
                    value={v.low_stock_threshold}
                    onChange={(e) => updateVariant(v.key, { low_stock_threshold: e.target.value })}
                  />
                </Field>
              </div>
            ) : null}
          </Card>
        ))}
        <div>
          <Button
            variant="secondary"
            onClick={() => {
              setDraft((d) => ({ ...d, variants: [...d.variants, emptyVariant()] }));
              setDirty(true);
            }}
          >
            <Plus aria-hidden className="size-4" /> Agregar variante
          </Button>
        </div>
      </section>

      <div className="pb-safe fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-20 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur lg:static lg:border-0 lg:bg-transparent lg:p-0">
        <div className="mx-auto flex max-w-5xl gap-2 lg:justify-end">
          <Button
            variant="secondary"
            className={cx('flex-1 lg:flex-none')}
            onClick={() => {
              if (confirmDiscard(dirty)) router.back();
            }}
          >
            Cancelar
          </Button>
          <SubmitButton pending={pending} className="flex-1 lg:flex-none">
            {draft.id ? 'Guardar cambios' : 'Guardar producto'}
          </SubmitButton>
        </div>
      </div>
    </form>
  );
}
