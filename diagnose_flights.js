// Script de diagnóstico para vuelos de OpenSky
// Ejecutar en la consola del navegador (F12)

async function diagnoseFlights() {
  console.log("=== Diagnóstico de Vuelos OpenSky ===\n");
  
  // 1. Verificar configuración
  console.log("1. Verificando configuración...");
  try {
    const config = await fetch('/api/config').then(r => r.json());
    console.log("   OpenSky enabled:", config.opensky?.enabled);
    console.log("   Flights enabled:", config.layers?.flights?.enabled);
    console.log("   Flights provider:", config.layers?.flights?.provider);
    console.log("   Config completa:", config.opensky);
    console.log("   Flights config:", config.layers?.flights);
  } catch (e) {
    console.error("   Error obteniendo configuración:", e);
  }
  
  // 2. Verificar endpoint de vuelos
  console.log("\n2. Probando endpoint /api/layers/flights...");
  try {
    const response = await fetch('/api/layers/flights');
    console.log("   Status:", response.status);
    console.log("   Headers:", Object.fromEntries(response.headers.entries()));
    
    const text = await response.text();
    console.log("   Response text (primeros 500 chars):", text.substring(0, 500));
    
    if (text) {
      try {
        const data = JSON.parse(text);
        console.log("   Response JSON:", data);
        console.log("   Count:", data.count);
        console.log("   Disabled:", data.disabled);
        console.log("   Items length:", data.items?.length || 0);
        if (data.items && data.items.length > 0) {
          console.log("   Primer item:", data.items[0]);
        }
      } catch (e) {
        console.error("   Error parseando JSON:", e);
      }
    } else {
      console.warn("   Respuesta vacía!");
    }
  } catch (e) {
    console.error("   Error en el fetch:", e);
  }
  
  // 3. Verificar estado de OpenSky
  console.log("\n3. Verificando estado de OpenSky...");
  try {
    const status = await fetch('/api/layers/flights/test').then(r => r.json());
    console.log("   Status completo:", status);
  } catch (e) {
    console.error("   Error obteniendo estado:", e);
  }
  
  console.log("\n=== Fin del diagnóstico ===");
}

diagnoseFlights();

