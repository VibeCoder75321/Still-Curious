import type { ReactNode } from "react";

export const metadata = {
  title: "Still Curious",
  description: "A calm, personal audio story for bedtime.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
