import BangkaShell from "@/app/(app)/bangka/BangkaShell";

export const dynamic = "force-dynamic";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <BangkaShell>{children}</BangkaShell>;
}
