import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { TimeCard } from "../dashboard/cards/TimeCard";
import { WeatherCard } from "../dashboard/cards/WeatherCard";
import { WeatherForecastCard } from "../dashboard/cards/WeatherForecastCard";
import { TransportCard } from "../dashboard/cards/TransportCard";
import { EphemeridesCard } from "../dashboard/cards/EphemeridesCard";
import { ApodCard } from "../dashboard/cards/ApodCard";
import SaintsCard from "../dashboard/cards/SaintsCard";
import { NewsCard } from "../dashboard/cards/NewsCard";
import { HistoricalEventsCard } from "../dashboard/cards/HistoricalEventsCard";
import "../../test/setup";

const originalFetch = globalThis.fetch;
const originalRaf = globalThis.requestAnimationFrame;
const originalCancelRaf = globalThis.cancelAnimationFrame;

describe("Right panel components", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })) as any);
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      return setTimeout(() => cb(performance.now()), 0) as unknown as number;
    }) as any;
    globalThis.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as any;
  });

  afterEach(() => {
    if (vi.isFakeTimers()) {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (originalRaf) {
      globalThis.requestAnimationFrame = originalRaf;
    }
    if (originalCancelRaf) {
      globalThis.cancelAnimationFrame = originalCancelRaf;
    }
  });

  it("renders the clock panel without icons and shows current date", () => {
    vi.setSystemTime(new Date("2024-05-10T10:30:15Z"));
    render(<TimeCard timezone="UTC" />);

    const panel = screen.getByTestId("panel-clock");
    expect(panel.querySelectorAll("img").length).toBe(0);
    expect(screen.getByText(/viernes/i)).toBeInTheDocument();
    expect(screen.getByText(/10 de mayo/i)).toBeInTheDocument();
  });

  it("renders current weather with icon and description", () => {
    render(
      <WeatherCard
        temperatureLabel="18°C"
        feelsLikeLabel="17°C"
        condition="Nublado"
        humidity={40}
        wind={12}
        rain={0}
        unit="C"
      />
    );

    const panel = screen.getByTestId("panel-weather-current");
    expect(panel.querySelector(".panel-title-icon")).toBeInTheDocument();
    expect(screen.getByText(/18/)).toBeInTheDocument();
    expect(screen.getByText(/Nublado/i)).toBeInTheDocument();
  });

  it("renders forecast items with icons and min/max values", () => {
    render(
      <WeatherForecastCard
        unit="C"
        forecast={[
          { date: "Lun", condition: "Soleado", temperature: { min: 10, max: 20 } },
          { date: "Mar", condition: "Nublado", temperature: { min: 11, max: 21 } },
          { date: "Mié", condition: "Lluvia", temperature: { min: 12, max: 22 } }
        ]}
      />
    );

    const panel = screen.getByTestId("panel-weather-forecast");
    expect(panel.querySelectorAll(".forecast-card-dark__dot").length).toBeGreaterThanOrEqual(3);
    expect(panel.querySelector(".forecast-card-dark__main-icon")).toBeInTheDocument();
    expect(screen.getByText(/máx/i)).toBeInTheDocument();
    expect(screen.getByText(/mín/i)).toBeInTheDocument();
  });

  it("renders ships data with name, speed and heading", async () => {
    vi.useRealTimers();
    render(
      <TransportCard
        data={{
          ships: [
            { name: "Ferry Valencia", speed: 12.3, heading: 180, distance_km: 5.2, destination: "Castelló", lat: 39.1, lon: -0.1 }
          ]
        }}
      />
    );

    const shipsPanel = await screen.findByTestId("panel-ships");
    expect(shipsPanel).toBeInTheDocument();
    expect(screen.getByText(/Ferry Valencia/)).toBeInTheDocument();
    expect(screen.getByText(/12\.3 kn/)).toBeInTheDocument();
    expect(screen.getByText(/180°/)).toBeInTheDocument();
  });

  it("renders flights with callsign and altitude/speed", () => {
    render(
      <TransportCard
        data={{
          planes: [
            { callsign: "VLG123", altitude: 10234, speed: 60, heading: 270, distance_km: 15.4, aircraft_type: "A320", lat: 39.2, lon: -0.2 }
          ]
        }}
      />
    );

    const panel = screen.getByTestId("panel-flights");
    expect(screen.getByText(/VLG123/)).toBeInTheDocument();
    expect(screen.getByText(/33576 ft/)).toBeInTheDocument();
    expect(screen.getByText(/117 kt/)).toBeInTheDocument();
    expect(screen.getByText(/A320/)).toBeInTheDocument();
  });

  it("cycles astronomy states and shows expected icons", () => {
    render(<EphemeridesCard sunrise="07:10" sunset="20:55" moonPhase="Luna llena" illumination={0.75} events={[]} />);

    const panel = screen.getByTestId("panel-astronomy");
    expect(panel.querySelector("img[src*='sunrise']")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(panel.querySelector("img[src*='moon']")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(panel.querySelector("img[src*='sunset']")).toBeInTheDocument();
  });

  it("renders NASA APOD image and handles video placeholders", () => {
    render(
      <ApodCard
        data={{
          title: "Nebulosa",
          url: "https://example.com/image.jpg",
          media_type: "image",
          explanation: "Exploración espacial",
          date: "2024-05-10"
        }}
      />
    );
    expect(screen.getByTestId("panel-nasa-apod").querySelector("img")).toBeInTheDocument();

    render(
      <ApodCard
        data={{
          title: "Vídeo del espacio",
          url: "",
          media_type: "video",
          explanation: "Contenido en vídeo",
          date: "2024-05-11"
        }}
      />
    );
    expect(screen.getAllByTestId("panel-nasa-apod")[1].textContent).toMatch(/Contenido en vídeo|Foto del día no disponible/);
  });

  it("renders santoral list without sun icons", () => {
    render(<SaintsCard saints={[{ name: "San Pedro", bio: "Apóstol", image: "/icons/misc/santoral.svg" }, "Santa Marta"]} />);
    const panel = screen.getByTestId("panel-santoral");
    expect(panel.querySelector("img[src*='santoral']")).toBeInTheDocument();
    expect(screen.getByText(/San Pedro/)).toBeInTheDocument();
  });

  it("renders news without long urls", () => {
    render(
      <NewsCard
        items={[
          { title: "Titular sin http", summary: "Resumen breve" },
          { title: "Otra noticia", summary: "Más texto" }
        ]}
      />
    );

    const panel = screen.getByTestId("panel-news");
    expect(panel.textContent ?? "").not.toMatch(/https?:\/\//i);
    expect(screen.getByText(/Titular sin http/)).toBeInTheDocument();
  });

  it("renders history items with capitalized sentences", () => {
    render(<HistoricalEventsCard items={["1492: descubrimiento de América", "1992: expo de sevilla"]} rotationSeconds={2} />);

    const panel = screen.getByTestId("panel-history");
    expect(screen.getByText(/Descubrimiento/)).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByText(/Expo de sevilla/)).toBeInTheDocument();
  });

  it("exposes auto-scroll class to hide scrollbars", () => {
    render(
      <NewsCard
        items={[{ title: "Noticia", summary: "Contenido para probar scroll" }]}
      />
    );
    const scrollable = screen.getByTestId("panel-news").querySelector(".panel-scroll-auto");
    expect(scrollable).toBeInTheDocument();
    expect(scrollable?.classList.contains("panel-scroll-auto")).toBe(true);
  });
});
