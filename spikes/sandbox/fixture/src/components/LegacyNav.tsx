// Componente estilo Pages Router: exercita next/router, next/head e next/dynamic.
import Head from 'next/head';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
import Link from 'next/link';

const Lazy = dynamic(() => import('@/components/StatTile').then((m) => m.StatTile), { ssr: false });

export default function LegacyNav() {
  const router = useRouter();
  return (
    <nav className="flex gap-4 bg-agz p-4 text-white" data-testid="legacy">
      <Head>
        <title>ignorado</title>
      </Head>
      <span data-testid="path">{router.asPath}</span>
      <Link href={{ pathname: '/blog', query: { p: 2 } }} data-testid="link">Blog</Link>
      <button data-testid="push" onClick={() => router.push('/x?y=1')}>push</button>
      <Lazy stat={{ label: 'lazy', value: '1', delta: 0.1 }} />
    </nav>
  );
}
