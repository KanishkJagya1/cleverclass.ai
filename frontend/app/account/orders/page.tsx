import { ShoppingBag } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

export default function OrdersPage() {
  return (
    <div>
      <h1 className="text-[length:var(--text-3xl)]">Orders</h1>
      <p className="mt-2 text-[length:var(--text-body)] text-[color:var(--text-2)]">
        Every order you place, with its delivery status.
      </p>
      <div className="mt-8">
        <EmptyState
          icon={ShoppingBag}
          title="No orders yet"
          description="Order history appears here once order management is connected to the backend."
          action={{ label: "Start shopping", href: "/shop" }}
        />
      </div>
    </div>
  );
}
