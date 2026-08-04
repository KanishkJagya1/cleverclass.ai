import Link from "next/link";
import { Button } from "@/components/ui/button";
import { MeshBackground } from "@/components/motion";

export default function NotFound() {
  return (
    <div className="relative isolate flex min-h-[60vh] items-center justify-center px-[var(--gutter)] py-20 text-center">
      <MeshBackground />
      <div className="max-w-md">
        <p className="font-[family-name:var(--font-display)] text-[length:var(--text-5xl)] font-bold text-[color:var(--text-brand)]">
          404
        </p>
        <h1 className="mt-4 text-[length:var(--text-2xl)]">We couldn&apos;t find that page</h1>
        <p className="mt-3 text-[length:var(--text-body)] text-[color:var(--text-2)]">
          The link may be out of date. Try searching, or start from your class.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Button asChild>
            <Link href="/class">Shop by class</Link>
          </Button>
          <Button asChild variant="secondary">
            <Link href="/">Back home</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
