"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ExternalLink, Plus, Trash2 } from "lucide-react";
import { MEDIUMS } from "@/constants/catalog";
import { useMasters } from "@/features/admin/use-masters";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label, Textarea } from "@/components/ui/primitives";
import { adminFetch, AdminApiError, type AdminBook } from "./api";
import { useAdminAuth } from "./auth-context";
import { slugify } from "@/lib/utils";

/**
 * Mirrors the server's BookIn model. Both sides validate: the client so the
 * user gets an inline message, the server because a client check is a
 * convenience and never a control.
 */
const schema = z.object({
  slug: z
    .string()
    .min(1, "A slug is required")
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Lowercase letters, numbers and single hyphens only"),
  title: z.string().min(1, "A title is required").max(300),
  titleMr: z.string().max(300).optional(),
  series: z.string().min(1),
  board: z.string().min(1),
  classId: z.string().min(1),
  medium: z.string().min(1),
  subject: z.string().min(1, "A subject is required"),
  stream: z.string().optional(),
  price: z.coerce.number().int().min(0, "Price cannot be negative").max(100000),
  mrp: z.coerce.number().int().min(0).max(100000).optional(),
  physicalAvailable: z.boolean().default(true),
  ebookAvailable: z.boolean().default(false),
  // Optional, and validated against the availability flag below rather than
  // here: an e-book with no price is a mistake, but only once it is offered.
  ebookPrice: z.coerce.number().int().min(0).max(100000).optional(),
  pages: z.coerce.number().int().min(0).max(5000),
  isbn: z.string().max(40).optional(),
  edition: z.string().max(100),
  description: z.string().max(8000),
  highlights: z.array(z.object({ value: z.string().max(200) })).max(20),
  marketingCopy: z.string().max(4000),
  chapterList: z.array(z.object({ value: z.string().max(200) })).max(200),
  inStock: z.boolean(),
  stockQty: z.union([z.coerce.number().int().min(0).max(1000000), z.literal("")]).optional(),
  status: z.enum(["draft", "published", "archived"]),
  publishedAt: z.string().max(40),
});

type Values = z.infer<typeof schema>;

const EMPTY: Values = {
  slug: "",
  title: "",
  titleMr: "",
  series: "kohinoor",
  board: "state",
  classId: "10",
  medium: "marathi",
  subject: "",
  stream: "",
  price: 0,
  mrp: undefined,
  physicalAvailable: true,
  ebookAvailable: false,
  ebookPrice: undefined,
  pages: 0,
  isbn: "",
  edition: "",
  description: "",
  highlights: [],
  marketingCopy: "",
  chapterList: [],
  inStock: true,
  stockQty: "",
  status: "draft",
  publishedAt: "",
};

function toValues(book: AdminBook): Values {
  return {
    slug: book.slug,
    title: book.title,
    titleMr: book.titleMr ?? "",
    series: book.series,
    board: book.board,
    classId: book.classId,
    medium: book.medium,
    subject: book.subject,
    stream: book.stream ?? "",
    price: book.price,
    mrp: book.mrp ?? undefined,
    physicalAvailable: book.physicalAvailable ?? true,
    ebookAvailable: book.ebookAvailable ?? false,
    ebookPrice: book.ebookPrice ?? undefined,
    pages: book.pages,
    isbn: book.isbn ?? "",
    edition: book.edition,
    description: book.description,
    highlights: book.highlights.map((value) => ({ value })),
    marketingCopy: book.marketingCopy,
    chapterList: book.chapterList.map((value) => ({ value })),
    inStock: book.inStock,
    stockQty: book.stockQty ?? "",
    status: book.status,
    publishedAt: book.publishedAt,
  };
}

/** A repeatable list of short strings — highlights and chapters. */
function StringList({
  label,
  hint,
  name,
  control,
  register,
  addLabel,
}: {
  label: string;
  hint?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  name: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  control: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register: any;
  addLabel: string;
}) {
  const { fields, append, remove } = useFieldArray({ control, name });
  return (
    <div>
      <Label>{label}</Label>
      {hint && (
        <p className="mb-2 text-[length:var(--text-xs)] text-[color:var(--text-3)]">{hint}</p>
      )}
      <ul className="space-y-2">
        {fields.map((field, i) => (
          <li key={field.id} className="flex gap-2">
            <Input {...register(`${name}.${i}.value`)} aria-label={`${label} ${i + 1}`} />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => remove(i)}
              aria-label={`Remove ${label.toLowerCase()} ${i + 1}`}
              className="shrink-0"
            >
              <Trash2 className="size-4" aria-hidden />
            </Button>
          </li>
        ))}
      </ul>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="mt-2"
        onClick={() => append({ value: "" })}
      >
        <Plus className="size-4" aria-hidden />
        {addLabel}
      </Button>
    </div>
  );
}

export function BookForm({ book }: { book?: AdminBook }) {
  const router = useRouter();
  const { csrf } = useAdminAuth();
  const [failure, setFailure] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    mode: "onBlur",
    defaultValues: book ? toValues(book) : EMPTY,
  });

  const title = watch("title");
  const slug = watch("slug");
  const classId = watch("classId");
  const ebookOn = watch("ebookAvailable");

  const { masters } = useMasters();

  // Streams declare which classes they belong to, so the picker narrows to the
  // class on the form. A stream with no declared classes is shown everywhere
  // rather than nowhere — an unconfigured master should not silently vanish.
  const streamOptions = React.useMemo(
    () =>
      masters.stream.filter(
        (s) => s.appliesTo.length === 0 || s.appliesTo.includes(classId),
      ),
    [masters.stream, classId],
  );

  // Suggest a slug from the title, but only while creating and only until the
  // user edits it themselves — silently rewriting the slug of a live book
  // would break its URL and every link to it.
  React.useEffect(() => {
    if (book) return;
    if (!title) return;
    const suggested = slugify(title);
    if (!slug || slug === slugify(title.slice(0, title.length - 1))) {
      setValue("slug", suggested, { shouldValidate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, book]);

  // Warn before losing edits — this form is long enough to be worth protecting.
  React.useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);

  const submit = async (values: Values) => {
    setFailure(null);
    setSaved(false);
    const payload = {
      ...values,
      titleMr: values.titleMr || null,
      stream: values.stream || null,
      isbn: values.isbn || null,
      mrp: values.mrp === undefined || Number.isNaN(values.mrp) ? null : values.mrp,
      stockQty: values.stockQty === "" ? null : values.stockQty,
      highlights: values.highlights.map((h) => h.value).filter(Boolean),
      chapterList: values.chapterList.map((c) => c.value).filter(Boolean),
    };

    try {
      if (book) {
        await adminFetch(`/books/${book.slug}`, { method: "PUT", body: payload, csrf });
        setSaved(true);
        if (payload.slug !== book.slug) router.replace(`/admin/books/${payload.slug}`);
        else router.refresh();
      } else {
        await adminFetch("/books", { method: "POST", body: payload, csrf });
        router.replace(`/admin/books/${payload.slug}`);
      }
    } catch (err) {
      setFailure(
        err instanceof AdminApiError
          ? err.isConflict
            ? `The slug "${payload.slug}" is already taken.`
            : err.message
          : "Could not save. Please try again.",
      );
    }
  };

  const cls = "space-y-4 surface-card p-5";

  return (
    <form onSubmit={handleSubmit(submit)} noValidate className="pb-24">
      <div className="grid gap-5 lg:grid-cols-2">
        {/* ---------------------------------------------------- identity -- */}
        <section className={cls}>
          <h2 className="text-[length:var(--text-base)] font-semibold text-[color:var(--text-1)]">
            Identity
          </h2>
          <div>
            <Label htmlFor="title">Title</Label>
            <Input id="title" {...register("title")} />
            <FieldError>{errors.title?.message}</FieldError>
          </div>
          <div>
            <Label htmlFor="titleMr">Marathi title (optional)</Label>
            <Input id="titleMr" lang="mr" {...register("titleMr")} />
          </div>
          <div>
            <Label htmlFor="slug">Slug</Label>
            <Input id="slug" {...register("slug")} />
            <p className="mt-1 text-[length:var(--text-xs)] text-[color:var(--text-3)]">
              The public URL: /shop/{slug || "…"}
              {book && " — changing this breaks existing links."}
            </p>
            <FieldError>{errors.slug?.message}</FieldError>
          </div>
        </section>

        {/* ------------------------------------------------ classification */}
        <section className={cls}>
          <h2 className="text-[length:var(--text-base)] font-semibold text-[color:var(--text-1)]">
            Classification
          </h2>
          <p className="text-[length:var(--text-xs)] text-[color:var(--text-3)]">
            Class and medium decide what the assistant recommends. A wrong
            medium here is the single most expensive mistake on this form.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="classId">Class</Label>
              <select id="classId" {...register("classId")} className="admin-select">
                {masters.class.map((c) => (
                  <option key={c.code} value={c.code}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="medium">Medium</Label>
              <select id="medium" {...register("medium")} className="admin-select">
                {MEDIUMS.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="series">Series</Label>
              <select id="series" {...register("series")} className="admin-select">
                {masters.series.map((s) => (
                  <option key={s.code} value={s.code}>{s.label}</option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="board">Board</Label>
              <select id="board" {...register("board")} className="admin-select">
                {masters.board.map((b) => (
                  <option key={b.code} value={b.code}>{b.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <Label htmlFor="subject">Subject</Label>
            <Input id="subject" list="subject-options" {...register("subject")} />
            <datalist id="subject-options">
              {masters.subject.map((s) => (
                <option key={s.code} value={s.code} />
              ))}
            </datalist>
            <FieldError>{errors.subject?.message}</FieldError>
          </div>
          <div>
            <Label htmlFor="stream">Stream (Classes 11–12 only)</Label>
            <select id="stream" {...register("stream")} className="admin-select">
              <option value="">None</option>
              {/* Only the streams declared for the class currently selected —
                  offering a Class 11 stream on a Class 6 book is how bad data
                  gets entered by an honest mistake. */}
              {streamOptions.map((s) => (
                <option key={s.code} value={s.code}>{s.label}</option>
              ))}
            </select>
          </div>
        </section>

        {/* --------------------------------------------------- commercial */}
        <section className={cls}>
          <h2 className="text-[length:var(--text-base)] font-semibold text-[color:var(--text-1)]">
            Price and stock
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="price">Selling price (₹)</Label>
              <Input id="price" type="number" inputMode="numeric" {...register("price")} />
              <FieldError>{errors.price?.message}</FieldError>
            </div>
            <div>
              <Label htmlFor="mrp">Printed MRP (₹)</Label>
              <Input id="mrp" type="number" inputMode="numeric" {...register("mrp")} />
              <p className="mt-1 text-[length:var(--text-xs)] text-[color:var(--text-3)]">
                Leave blank if there is no discount.
              </p>
            </div>
          </div>

          <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--border-1)] p-3">
            <p className="text-[length:var(--text-sm)] font-medium text-[color:var(--text-1)]">
              How is this sold?
            </p>
            <p className="mb-3 text-[length:var(--text-xs)] text-[color:var(--text-3)]">
              A title can be sold in print, as a download, or both — each with
              its own price. E-books are never charged delivery and never use
              stock.
            </p>
            <div className="space-y-2">
              <label className="flex min-h-11 items-center gap-2 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
                <input type="checkbox" {...register("physicalAvailable")} />
                Printed copy
              </label>
              <label className="flex min-h-11 items-center gap-2 text-[length:var(--text-sm)] text-[color:var(--text-2)]">
                <input type="checkbox" {...register("ebookAvailable")} />
                E-book (download)
              </label>
            </div>
            {ebookOn ? (
              <div className="mt-3">
                <Label htmlFor="ebookPrice">E-book price (₹)</Label>
                <Input
                  id="ebookPrice"
                  type="number"
                  inputMode="numeric"
                  {...register("ebookPrice")}
                />
                <p className="mt-1 text-[length:var(--text-xs)] text-[color:var(--text-3)]">
                  {/* Said here because the backend refuses the sale rather
                      than falling back to the print price. */}
                  Required — without it the e-book cannot be bought, whatever
                  this checkbox says.
                </p>
              </div>
            ) : null}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="pages">Total pages</Label>
              <Input id="pages" type="number" inputMode="numeric" {...register("pages")} />
            </div>
            <div>
              <Label htmlFor="stockQty">Stock quantity</Label>
              <Input id="stockQty" type="number" inputMode="numeric" {...register("stockQty")} />
              <p className="mt-1 text-[length:var(--text-xs)] text-[color:var(--text-3)]">
                Blank = not tracked.
              </p>
            </div>
          </div>
          <label className="flex min-h-11 cursor-pointer items-center gap-2.5">
            <input type="checkbox" {...register("inStock")} className="size-4 accent-[var(--brand-base)]" />
            <span className="text-[length:var(--text-sm)] text-[color:var(--text-2)]">
              In stock — out-of-stock books are never recommended by the assistant
            </span>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="isbn">ISBN</Label>
              <Input id="isbn" {...register("isbn")} />
            </div>
            <div>
              <Label htmlFor="edition">Edition</Label>
              <Input id="edition" placeholder="2026 Edition" {...register("edition")} />
            </div>
          </div>
        </section>

        {/* --------------------------------------------------- publishing */}
        <section className={cls}>
          <h2 className="text-[length:var(--text-base)] font-semibold text-[color:var(--text-1)]">
            Publishing
          </h2>
          <div>
            <Label htmlFor="status">Status</Label>
            <select id="status" {...register("status")} className="admin-select">
              <option value="draft">Draft — not visible to anyone</option>
              <option value="published">Published — live on the storefront</option>
              <option value="archived">Archived — removed from sale</option>
            </select>
          </div>
          <div>
            <Label htmlFor="publishedAt">Publication date</Label>
            <Input id="publishedAt" type="date" {...register("publishedAt")} />
          </div>
          {book && (
            <div className="rounded-[var(--radius-md)] bg-[var(--surface-0)] p-3 text-[length:var(--text-xs)] text-[color:var(--text-2)]">
              <p>
                Free sample:{" "}
                {book.asset
                  ? book.asset.processState === "ready"
                    ? `PDF ready (${book.asset.pageCount} pages), ${book.freeRanges.length} free range(s)`
                    : `PDF ${book.asset.processState}`
                  : "no PDF uploaded yet"}
              </p>
              {book.status === "published" && (
                <Link
                  href={`/shop/${book.slug}`}
                  target="_blank"
                  className="mt-2 inline-flex items-center gap-1 font-medium text-[color:var(--text-brand)]"
                >
                  View on the storefront
                  <ExternalLink className="size-3" aria-hidden />
                </Link>
              )}
            </div>
          )}
        </section>

        {/* ------------------------------------------------------- content */}
        <section className={`${cls} lg:col-span-2`}>
          <h2 className="text-[length:var(--text-base)] font-semibold text-[color:var(--text-1)]">
            Description and selling points
          </h2>
          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" rows={4} {...register("description")} />
          </div>
          <div>
            <Label htmlFor="marketingCopy">Assistant sales copy</Label>
            <Textarea id="marketingCopy" rows={3} {...register("marketingCopy")} />
            <p className="mt-1 text-[length:var(--text-xs)] text-[color:var(--text-3)]">
              How you would pitch this book to a parent. The assistant reads
              this — it never reads the book itself.
            </p>
          </div>
          <StringList
            label="Highlights"
            hint="Shown as bullets on the product page."
            name="highlights"
            control={control}
            register={register}
            addLabel="Add highlight"
          />
          <StringList
            label="Chapter list"
            hint={
              "What this book covers, chapter by chapter. This is how the assistant answers " +
              '"does it cover trigonometry?" without ever reading a page of the book.'
            }
            name="chapterList"
            control={control}
            register={register}
            addLabel="Add chapter"
          />
        </section>
      </div>

      {/* Sticky save bar — this form is long, and a save button at the bottom
          of a 2-screen form is a save button nobody finds. */}
      <div className="fixed inset-x-0 bottom-0 z-[var(--z-sticky)] border-t border-[var(--border-1)] bg-[var(--surface-1)] px-4 py-3">
        <div className="mx-auto flex max-w-[90rem] items-center gap-3">
          <div className="min-w-0 flex-1 text-[length:var(--text-sm)]">
            {failure ? (
              <span role="alert" className="text-[color:var(--signal-danger)]">{failure}</span>
            ) : saved ? (
              <span className="text-[color:var(--signal-gain)]">Saved.</span>
            ) : isDirty ? (
              <span className="text-[color:var(--text-3)]">Unsaved changes</span>
            ) : null}
          </div>
          <Button asChild variant="secondary" size="sm">
            <Link href="/admin/books">Cancel</Link>
          </Button>
          <Button type="submit" loading={isSubmitting}>
            {book ? "Save changes" : "Create book"}
          </Button>
        </div>
      </div>
    </form>
  );
}
