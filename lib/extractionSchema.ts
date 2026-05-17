import { z } from "zod";

/**
 * Extraction schemas live in two parallel forms:
 *
 *   - `*_EXTRACTION_SCHEMA`   — a zod object used in tests and type inference
 *     elsewhere in the codebase.
 *   - `*_JSON_SCHEMA`         — a plain JSON Schema object that we hand to
 *     Firecrawl. Firecrawl's JSON-format extractor accepts either a zod schema
 *     or a JSON Schema, but the bundled `@mendable/firecrawl-js` type
 *     definitions still target zod 3 internals. We're on zod 4, and the
 *     `as unknown as Record<string, unknown>` cast we used previously was
 *     emitting a schema shape the extractor did not understand — extraction
 *     silently returned an empty object on hard pages like Zillow. Sending
 *     JSON Schema avoids the zod-version mismatch entirely.
 *
 * Keep the two forms in sync. When adding a field, update both objects.
 */

// ---------------------------------------------------------------------------
// Automotive (VDP — Vehicle Detail Page)
// ---------------------------------------------------------------------------

export const EXTRACTION_SCHEMA = z.object({
  vin: z.string().nullable().optional(),
  make: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  year: z.union([z.string(), z.number()]).nullable().optional(),
  body_style: z.string().nullable().optional(),
  price: z.union([z.string(), z.number()]).nullable().optional(),
  mileage_value: z.union([z.string(), z.number()]).nullable().optional(),
  state_of_vehicle: z.string().nullable().optional(),
  exterior_color: z.string().nullable().optional(),
  trim: z.string().nullable().optional(),
  drivetrain: z.string().nullable().optional(),
  transmission: z.string().nullable().optional(),
  fuel_type: z.string().nullable().optional(),
  msrp: z.union([z.string(), z.number()]).nullable().optional(),
  image_url: z.string().nullable().optional(),
  image_url_2: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  latitude: z.union([z.string(), z.number()]).nullable().optional(),
  longitude: z.union([z.string(), z.number()]).nullable().optional(),
});

export const AUTOMOTIVE_JSON_SCHEMA = {
  type: "object",
  properties: {
    vin: { type: ["string", "null"] },
    make: { type: ["string", "null"] },
    model: { type: ["string", "null"] },
    year: { type: ["string", "number", "null"] },
    body_style: { type: ["string", "null"] },
    price: { type: ["string", "number", "null"] },
    mileage_value: { type: ["string", "number", "null"] },
    state_of_vehicle: { type: ["string", "null"] },
    exterior_color: { type: ["string", "null"] },
    trim: { type: ["string", "null"] },
    drivetrain: { type: ["string", "null"] },
    transmission: { type: ["string", "null"] },
    fuel_type: { type: ["string", "null"] },
    msrp: { type: ["string", "number", "null"] },
    image_url: { type: ["string", "null"] },
    image_url_2: { type: ["string", "null"] },
    description: { type: ["string", "null"] },
    address: { type: ["string", "null"] },
    latitude: { type: ["string", "number", "null"] },
    longitude: { type: ["string", "number", "null"] },
  },
} as const;

// ---------------------------------------------------------------------------
// Ecommerce
// ---------------------------------------------------------------------------

export const ECOMMERCE_EXTRACTION_SCHEMA = z.object({
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  price: z.union([z.string(), z.number()]).nullable().optional(),
  brand: z.string().nullable().optional(),
  condition: z.enum(["new", "used", "refurbished"]).nullable().optional(),
  availability: z.enum(["in stock", "out of stock"]).nullable().optional(),
  retailer_id: z.string().nullable().optional(),
  image_url: z.string().nullable().optional(),
  image_url_2: z.string().nullable().optional(),
  google_product_category: z.string().nullable().optional(),
});

export const ECOMMERCE_JSON_SCHEMA = {
  type: "object",
  properties: {
    title: { type: ["string", "null"] },
    description: { type: ["string", "null"] },
    price: { type: ["string", "number", "null"] },
    brand: { type: ["string", "null"] },
    condition: { type: ["string", "null"], enum: ["new", "used", "refurbished", null] },
    availability: { type: ["string", "null"], enum: ["in stock", "out of stock", null] },
    retailer_id: { type: ["string", "null"] },
    image_url: { type: ["string", "null"] },
    image_url_2: { type: ["string", "null"] },
    google_product_category: { type: ["string", "null"] },
  },
} as const;

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

export const SERVICES_EXTRACTION_SCHEMA = z.object({
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  price: z.union([z.string(), z.number()]).nullable().optional(),
  images: z.array(z.string()).nullable().optional(),
  booking_url: z.string().nullable().optional(),
  cta_text: z.string().nullable().optional(),
  brand: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
});

export const SERVICES_JSON_SCHEMA = {
  type: "object",
  properties: {
    title: { type: ["string", "null"] },
    description: { type: ["string", "null"] },
    price: { type: ["string", "number", "null"] },
    images: { type: ["array", "null"], items: { type: "string" } },
    booking_url: { type: ["string", "null"] },
    cta_text: { type: ["string", "null"] },
    brand: { type: ["string", "null"] },
    category: { type: ["string", "null"] },
    address: { type: ["string", "null"] },
  },
} as const;

export const SERVICES_EXTRACTION_PROMPT = `
Extract the following service information from this page:
- title: the service name
- description: a brief description of the service
- price: the listed price or price range as a string (e.g., "$49" or "$49 - $99")
- images: an array of all image URLs on the page
- booking_url: the link to book, schedule, or reserve the service
- cta_text: the text of the main call-to-action button (e.g., "Book Now", "Schedule Appointment")
- brand: the business or brand name
- category: the type or category of service
- address: the location or service area

Return null for any field you cannot find.
`;

// ---------------------------------------------------------------------------
// Real estate
// ---------------------------------------------------------------------------

/**
 * Real-estate listing extraction. Targets typical MLS / Zillow / Realtor /
 * Redfin / dealer-IDX page layouts.
 *
 * Field choices map directly to Meta's HOME_LISTING catalog columns (see
 * lib/csv.ts → REALESTATE_CSV_HEADERS):
 *   - `name`           → catalog `name`
 *   - `description`    → catalog `description`
 *   - `price`          → catalog `price` (numeric; we suffix "USD" downstream)
 *   - `address`        → catalog `address.addr1`
 *   - `city`           → catalog `address.city`
 *   - `region`         → catalog `address.region`     (US state abbrev)
 *   - `postal_code`    → catalog `address.postal_code`
 *   - `num_beds`       → catalog `num_beds`
 *   - `num_baths`      → catalog `num_baths`
 *   - `property_type`  → catalog `property_type` + `listing_type`
 *                        (Meta enum: for_sale | for_rent)
 *   - `area_size`      → catalog `area_size` (square feet, numeric)
 *   - `year_built`     → catalog `year_built`
 *   - `images`         → catalog `image[0..N].url`
 */
export const REALESTATE_EXTRACTION_SCHEMA = z.object({
  name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  price: z.union([z.string(), z.number()]).nullable().optional(),
  address: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  region: z.string().nullable().optional(),
  postal_code: z.string().nullable().optional(),
  num_beds: z.union([z.string(), z.number()]).nullable().optional(),
  num_baths: z.union([z.string(), z.number()]).nullable().optional(),
  property_type: z.enum(["for_sale", "for_rent"]).nullable().optional(),
  area_size: z.union([z.string(), z.number()]).nullable().optional(),
  year_built: z.union([z.string(), z.number()]).nullable().optional(),
  images: z.array(z.string()).nullable().optional(),
  url: z.string().nullable().optional(),
  latitude: z.union([z.string(), z.number()]).nullable().optional(),
  longitude: z.union([z.string(), z.number()]).nullable().optional(),
});

export const REALESTATE_JSON_SCHEMA = {
  type: "object",
  properties: {
    name: { type: ["string", "null"] },
    description: { type: ["string", "null"] },
    price: { type: ["string", "number", "null"] },
    address: { type: ["string", "null"] },
    city: { type: ["string", "null"] },
    region: { type: ["string", "null"] },
    postal_code: { type: ["string", "null"] },
    num_beds: { type: ["string", "number", "null"] },
    num_baths: { type: ["string", "number", "null"] },
    property_type: { type: ["string", "null"], enum: ["for_sale", "for_rent", null] },
    area_size: { type: ["string", "number", "null"] },
    year_built: { type: ["string", "number", "null"] },
    images: { type: ["array", "null"], items: { type: "string" } },
    url: { type: ["string", "null"] },
    latitude: { type: ["string", "number", "null"] },
    longitude: { type: ["string", "number", "null"] },
  },
} as const;

export const REALESTATE_EXTRACTION_PROMPT = `
You are extracting structured data from a real estate listing page (Zillow, Realtor.com, Redfin, MLS, or a broker's IDX site) into Meta's HOME_LISTING catalog schema. Read the page carefully — including any JSON-LD blocks, "Property Details" sections, "Facts & Features" panels, header summaries, and the page's <title> tag.

Field-by-field guidance:

- name: short headline for the listing. Preferred format "<beds>BR/<baths>BA - <street address>" (e.g., "3BR/2BA - 6360 Mountain View Trl"). If the page has no usable headline, fall back to the street address alone.
- description: the property's marketing description (1-4 sentences). On Zillow this is the "What's special" / overview paragraph. Strip HTML, do not paraphrase, copy verbatim.
- price: the list price as a plain number with no currency symbol and no commas (e.g., 429900). For rentals, use monthly rent (e.g., 2500). Never return a price range — pick the asking price.
- address: street address only — house number, street name, and unit (e.g., "6360 Mountain View Trl" or "123 Main St Unit 4B"). DO NOT include city/state/zip in this field.
- city: city name only, properly cased (e.g., "Cumming").
- region: 2-letter US state abbreviation in uppercase (e.g., "GA", "CA", "TX"). Convert full state names to abbreviations.
- postal_code: 5-digit US ZIP code as a string. If the page shows ZIP+4, use only the first 5 digits.
- num_beds: bedroom count as a number (integer). Look for "Bed", "Beds", "Bedrooms", "BR".
- num_baths: bathroom count as a number; decimals allowed for half-baths (e.g., 2.5). Look for "Bath", "Baths", "Bathrooms", "BA".
- property_type: "for_sale" if the listing is for sale (look for "For Sale", "Active", a list price, "Sold"). "for_rent" if it's a rental (look for "/mo", "monthly", "For Rent", "Apartments for rent"). Default to "for_sale" when ambiguous.
- area_size: interior living area in square feet as a number (no "sq ft" suffix, no commas). Use "Total interior livable area" / "Living area" / "Sq Ft" / "Square Feet" — NOT lot size.
- year_built: year the property was constructed as a 4-digit number.
- images: an array of every full-resolution photo URL on the page. On Zillow these are typically https://photos.zillowstatic.com/* URLs. Include the hero photo, gallery photos, and virtual-tour stills. Exclude logos, agent headshots, map tiles, and UI icons. Return at most 30.
- url: the canonical listing URL (the page you are reading).
- latitude / longitude: numeric coordinates if the page exposes them in JSON-LD geo, "data-lat"/"data-lng" attributes, or a Google Maps embed (lat,lng pattern). Most MLS pages omit these — return null if unsure.

Return null (not an empty string) for any field you cannot find with confidence. Do NOT invent or guess values. Do NOT translate or summarize the description.
`;
