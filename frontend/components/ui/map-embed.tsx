"use client";

import * as React from "react";
import { MapPin } from "lucide-react";
import { SITE } from "@/constants/catalog";
import { Button } from "./button";

/**
 * Click-to-load.
 *
 * An eager Google Maps iframe costs roughly 800 KB, several third-party
 * requests and a cookie on every contact-page view — for a map most visitors
 * never look at. This renders a static placeholder and only mounts the iframe
 * when someone actually wants it.
 */
export function MapEmbed() {
  const [loaded, setLoaded] = React.useState(false);
  const query = encodeURIComponent(
    `${SITE.legalName}, ${SITE.address.street}, ${SITE.address.city}, ${SITE.address.postalCode}`,
  );

  return (
    <div className="surface-card overflow-hidden">
      <div className="relative aspect-[4/3] bg-[var(--surface-0)]">
        {loaded ? (
          <iframe
            title={`Map showing ${SITE.legalName} in ${SITE.address.city}`}
            src={`https://maps.google.com/maps?q=${query}&output=embed`}
            className="absolute inset-0 size-full border-0"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
            {/* Cheap abstract map texture — no network request. */}
            <div
              aria-hidden
              className="absolute inset-0 opacity-[0.07]"
              style={{
                backgroundImage:
                  "linear-gradient(var(--text-1) 1px, transparent 1px), linear-gradient(90deg, var(--text-1) 1px, transparent 1px)",
                backgroundSize: "28px 28px",
              }}
            />
            <MapPin className="relative size-6 text-[color:var(--brand-base)]" aria-hidden />
            <p className="relative text-[length:var(--text-sm)] text-[color:var(--text-2)]">
              {SITE.address.street}, {SITE.address.city}
            </p>
            <Button size="sm" variant="secondary" onClick={() => setLoaded(true)} className="relative">
              Load map
            </Button>
            <p className="relative text-[length:var(--text-2xs)] text-[color:var(--text-3)]">
              Loads Google Maps and sets third-party cookies
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
