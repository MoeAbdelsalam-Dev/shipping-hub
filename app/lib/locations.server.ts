import { gql, type AdminGraphql } from "./orders.server";
import { getSettings } from "./settings.server";

/** Ship-from address from Shopify Locations (scope: read_locations). */

export interface ShipFromLocation {
  id: string;
  name: string;
  address1: string;
  address2: string | null;
  city: string;
  provinceCode: string;
  postalCode: string;
  countryCode: string;
  phone: string | null;
}

export const SHIP_FROM_KEY = "shipFrom.locationId";

interface RawLocations {
  locations: {
    nodes: {
      id: string;
      name: string;
      isActive: boolean;
      address: {
        address1: string | null;
        address2: string | null;
        city: string | null;
        provinceCode: string | null;
        zip: string | null;
        countryCode: string | null;
        phone: string | null;
      };
    }[];
  };
}

export async function listLocations(admin: AdminGraphql): Promise<ShipFromLocation[]> {
  const data = await gql<RawLocations>(
    admin,
    `#graphql
      query ShipFromLocations {
        locations(first: 25, includeInactive: false) {
          nodes {
            id
            name
            isActive
            address { address1 address2 city provinceCode zip countryCode phone }
          }
        }
      }`,
  );
  return data.locations.nodes
    .filter((l) => l.isActive)
    .map((l) => ({
      id: l.id,
      name: l.name,
      address1: l.address.address1 ?? "",
      address2: l.address.address2,
      city: l.address.city ?? "",
      provinceCode: l.address.provinceCode ?? "",
      postalCode: l.address.zip ?? "",
      countryCode: l.address.countryCode ?? "",
      phone: l.address.phone,
    }));
}

/** The confirmed ship-from location, else the first active one (unconfirmed). */
export async function getShipFrom(
  admin: AdminGraphql,
  shop: string,
): Promise<{ location: ShipFromLocation | null; confirmed: boolean; locations: ShipFromLocation[] }> {
  try {
    const [locations, settings] = await Promise.all([listLocations(admin), getSettings(shop)]);
    const chosen = locations.find((l) => l.id === settings[SHIP_FROM_KEY]);
    return { location: chosen ?? locations[0] ?? null, confirmed: !!chosen, locations };
  } catch (e) {
    // Usually: read_locations not granted yet (app needs re-auth after the scope change).
    console.error("Locations failed:", e instanceof Error ? e.name : "error");
    return { location: null, confirmed: false, locations: [] };
  }
}
