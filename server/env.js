// Carrega o .env (se existir) ANTES dos demais módulos lerem process.env.
// Importar este arquivo como o primeiro import do ponto de entrada.
try {
  process.loadEnvFile();
} catch {
  /* .env ausente — o sistema segue no modo simulação (mock). */
}
