
/**
 * Service to fetch historical events from Wikipedia API.
 */

export type WikipediaEvent = {
    text: string;
    pages: Array<{
        title: string;
        extract: string;
        thumbnail?: {
            source: string;
            width: number;
            height: number;
        };
    }>;
    year: number;
};

export type WikipediaOnThisDayResponse = {
    events: WikipediaEvent[];
};

export async function fetchWikipediaEvents(
    month?: number,
    day?: number,
    lang: string = "es"
): Promise<{ date: string; count: number; items: string[] }> {
    const now = new Date();
    const m = month ?? now.getMonth() + 1;
    const d = day ?? now.getDate();

    const mm = m.toString().padStart(2, "0");
    const dd = d.toString().padStart(2, "0");

    const url = `https://${lang}.wikipedia.org/api/rest_v1/feed/onthisday/events/${mm}/${dd}`;

    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Wikipedia API error: ${response.statusText}`);
        }

        const data = (await response.json()) as WikipediaOnThisDayResponse;

        // Filter and format events
        // We prioritize events that have a year and text
        const items = data.events.map((event) => {
            return `${event.year}: ${event.text}`;
        });

        return {
            date: `${now.getFullYear()}-${mm}-${dd}`,
            count: items.length,
            items: items,
        };
    } catch (error) {
        console.warn("[WikipediaService] Failed to fetch events:", error);
        return {
            date: `${now.getFullYear()}-${mm}-${dd}`,
            count: 0,
            items: [],
        };
    }
}
