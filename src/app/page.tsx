'use client';

import dynamic from 'next/dynamic';

// Codice is a fully client-side application (localStorage, File System
// Access API, Shiki, jsPDF, docx). It must never run on the server.
const CodiceApp = dynamic(() => import('@/components/CodiceApp'), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen items-center justify-center bg-[#0d1117] text-[#e6edf3]">
      <div className="flex items-center gap-3">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-[#30363d] border-t-[#2f81f7]" />
        <span className="text-sm">Loading Codice…</span>
      </div>
    </div>
  ),
});

export default function Home() {
  return <CodiceApp />;
}
