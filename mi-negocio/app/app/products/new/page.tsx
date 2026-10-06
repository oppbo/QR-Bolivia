import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/ui/primitives';
import { emptyVariant, ProductForm } from '@/features/products/product-form';
import { requireBusiness } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'Nuevo producto' };

export default async function NewProductPage() {
  await requireBusiness('/app/products/new');
  return (
    <>
      <PageHeader title="Nuevo producto" back={<Link href="/app/products" className="mb-1 inline-block text-primary underline">Productos</Link>} />
      <ProductForm initial={{ name: '', description: '', category: '', variants: [emptyVariant()] }} />
    </>
  );
}
