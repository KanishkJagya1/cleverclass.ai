"use client";

import { AdminPageHeader } from "@/features/admin/shell";
import { BookForm } from "@/features/admin/book-form";

export default function NewBookPage() {
  return (
    <>
      <AdminPageHeader
        title="Add a book"
        description="Create the record first, then upload its PDF and mark the free pages."
      />
      <BookForm />
    </>
  );
}
