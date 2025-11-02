import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConfigPage } from "../ConfigPage";
import { withConfigDefaults } from "../../config/defaults";
import { getConfig, getHealth, getOpenSkyStatus, getSchema, wifiNetworks, wifiScan, wifiStatus } from "../../lib/api";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getConfig: vi.fn(),
    getHealth: vi.fn(),
    getSchema: vi.fn(),
    getOpenSkyStatus: vi.fn(),
    wifiScan: vi.fn(),
    wifiNetworks: vi.fn(),
    wifiStatus: vi.fn(),
    wifiConnect: vi.fn(),
    wifiDisconnect: vi.fn(),
    saveConfig: vi.fn(),
    testAemetApiKey: vi.fn(),
    updateAemetApiKey: vi.fn(),
  } satisfies Partial<typeof actual>;
});

const mockGetConfig = getConfig as ReturnType<typeof vi.fn>;
const mockGetHealth = getHealth as ReturnType<typeof vi.fn>;
const mockGetSchema = getSchema as ReturnType<typeof vi.fn>;
const mockGetOpenSkyStatus = getOpenSkyStatus as ReturnType<typeof vi.fn>;
const mockWifiScan = wifiScan as ReturnType<typeof vi.fn>;
const mockWifiNetworks = wifiNetworks as ReturnType<typeof vi.fn>;
const mockWifiStatus = wifiStatus as ReturnType<typeof vi.fn>;

const renderConfigPage = async () => {
  render(<ConfigPage />);
  const scanButton = await screen.findByRole("button", { name: "Buscar redes" });
  await waitFor(() => expect(scanButton).toBeEnabled());
  return scanButton;
};

describe("ConfigPage WiFi panel", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const defaultConfig = withConfigDefaults();
    mockGetConfig.mockResolvedValue(defaultConfig);
    mockGetHealth.mockResolvedValue({});
    mockGetSchema.mockResolvedValue({});
    mockGetOpenSkyStatus.mockResolvedValue(null);
    mockWifiStatus.mockResolvedValue({
      interface: "wlp2s0",
      connected: false,
      ssid: null,
      ip_address: null,
      signal: null,
    });
    mockWifiNetworks.mockResolvedValue({ networks: [], count: 0 });
    mockWifiScan.mockResolvedValue({ ok: true, count: 0, networks: [], meta: { attempt: "ifname" } });
  });

  it("mantains panel when scan fails and shows empty message", async () => {
    mockWifiScan.mockResolvedValue({
      ok: false,
      count: 0,
      networks: [],
      meta: { reason: "scan_failed", stderr: "boom" },
    });
    mockWifiNetworks.mockResolvedValue({ networks: [], count: 0 });

    const user = userEvent.setup();
    const scanButton = await renderConfigPage();
    await user.click(scanButton);

    await screen.findByText("No se han encontrado redes. Reintenta o acerca el equipo al AP.");
    await screen.findByRole("button", { name: "Reintentar" });
    await screen.findByText("No se pudo completar el escaneo de redes WiFi. Inténtalo de nuevo.");

    expect(mockWifiScan).toHaveBeenCalledTimes(1);
    expect(mockWifiNetworks).toHaveBeenCalledTimes(1);
  });

  it("renders networks and count when scan succeeds", async () => {
    mockWifiNetworks.mockResolvedValue({
      networks: [
        { ssid: "Casa 1", signal: 80, security: "wpa2" },
        { ssid: "Cafe", signal: 65, security: "--" },
        { ssid: "Oficina", signal: 40, security: "wpa3" },
      ],
      count: 3,
    });

    const user = userEvent.setup();
    const scanButton = await renderConfigPage();
    await user.click(scanButton);

    await screen.findByText("Casa 1");
    await screen.findByText("Oficina");
    expect(screen.getAllByRole("button", { name: "Conectar" })).toHaveLength(3);
    const label = screen.getByText(/Redes disponibles/);
    expect(label).toHaveTextContent("Redes disponibles (3)");
    expect(screen.queryByText("No se pudo completar el escaneo de redes WiFi. Inténtalo de nuevo.")).toBeNull();
  });
});
