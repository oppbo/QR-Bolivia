import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/primitives';
import { ProductForm, variantFromRow } from '@/features/products/product-form';
import { requireBusiness } from '@/lib/auth/session';
import { signedImageUrl } from '@/lib/storage/images';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Editar producto' };

export default async function EditProductPage({ params }: PageProps<'/app/products/[id]/edit'>) {
  const { id } = await params;
  await requireBusiness(`/app/products/${id}/edit`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const [{ data: product }, { data: variants }] = await Promise.all([
    supabase.from('products').select('*').eq('id', id).maybeSingle(),
    supabase.from('product_variants').select('*').eq('product_id', id).is('archived_at', null).order('position').order('created_at'),
  ]);
  if (!product) notFound();
  const imageUrl = await signedImageUrl(supabase, product.image_path);
  return (
    <>
      <PageHeader title="Editar producto" back={<Link href={`/app/products/${id}`} className="mb-1 inline-block text-primary underline">{product.name}</Link>} />
      <ProductForm
        initial={{
          id: product.id,
          revision: product.revision,
          name: product.name,
          description: product.description ?? '',
          category: product.category ?? '',
          imageUrl,
          variants: (variants ?? []).map(variantFromRow),
        }}
      />
    </>
  );
}
