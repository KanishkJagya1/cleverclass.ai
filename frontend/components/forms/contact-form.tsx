"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Check, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label, Textarea } from "@/components/ui/primitives";

const schema = z.object({
  name: z.string().min(2, "Enter your name"),
  email: z.string().email("Enter a valid email"),
  phone: z
    .string()
    .regex(/^[6-9]\d{9}$/, "Enter a 10-digit Indian mobile number")
    .optional()
    .or(z.literal("")),
  topic: z.enum(["order", "product", "bulk", "other"]),
  message: z.string().min(10, "Tell us a little more — at least 10 characters"),
});
type Values = z.infer<typeof schema>;

const TOPICS = [
  { value: "order", label: "An order I placed" },
  { value: "product", label: "Which book to buy" },
  { value: "bulk", label: "Bulk / school supply" },
  { value: "other", label: "Something else" },
] as const;

/**
 * Validation fires on blur, not on keystroke. Live keystroke validation shows
 * an error before the user has finished typing their own email address, which
 * reads as the form arguing with them.
 */
export function ContactForm() {
  const [sent, setSent] = React.useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), mode: "onBlur", defaultValues: { topic: "product" } });

  if (sent) {
    return (
      <div className="glass-panel glass-edge p-8 text-center" role="status">
        <span className="mx-auto grid size-12 place-items-center rounded-full bg-[var(--signal-gain-soft)] text-[var(--signal-gain)]">
          <Check className="size-5" aria-hidden />
        </span>
        <h2 className="mt-5 font-[family-name:var(--font-display)] text-[length:var(--text-xl)] font-semibold text-[var(--text-1)]">
          Message sent
        </h2>
        <p className="mt-2 text-[length:var(--text-sm)] text-[var(--text-2)]">
          We reply within one working day. For anything urgent, call us — the
          numbers are on the right.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit(async () => {
        // ponytail: no transport wired. Point at a route handler or a form
        // service; the schema is the contract either way.
        await new Promise((r) => setTimeout(r, 600));
        setSent(true);
      })}
      className="glass-panel glass-edge p-6 md:p-8"
      noValidate
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="c-name">Your name</Label>
          <Input id="c-name" autoComplete="name" {...register("name")} />
          <FieldError>{errors.name?.message}</FieldError>
        </div>
        <div>
          <Label htmlFor="c-email">Email</Label>
          <Input id="c-email" type="email" autoComplete="email" {...register("email")} />
          <FieldError>{errors.email?.message}</FieldError>
        </div>
        <div>
          <Label htmlFor="c-phone">Mobile (optional)</Label>
          <Input id="c-phone" inputMode="numeric" autoComplete="tel" {...register("phone")} />
          <FieldError>{errors.phone?.message}</FieldError>
        </div>
        <div>
          <Label htmlFor="c-topic">What is this about?</Label>
          <select
            id="c-topic"
            {...register("topic")}
            className="h-11 w-full rounded-[var(--radius-md)] border border-[var(--border-1)] bg-[var(--surface-1)] px-3.5 text-[length:var(--text-base)] text-[var(--text-1)]"
          >
            {TOPICS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="c-message">Message</Label>
          <Textarea id="c-message" rows={5} {...register("message")} />
          <FieldError>{errors.message?.message}</FieldError>
        </div>
      </div>

      <Button type="submit" size="lg" className="mt-6" loading={isSubmitting}>
        <Send className="size-4" aria-hidden />
        Send message
      </Button>
    </form>
  );
}
