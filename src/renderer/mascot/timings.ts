// Todos os tempos do mascote num lugar só. Valores em milissegundos.
export interface Timings {
  gazeMinMs: number // intervalo entre trocas de olhar (IDLE)
  gazeMaxMs: number
  demoMinMs: number // intervalo entre demos do notebook (IDLE); também é o mínimo entre duas demos seguidas
  demoMaxMs: number
  demoTypeMs: number // tempo digitando na demo
  glyphMs: number // duração de "?" e "!" na tela
  unknownGapMinMs: number // UNKNOWN: pausa entre "?" / digitar (alternam)
  unknownGapMaxMs: number
  unknownTypeMs: number
  laptopMoveMs: number // pegar / guardar o notebook
  sleepAfterMs: number // IDLE contínuo até dormir
  typeFrameMs: number // troca de quadro das mãos (maior = mais calmo)
}

export const T: Timings = {
  gazeMinMs: 1_500,
  gazeMaxMs: 4_000,
  demoMinMs: 45_000,
  demoMaxMs: 120_000,
  demoTypeMs: 3_000,
  glyphMs: 3_000,
  unknownGapMinMs: 6_000,
  unknownGapMaxMs: 12_000,
  unknownTypeMs: 3_000,
  laptopMoveMs: 250,
  sleepAfterMs: 300_000,
  typeFrameMs: 150
}
