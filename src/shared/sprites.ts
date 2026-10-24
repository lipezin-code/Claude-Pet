// Grade 16 colunas. O=corpo, D=sombra, '.'=transparente. Olhos/acessórios são desenhados por estado.
export const PALETTES = {
  crab: { O: '#e8743b', D: '#b5532a', K: '#1d1410', W: '#ffffff', P: '#f6a38b', A: '#ffd166' },
  blob: { O: '#7c9cff', D: '#5570c9', K: '#10142a', W: '#ffffff', P: '#ffb4d1', A: '#ffd166' }
} as const

export const BODY: string[] = [
  '................', // (antena removida; linhas mantidas para preservar as coordenadas)
  '................',
  '..OOOOOOOOOOOO..',
  '..OOOOOOOOOOOO..',
  '..OOOOOOOOOOOO..',
  '..OOOOOOOOOOOO..',
  '..OOOOOOOOOOOO..',
  'OOOOOOOOOOOOOOOO', // braços
  'OOOOOOOOOOOOOOOO',
  '..OOOOOOOOOOOO..',
  '..DDDDDDDDDDDD..',
  '..OO.OO..OO.OO..', // pernas
  '..OO.OO..OO.OO..'
]
// Pose 3/4 virado para a esquerda, usada enquanto há notebook (pegar/digitar/segurar/guardar).
// Face frontal O (colunas 5-12) e face lateral D (13-15). Como no notebook de frente, os braços somem ao digitar:
// só as mãos aparecem, no teclado (LaptopSprite). Mesmo número de linhas que BODY: 10 = faixa de sombra, 11-12 = pernas.
export const BODY_SIDE: string[] = [
  '................',
  '................',
  '.....OOOOOOOODDD',
  '.....OOOOOOOODDD',
  '.....OOOOOOOODDD',
  '.....OOOOOOOODDD',
  '.....OOOOOOOODDD',
  '.....OOOOOOOODDD',
  '.....OOOOOOOODDD',
  '.....OOOOOOOODDD',
  '.....DDDDDDDDDDD', // faixa de sombra
  '.....OO.OO.OO.DD', // pernas (a de trás na sombra)
  '.....OO.OO.OO.DD'
]
export const GRID_W = 16
// Colunas extras à esquerda do quadro do pet, só p/ o notebook de lado caber inteiro (a janela fica 16+5 colunas).
export const LAPTOP_PAD = 5
export const GRID_H = 19 // 13 do corpo + espaço p/ acessórios
