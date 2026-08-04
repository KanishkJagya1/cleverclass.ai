import Link from "next/link";
import { Download } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";

export default function DownloadsPage() {
  return (
    <div>
      <h1 className="text-[length:var(--text-3xl)]">Downloads</h1>
      <p className="mt-2 max-w-lg text-[length:var(--text-body)] text-[color:var(--text-2)]">
        Digital notes you&apos;ve purchased. Key Notes previews are free and need no
        account — they open directly on the notes page.
      </p>
      <div className="mt-8">
        <EmptyState
          icon={Download}
          title="No downloads yet"
          description="Purchased digital notes will appear here."
          action={
            <Button asChild variant="secondary" size="sm">
              <Link href="/key-notes">Preview key notes free</Link>
            </Button>
          }
        />
      </div>
    </div>
  );
}
