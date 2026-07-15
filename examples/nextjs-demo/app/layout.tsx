import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './globals.css';
import { PatchbackSnippet } from './components/patchback-snippet';

export const metadata: Metadata = {
  title: 'Acme Ops — orders',
  description:
    'Fake internal ops dashboard demonstrating the Patchback feedback widget',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <PatchbackSnippet />
      </body>
    </html>
  );
}
