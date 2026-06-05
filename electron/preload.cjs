// Preload (vazio por enquanto). Mantém contextIsolation seguro.
// Adicione bridges aqui se precisar expor APIs Node ao renderer.
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("mga", {
  isElectron: true,
  version: "v7.0",
});