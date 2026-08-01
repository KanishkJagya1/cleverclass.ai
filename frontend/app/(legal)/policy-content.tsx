import { SITE } from "@/constants/catalog";

export interface PolicyDoc {
  slug: string;
  title: string;
  description: string;
  updated: string;
  sections: { heading: string; body: string[] }[];
}

/**
 * Policy copy lives as data, not as five near-identical page files. Adding a
 * policy is one entry; changing the layout is one component.
 */
export const POLICIES: Record<string, PolicyDoc> = {
  shipping: {
    slug: "shipping",
    title: "Shipping",
    description:
      "Delivery times, charges and coverage for orders from CleverClass.AI, Nagpur.",
    updated: "1 July 2026",
    sections: [
      {
        heading: "Charges",
        body: [
          `Shipping is free on orders of ₹${SITE.freeShippingThreshold} and above. Below that, a flat ₹${SITE.flatShippingRate} applies anywhere in India.`,
          "Combo packs are priced so that most of them clear the free-shipping threshold on their own.",
        ],
      },
      {
        heading: "Delivery time",
        body: [
          "Orders within Maharashtra usually arrive in 3–5 working days.",
          "Elsewhere in India, allow 5–8 working days. Remote pincodes may take longer.",
          "Orders placed on Sunday or a public holiday are dispatched the next working day.",
        ],
      },
      {
        heading: "Dispatch",
        body: [
          `All orders ship from our Nagpur office at ${SITE.address.street}, ${SITE.address.city}.`,
          "You receive a tracking reference by SMS and email once the parcel leaves us.",
        ],
      },
      {
        heading: "Bulk and school orders",
        body: [
          `Institutional orders are shipped on separate terms. Call ${SITE.phones[0]} to arrange delivery for a school or bookshop.`,
        ],
      },
    ],
  },

  returns: {
    slug: "returns",
    title: "Returns & refunds",
    description: "How to return a book, our 7-day window, and how refunds are issued.",
    updated: "1 July 2026",
    sections: [
      {
        heading: "The window",
        body: [
          "Unused books in original condition can be returned within 7 days of delivery.",
          "Books that have been written in, highlighted or damaged cannot be returned.",
        ],
      },
      {
        heading: "If we made the mistake",
        body: [
          "If we sent the wrong title, the wrong medium or a damaged copy, we cover return shipping and send the correct book at no extra cost.",
          "Tell us within 48 hours of delivery so we can arrange the pickup quickly.",
        ],
      },
      {
        heading: "If you changed your mind",
        body: [
          "Return shipping is at your cost. Once the book reaches us in resaleable condition, we refund the item price.",
        ],
      },
      {
        heading: "Refund timing",
        body: [
          "Refunds are issued to the original payment method within 5–7 working days of the return being received and checked.",
        ],
      },
      {
        heading: "How to start a return",
        body: [
          `Email ${SITE.email} or call ${SITE.phones[0]} with your order reference. We will confirm the return address and next steps.`,
        ],
      },
    ],
  },

  privacy: {
    slug: "privacy",
    title: "Privacy policy",
    description: "What data CleverClass.AI collects, why, and how it is handled.",
    updated: "1 July 2026",
    sections: [
      {
        heading: "What we collect",
        body: [
          "When you place an order: your name, delivery address, mobile number and email. These exist so the parcel reaches you and we can contact you if there is a problem.",
          "When you subscribe: your email address only.",
          "When you use the assistant: the text of your question, so we can improve the answers. Do not enter payment details or passwords into the chat.",
        ],
      },
      {
        heading: "What we do not do",
        body: [
          "We do not sell or rent your personal data to anyone.",
          "We do not send marketing messages to customers who have not asked for them.",
        ],
      },
      {
        heading: "Storage on your device",
        body: [
          "Your cart, wishlist, board and medium preference are stored in your own browser, not on our servers. Clearing your browser data clears them.",
        ],
      },
      {
        heading: "Your rights",
        body: [
          `Email ${SITE.email} to request a copy of the data we hold about you, to correct it, or to have it deleted.`,
        ],
      },
    ],
  },

  terms: {
    slug: "terms",
    title: "Terms & conditions",
    description: "The terms that apply when you buy from CleverClass.AI.",
    updated: "1 July 2026",
    sections: [
      {
        heading: "Who you are buying from",
        body: [
          `This website is operated by ${SITE.legalName}, ${SITE.address.street}, ${SITE.address.city}, ${SITE.address.state} ${SITE.address.postalCode}.`,
        ],
      },
      {
        heading: "Prices and availability",
        body: [
          "All prices are in Indian Rupees and include applicable taxes.",
          "We try to keep availability accurate, but if an item sells out after you order it we will contact you and refund that item in full.",
        ],
      },
      {
        heading: "Editions and syllabus",
        body: [
          "Every product page states the edition year. We reprint when a board revises its syllabus, but you are responsible for checking that the edition matches what your school requires.",
        ],
      },
      {
        heading: "Copyright",
        body: [
          "All titles, key notes and preview pages are the copyright of the publisher. They may not be reproduced, resold or redistributed in any form without written permission.",
        ],
      },
      {
        heading: "Governing law",
        body: ["These terms are governed by Indian law, with jurisdiction in Nagpur, Maharashtra."],
      },
    ],
  },
};
