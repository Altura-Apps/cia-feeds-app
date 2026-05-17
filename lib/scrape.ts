import { firecrawlClient } from "@/lib/firecrawl";
import {
  FirecrawlRawVehicle,
  mapFirecrawlToVehicle,
  MappedVehicle,
} from "@/lib/vehicleMapper";
import { logScrapeEvent, logMappingFailure } from "@/lib/logger";
import { AUTOMOTIVE_JSON_SCHEMA } from "@/lib/extractionSchema";

const EXTRACTION_PROMPT = `
Extract the following vehicle information from this Vehicle Detail Page (VDP):
- vin: the 17-character VIN or stock number (look for labels "VIN" or "Stock #")
- make: the vehicle manufacturer (e.g., Honda, Ford, BMW) from page title/H1/labeled field
- model: the vehicle model name (e.g., Civic, F-150, X5) from page title/H1/labeled field
- year: the 4-digit model year from title or labeled field
- body_style: the body style (e.g., Sedan, SUV, Truck, Coupe)
- price: the listed selling price as a string (e.g., "$24,500")
- mileage_value: the odometer reading as a string (e.g., "18,200 mi")
- state_of_vehicle: New, Used, Pre-Owned, or Certified Pre-Owned
- exterior_color: the exterior color name
- image_url: URL of the **first** vehicle image in the photo gallery
- image_url_2: URL of the **second** vehicle image in the photo gallery (the photo right after the first one)
- description: a brief description of the vehicle
- address: the full dealership street address — look in JSON-LD "address" fields, the page footer, or the contact/location section
- latitude: GPS latitude — look in JSON-LD "geo.latitude", "data-lat" attributes, or Google Maps embed URL parameters (e.g., @lat,lng or !3dLAT!)
- longitude: GPS longitude — look in JSON-LD "geo.longitude", "data-lng" attributes, or Google Maps embed URL parameters (e.g., @lat,lng or !4dLNG!)

Return null for any field you cannot find.
`;


export interface ScrapeResult {
  vehicle: MappedVehicle;
  url: string;
  fieldsExtracted: string[];
}

/**
 * Scrape a VDP URL via Firecrawl, then map the result to the Vehicle schema.
 *
 * @param url - The vehicle detail page URL
 * @param dealerId - The authenticated dealer's ID (passed to the mapper)
 */
export async function scrapeVehicleUrl(
  url: string,
  dealerId: string
): Promise<ScrapeResult> {
  const startMs = Date.now();

      const response = await firecrawlClient.scrape(url, {
      formats: [
        {
          type: "json",
          prompt: EXTRACTION_PROMPT,
          schema: AUTOMOTIVE_JSON_SCHEMA as Record<string, unknown>,
        },
      ],
    });

  const durationMs = Date.now() - startMs;
  const extractionPayload = (response as { json?: unknown })?.json;
  const rawData = (extractionPayload !== null && typeof extractionPayload === "object"
    ? extractionPayload
    : {}) as FirecrawlRawVehicle;

  const fieldsExtracted = Object.entries(rawData)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k]) => k);

  const vehicle = mapFirecrawlToVehicle(rawData, dealerId, url);

  // Log mapping failures: fields that were present in raw data but could not be parsed
  if (rawData.price != null && rawData.price !== "" && vehicle.price === null) {
    logMappingFailure({ field: "price", rawValue: rawData.price });
  }
  if (rawData.mileage_value != null && rawData.mileage_value !== "" && vehicle.mileageValue === null) {
    logMappingFailure({ field: "mileage_value", rawValue: rawData.mileage_value });
  }
  if (rawData.state_of_vehicle != null && rawData.state_of_vehicle !== "" && vehicle.stateOfVehicle === null) {
    logMappingFailure({ field: "state_of_vehicle", rawValue: rawData.state_of_vehicle });
  }

  logScrapeEvent({
    dealerId,
    url,
    durationMs,
    fieldsExtracted,
    missingFields: vehicle.missingFields,
  });

  return { vehicle, url, fieldsExtracted };
}
