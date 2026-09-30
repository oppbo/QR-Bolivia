/*
 * Alerta QR Bolivia — MVP
 *
 * Qué hace: lee (OCR) el texto de una captura de la notificación bancaria del
 * propio comerciante, o el texto de un SMS pegado, busca el monto en bolivianos
 * y lo dice en voz alta.
 *
 * Qué NO hace: no verifica pagos. El OCR reconoce letras; no autentica
 * comprobantes. Una imagen editada o un SMS falso pueden mostrar un monto
 * perfectamente legible. Sin integración bancaria no podemos saber si una
 * transacción existe o si el dinero llegó a la cuenta. Por eso la app habla de
 * "Monto detectado" y siempre pide revisar el abono en el banco.
 *
 * Privacidad: todo ocurre en el dispositivo.
 *  - La imagen se lee en memoria y se entrega al worker de Tesseract.js, que
 *    corre dentro del navegador. No hay backend ni se sube nada.
 *  - Los archivos que Tesseract.js descarga (worker, WebAssembly y modelo de
 *    idioma) son PROGRAMAS y DATOS DEL MODELO que bajan del mismo sitio; la
 *    imagen nunca viaja en sentido contrario.
 *  - El historial vive solo en memoria (estado de React) y guarda monto, hora y
 *    origen; nunca la imagen ni el texto completo. Se pierde al recargar.
 *  - No se escribe contenido bancario en la consola.
 */
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

/* =========================================================================
 * 1. CONFIGURACIÓN
 * ========================================================================= */

export const CONFIG = {
  // Límite TÉCNICO para descartar lecturas absurdas del OCR (por ejemplo, un
  // número de cuenta tomado como monto). No es un límite bancario. En
  // centavos: 10.000.000 = Bs 100.000,00. Ajústalo si tu negocio lo necesita.
  LIMITE_TECNICO_CENTAVOS: 10_000_000,
  // Tamaño máximo del archivo de imagen.
  TAMANO_MAXIMO_BYTES: 10 * 1024 * 1024,
  // Más de 40 megapíxeles puede agotar la memoria de un teléfono modesto.
  MAX_PIXELES: 40_000_000,
  // Las capturas de teléfono suelen medir 720–1440 px de ancho. Solo reducimos
  // si el lado mayor supera este valor (fotos de cámara muy grandes).
  LADO_MAXIMO_OCR: 2400,
  // Si la imagen es pequeña, se amplía (máx. x2) para que las letras tengan
  // suficientes píxeles; Tesseract reconoce mejor texto de ~20–30 px de alto.
  LADO_MINIMO_OCR: 1000,
  // Diferencia mínima de puntaje para elegir un monto sin preguntar.
  MARGEN_DECISION: 3,
  // Largo máximo del texto pegado (un SMS rara vez supera 500 caracteres).
  MAX_CARACTERES_TEXTO: 2000,
  // Tiempo para considerar que el navegador bloqueó la voz automática.
  ESPERA_INICIO_VOZ_MS: 2500,
  // Tras este tiempo sin lecturas se termina el worker de OCR para devolver
  // memoria al teléfono. La siguiente lectura lo recrea desde la caché (~1 s).
  LIBERAR_WORKER_INACTIVO_MS: 3 * 60 * 1000,
};

// Carpeta versionada de los recursos OCR (la inyecta vite.config.js).
const CARPETA_OCR = typeof __CARPETA_OCR__ === 'string' ? __CARPETA_OCR__ : 'ocr';
const NOMBRE_CACHE_OCR = 'ocr-recursos';
const NUCLEOS_OCR = [
  'tesseract-core-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-relaxedsimd-lstm.wasm.js',
];

/* =========================================================================
 * 2. INTERPRETACIÓN DE IMPORTES (funciones puras, probadas en tests/)
 * ========================================================================= */

/**
 * Normaliza el texto para buscar montos:
 *  - quita tildes (operación → operacion) y pasa a minúsculas;
 *  - convierte espacios especiales (no separables, tabulaciones) en espacios;
 *  - unifica saltos de línea y colapsa espacios repetidos.
 * NO cambia letras por números: eso se hace solo en contexto numérico (ver
 * `corregirOcrNumerico`).
 */
export function normalizarTexto(texto) {
  if (typeof texto !== 'string') return '';
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[   \t]/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/ {2,}/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Corrección OCR restringida: dentro de un número pegado a "Bs"/"BOB" el OCR a
 * veces lee la letra "o" en lugar del cero ("Bs 5O,00"). Solo se corrige si la
 * cadena contiene al menos un dígito real y únicamente dígitos, "o", "." y ",".
 * Nunca se aplica al texto completo ni fuera de ese contexto.
 */
export function corregirOcrNumerico(cadena) {
  if (!/\d/.test(cadena) || !/^[0-9o.,]+$/.test(cadena)) return null;
  return cadena.replace(/o/g, '0');
}

const invalido = (motivo) => ({ estado: 'invalido', motivo });

// Entero sin separadores. Rechaza ceros a la izquierda ("050"), que suelen ser
// códigos y no montos.
function enteroSimple(parte) {
  if (!/^(0|[1-9]\d{0,8})$/.test(parte)) return null;
  return Number(parte);
}

// Entero con separador de miles: primer grupo de 1–3 dígitos (sin cero
// inicial) y los demás de exactamente 3. "1.250.000" → 1250000.
function enteroConMiles(parte, separador) {
  const grupos = parte.split(separador);
  if (grupos.length < 2) return null;
  if (!/^[1-9]\d{0,2}$/.test(grupos[0])) return null;
  if (!grupos.slice(1).every((g) => /^\d{3}$/.test(g))) return null;
  return enteroSimple(grupos.join(''));
}

/**
 * Convierte una cadena numérica en CENTAVOS ENTEROS (evita errores de coma
 * flotante: 20,50 → 2050).
 *
 * Reglas conservadoras:
 *  - "50" → 5000.
 *  - Con punto Y coma, el separador que aparece AL FINAL es el decimal y debe
 *    tener exactamente 2 dígitos; el otro debe agrupar miles de 3 en 3:
 *    "1.250,50" y "1,250.50" → 125050.
 *  - Un solo separador seguido de 2 dígitos → decimales: "20.50", "20,50".
 *  - Un solo separador seguido de 3 dígitos ("1.250" o "1,250") es AMBIGUO:
 *    en Bolivia suele ser mil doscientos cincuenta, pero un sistema con otro
 *    formato podría querer decir 1,25 (si el último dígito es 0). No se adivina:
 *    se devuelven las opciones posibles para que la persona elija.
 *  - Un solo separador seguido de 1 dígito ("20.5") se entiende como 20,50,
 *    pero también se marca para revisión por ser un formato poco habitual.
 *  - Varios separadores iguales ("1.250.000") → solo miles.
 *  - Cualquier otra forma → inválido. También cero, negativos (el signo no se
 *    acepta) y valores sobre el límite técnico.
 *
 * Devuelve { estado: 'valido', centavos } | { estado: 'ambiguo', opciones,
 * motivo } | { estado: 'invalido', motivo }.
 */
export function normalizarImporte(cadena, limite = CONFIG.LIMITE_TECNICO_CENTAVOS) {
  const s = String(cadena ?? '').trim();
  if (!/^\d[\d.,]*$/.test(s) || /[.,]$/.test(s) || /[.,]{2}/.test(s)) {
    return invalido('formato');
  }
  const puntos = (s.match(/\./g) || []).length;
  const comas = (s.match(/,/g) || []).length;
  let opciones = [];
  let ambiguo = false;
  let motivoAmbiguo = null;

  if (!puntos && !comas) {
    const entero = enteroSimple(s);
    if (entero === null) return invalido('formato');
    opciones = [entero * 100];
  } else if (puntos && comas) {
    const decimal = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
    const miles = decimal === '.' ? ',' : '.';
    const posicion = s.lastIndexOf(decimal);
    const parteEntera = s.slice(0, posicion);
    const parteDecimal = s.slice(posicion + 1);
    if (parteEntera.includes(decimal) || parteDecimal.length !== 2) return invalido('formato');
    const entero = enteroConMiles(parteEntera, miles);
    if (entero === null) return invalido('formato');
    opciones = [entero * 100 + Number(parteDecimal)];
  } else {
    const separador = puntos ? '.' : ',';
    const partes = s.split(separador);
    if (partes.length > 2) {
      const entero = enteroConMiles(s, separador);
      if (entero === null) return invalido('formato');
      opciones = [entero * 100];
    } else {
      const [izquierda, derecha] = partes;
      const entero = enteroSimple(izquierda);
      if (derecha.length === 2) {
        if (entero === null) return invalido('formato');
        opciones = [entero * 100 + Number(derecha)];
      } else if (derecha.length === 1) {
        if (entero === null) return invalido('formato');
        opciones = [entero * 100 + Number(derecha) * 10];
        ambiguo = true;
        motivoAmbiguo = 'un-decimal';
      } else if (derecha.length === 3) {
        const comoMiles = enteroConMiles(s, separador);
        if (comoMiles !== null) opciones.push(comoMiles * 100);
        if (entero !== null && derecha.endsWith('0')) {
          opciones.push(entero * 100 + Number(derecha.slice(0, 2)));
        }
        ambiguo = true;
        motivoAmbiguo = 'separador-tres-digitos';
      } else {
        return invalido('formato');
      }
    }
  }

  opciones = [...new Set(opciones)].filter((c) => Number.isInteger(c) && c > 0);
  if (!opciones.length) return invalido('cero');
  opciones = opciones.filter((c) => c <= limite);
  if (!opciones.length) return invalido('fuera-de-limite');
  if (ambiguo) return { estado: 'ambiguo', opciones, motivo: motivoAmbiguo };
  return { estado: 'valido', centavos: opciones[0] };
}

// Palabras que indican que el monto NO es lo recibido: se descarta.
const CONTEXTO_EXCLUYENTE =
  /\b(saldo|comision|cargo|itf|disponible|deuda|costo|tarifa|impuesto|limite|cuota)\b/;
// Palabras de moneda extranjera: el monto no es en bolivianos.
const CONTEXTO_OTRA_MONEDA = /(\busd\b|\bus\$|\$us|\bdolar|\beur\b|\beuro|\$\s*$)/;
// Palabras que indican con fuerza el monto recibido.
const CONTEXTO_FUERTE =
  /(recib|abon|te envi|te transfiri|deposit|monto de la transferencia|importe de la transferencia)/;
// Etiquetas genéricas de monto.
const CONTEXTO_GENERICO = /\b(monto|importe|total|valor|por|transferencia|pago|qr)\b/;

// Separadores de frase para acotar el contexto de cada número. El punto solo
// cuenta como fin de frase si no es la abreviatura "Bs." o "Nro.".
const FIN_DE_FRASE = /\n|[;|]|,\s|(?<!\b(?:bs|nro|num|no|ref|cod|op))\.\s/g;

function contextoAnterior(texto, indice) {
  const ventana = texto.slice(Math.max(0, indice - 70), indice);
  let corte = 0;
  for (const m of ventana.matchAll(FIN_DE_FRASE)) corte = m.index + m[0].length;
  return ventana.slice(corte);
}

function contextoPosterior(texto, indiceFin) {
  return texto.slice(indiceFin, indiceFin + 25);
}

// ¿El número forma parte de una fecha (29/09/2026), hora (10:30), teléfono con
// guion o código alfanumérico? Revisa los caracteres vecinos.
function pareceFechaHoraOCodigo(texto, inicio, fin) {
  const antes = texto.slice(Math.max(0, inicio - 2), inicio);
  const despues = texto.slice(fin, fin + 2);
  if (/[/\-]$/.test(antes) || /^[/\-]\d/.test(despues)) return true;
  if (/\d:$/.test(antes) || /^:\d/.test(despues)) return true;
  if (/^[a-z0-9]/.test(despues)) return true;
  return false;
}

const NUM = '\\d(?:[\\d.,]*\\d)?';
const NUM_OCR = '[0-9o](?:[0-9o.,]*[0-9o])?';
// Moneda ANTES del número: "Bs. 50", "Bs50", "BOB 100", "Bs: 20,50".
const RE_MONEDA_ANTES = new RegExp(`(?<![a-z0-9])(?:bs|bob)(?![a-z])\\.?\\s{0,2}:?\\s{0,2}(${NUM_OCR})`, 'g');
// Moneda DESPUÉS del número: "100 Bs", "50 bolivianos".
const RE_MONEDA_DESPUES = new RegExp(`(${NUM})\\s?(?:bs|bob|bolivianos?)(?![a-z])`, 'g');
// Etiqueta sin moneda: "Monto: 100", "Importe recibido 150,00".
const RE_ETIQUETA = new RegExp(
  `\\b(?:monto|importe|total|abono|valor)(?:[a-z ]{0,30}?)\\s?:?\\s?(${NUM})`,
  'g',
);

/**
 * Busca todos los números que PODRÍAN ser el monto y les asigna un puntaje
 * según su contexto. Devuelve también los descartados, con el motivo, para
 * poder explicar y probar las decisiones.
 */
export function extraerCandidatosDeMonto(textoEntrada) {
  const texto = normalizarTexto(textoEntrada);
  const porPosicion = new Map();

  const registrar = (inicio, crudo, conMoneda) => {
    const previo = porPosicion.get(inicio);
    if (previo && (previo.conMoneda || !conMoneda)) return;
    porPosicion.set(inicio, { inicio, crudo, conMoneda });
  };

  for (const m of texto.matchAll(RE_MONEDA_ANTES)) {
    registrar(m.index + m[0].length - m[1].length, m[1], true);
  }
  for (const m of texto.matchAll(RE_MONEDA_DESPUES)) {
    registrar(m.index, m[1], true);
  }
  for (const m of texto.matchAll(RE_ETIQUETA)) {
    registrar(m.index + m[0].length - m[1].length, m[1], false);
  }

  const candidatos = [];
  for (const { inicio, crudo, conMoneda } of porPosicion.values()) {
    const fin = inicio + crudo.length;
    const base = { inicio, textoNumero: crudo, conMoneda, puntaje: 0, descartado: false };
    const numero = conMoneda ? corregirOcrNumerico(crudo) : crudo;
    if (numero === null) continue; // "bs o" u otra cadena sin dígitos.

    const antes = contextoAnterior(texto, inicio);
    const despues = contextoPosterior(texto, fin);
    const descartar = (motivo) => candidatos.push({ ...base, descartado: true, motivo });

    if (pareceFechaHoraOCodigo(texto, inicio, fin)) {
      descartar('fecha-hora-o-codigo');
      continue;
    }
    if (!conMoneda && numero.replace(/\D/g, '').length >= 7) {
      descartar('parece-telefono-o-cuenta');
      continue;
    }
    if (CONTEXTO_EXCLUYENTE.test(antes) || /^ (de|en) (saldo|comision)/.test(despues)) {
      descartar('saldo-o-comision');
      continue;
    }
    if (CONTEXTO_OTRA_MONEDA.test(antes)) {
      descartar('otra-moneda');
      continue;
    }

    const importe = normalizarImporte(numero);
    if (importe.estado === 'invalido') {
      descartar(`importe-${importe.motivo}`);
      continue;
    }

    let puntaje = conMoneda ? 2 : 0;
    if (CONTEXTO_FUERTE.test(antes)) puntaje += 5;
    else if (CONTEXTO_GENERICO.test(antes)) puntaje += 2;

    candidatos.push({
      ...base,
      puntaje,
      formatoAmbiguo: importe.estado === 'ambiguo',
      motivoFormato: importe.estado === 'ambiguo' ? importe.motivo : null,
      opciones: importe.estado === 'ambiguo' ? importe.opciones : [importe.centavos],
      centavos: importe.estado === 'valido' ? importe.centavos : null,
    });
  }
  return candidatos.sort((a, b) => a.inicio - b.inicio);
}

/**
 * Decide qué hacer con los candidatos:
 *  - 'ninguno': no hay montos válidos.
 *  - 'unico': un monto claramente mejor que el resto (margen suficiente).
 *  - 'revisar': el mejor candidato tiene formato ambiguo ("1.250").
 *  - 'varios': dos o más montos distintos igual de plausibles.
 * Los candidatos con el mismo valor se unifican (por ejemplo, "Bs 50" en el
 * título y "Monto: Bs 50" en el detalle).
 */
export function seleccionarMonto(candidatos, margen = CONFIG.MARGEN_DECISION) {
  const validos = candidatos.filter((c) => !c.descartado);
  if (!validos.length) return { tipo: 'ninguno' };

  const unificados = new Map();
  for (const c of validos) {
    const clave = c.formatoAmbiguo ? `a:${c.opciones.join('|')}` : `v:${c.centavos}`;
    const previo = unificados.get(clave);
    if (!previo) {
      unificados.set(clave, { ...c });
    } else {
      previo.puntaje = Math.max(previo.puntaje, c.puntaje);
      previo.conMoneda = previo.conMoneda || c.conMoneda;
    }
  }
  const lista = [...unificados.values()].sort((a, b) => b.puntaje - a.puntaje);
  const [mejor, segundo] = lista;

  if (mejor.formatoAmbiguo) {
    return { tipo: 'revisar', motivo: mejor.motivoFormato, opciones: mejor.opciones };
  }
  if (!segundo || mejor.puntaje - segundo.puntaje >= margen) {
    return { tipo: 'unico', centavos: mejor.centavos, monedaAsumida: !mejor.conMoneda };
  }
  const cercanos = lista.filter((c) => mejor.puntaje - c.puntaje < margen);
  const opciones = [...new Set(cercanos.flatMap((c) => c.opciones))].slice(0, 4);
  return { tipo: 'varios', opciones };
}

// Palabras que indican que la operación NO se completó.
const ESTADOS_ADVERSOS = [
  [/rechazad/, 'rechazada'],
  [/pendiente/, 'pendiente'],
  [/anulad/, 'anulada'],
  [/no (fue |ha sido )?realizad|no se realizo|no se pudo (realizar|completar|procesar)/, 'no realizada'],
  [/fallid|\bfallo\b/, 'fallida'],
  [/revertid/, 'revertida'],
  [/cancelad/, 'cancelada'],
  [/en proceso|procesando/, 'en proceso'],
  [/no exitos|denegad/, 'denegada'],
  [/devuelt/, 'devuelta'],
];

/** Devuelve las expresiones de estado adverso encontradas en el texto. */
export function detectarEstadosAdversos(texto) {
  const t = normalizarTexto(texto);
  return ESTADOS_ADVERSOS.filter(([re]) => re.test(t)).map(([, etiqueta]) => etiqueta);
}

/**
 * Punto de entrada del análisis. Devuelve un objeto con `tipo`
 * ('vacio' | 'ninguno' | 'unico' | 'revisar' | 'varios') y los datos
 * necesarios para la interfaz. Nunca inventa un monto.
 */
export function analizarTexto(texto) {
  const normalizado = normalizarTexto(texto);
  if (!normalizado) return { tipo: 'vacio', advertencias: [] };
  const seleccion = seleccionarMonto(extraerCandidatosDeMonto(normalizado));
  return { ...seleccion, advertencias: detectarEstadosAdversos(normalizado) };
}

/** 125050 → "1.250,50" (formato boliviano: punto para miles, coma decimal). */
export function formatearMonto(centavos) {
  const bs = Math.floor(centavos / 100);
  const cts = centavos % 100;
  const miles = String(bs).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${miles},${String(cts).padStart(2, '0')}`;
}

// Cantidad en palabras que cualquier voz en español lee bien. Se usan dígitos
// SIN separadores de miles ("1250"), porque "1.250" podría leerse como
// "uno punto doscientos cincuenta".
function cantidadHablada(centavos) {
  const bs = Math.floor(centavos / 100);
  const cts = centavos % 100;
  const textoBs = `${bs} ${bs === 1 ? 'boliviano' : 'bolivianos'}`;
  const textoCts = `${cts} ${cts === 1 ? 'centavo' : 'centavos'}`;
  if (bs > 0 && cts > 0) return `${textoBs} con ${textoCts}`;
  if (bs > 0) return textoBs;
  return textoCts;
}

/**
 * Frase para la voz. Nunca dice "pago recibido": solo "monto detectado".
 * Si el texto menciona un estado adverso, la frase empieza con una alerta.
 */
export function crearTextoParaVoz(centavos, { advertencias = [] } = {}) {
  const cantidad = cantidadHablada(centavos);
  if (advertencias.length) {
    return `Atención: el texto dice ${advertencias.join(' y ')}. Monto mencionado: ${cantidad}. No entregues mercadería sin revisar tu banco`;
  }
  return `Monto detectado: ${cantidad}. Revisa el abono en tu banco`;
}

export const FRASE_PRUEBA = '¡Prueba exitosa, el volumen está correcto!';

/* =========================================================================
 * 3. VOZ (Web Speech API)
 * ========================================================================= */

/**
 * Elige una voz LOCAL en español. No todas las voces de la Web Speech API se
 * ejecutan en el dispositivo: algunas (p. ej. "Google español" en Chrome de
 * escritorio) envían el texto a un servidor. Solo aceptamos voces con
 * localService === true. Prioridad: es-BO → español latinoamericano → otro
 * español. Si no hay ninguna local, devolvemos null y la app lo informa (no
 * cambiamos en silencio a una voz remota).
 */
export function elegirVozLocal(voces) {
  const locales = (voces || []).filter(
    (v) => v.localService === true && /^es([-_]|$)/i.test(v.lang || ''),
  );
  const idioma = (v) => (v.lang || '').replace('_', '-').toLowerCase();
  const prioridad = (v) => {
    const l = idioma(v);
    if (l === 'es-bo') return 0;
    if (/^es-(419|us|mx|pe|cl|ar|co|ec|py|uy|ve)$/.test(l)) return 1;
    if (l === 'es-es') return 2;
    return 3;
  };
  return [...locales].sort((a, b) => prioridad(a) - prioridad(b))[0] || null;
}

const MENSAJES_VOZ = {
  'sin-soporte':
    'Este navegador no puede leer en voz alta. El monto sigue en pantalla.',
  'sin-voz-local':
    'No hay una voz en español instalada en el teléfono. El monto sigue en pantalla. Puedes instalar una voz en los ajustes de "Texto a voz" del teléfono.',
  bloqueado: 'El navegador no dejó hablar automáticamente. Pulsa «Escuchar monto».',
  error: 'No se pudo reproducir la voz. El monto sigue en pantalla.',
};

function useVoz() {
  const soporte =
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof window.SpeechSynthesisUtterance === 'function';
  const [vozLocal, setVozLocal] = useState(null);
  const [vocesCargadas, setVocesCargadas] = useState(false);
  // Se guarda la locución activa: en Chrome, si el objeto se libera antes de
  // terminar, a veces no se disparan sus eventos.
  const locucionRef = useRef(null);

  useEffect(() => {
    if (!soporte) return undefined;
    const sintetizador = window.speechSynthesis;
    const cargar = () => {
      const voces = sintetizador.getVoices();
      setVozLocal(elegirVozLocal(voces));
      if (voces.length) setVocesCargadas(true);
    };
    cargar();
    // addEventListener en lugar de onvoiceschanged para no pisar otros manejadores.
    sintetizador.addEventListener?.('voiceschanged', cargar);
    return () => {
      sintetizador.removeEventListener?.('voiceschanged', cargar);
      sintetizador.cancel();
    };
  }, [soporte]);

  const detener = useCallback(() => {
    if (soporte) window.speechSynthesis.cancel();
  }, [soporte]);

  /**
   * Mejora de mejor esfuerzo para iOS: Safari solo permite hablar si la
   * primera locución ocurre durante un toque del usuario. Al tocar «Subir
   * captura» se emite una locución silenciosa (volumen 0) que "desbloquea" la
   * síntesis; así, cuando el OCR termina segundos después, la voz automática
   * tiene más probabilidades de sonar. No está garantizado.
   */
  const desbloqueadoRef = useRef(false);
  const desbloquear = useCallback(() => {
    if (!soporte || desbloqueadoRef.current) return;
    const voz = elegirVozLocal(window.speechSynthesis.getVoices());
    if (!voz) return;
    try {
      const silenciosa = new window.SpeechSynthesisUtterance(' ');
      silenciosa.voice = voz;
      silenciosa.lang = voz.lang;
      silenciosa.volume = 0;
      window.speechSynthesis.speak(silenciosa);
      desbloqueadoRef.current = true;
    } catch {
      // Sin desbloqueo queda el botón «Escuchar monto».
    }
  }, [soporte]);

  /**
   * Habla un texto. Devuelve una promesa que se resuelve con
   * { ok: true } o { ok: false, motivo } — nunca lanza errores.
   */
  const hablar = useCallback(
    (texto) =>
      new Promise((resolver) => {
        if (!soporte) {
          resolver({ ok: false, motivo: 'sin-soporte' });
          return;
        }
        const sintetizador = window.speechSynthesis;
        // Algunas plataformas cargan las voces tarde: se vuelve a consultar.
        const voz = elegirVozLocal(sintetizador.getVoices());
        if (!voz) {
          resolver({ ok: false, motivo: 'sin-voz-local' });
          return;
        }
        sintetizador.cancel(); // corta cualquier locución anterior
        let locucion;
        try {
          locucion = new window.SpeechSynthesisUtterance(texto);
          locucion.voice = voz;
          locucion.lang = voz.lang;
        } catch {
          resolver({ ok: false, motivo: 'error' });
          return;
        }
        locucion.rate = 0.95; // un poco más lento que lo normal, más claro
        locucion.pitch = 1;
        locucion.volume = 1; // máximo permitido; NO sube el volumen del sistema
        let empezo = false;
        let terminado = false;
        const terminar = (resultado) => {
          if (terminado) return;
          terminado = true;
          clearTimeout(temporizador);
          if (locucionRef.current === locucion) locucionRef.current = null;
          resolver(resultado);
        };
        // Si no empieza en unos segundos, el navegador probablemente la bloqueó
        // (p. ej. Safari en iOS fuera de un toque directo del usuario).
        const temporizador = setTimeout(() => {
          if (!empezo) {
            sintetizador.cancel();
            terminar({ ok: false, motivo: 'bloqueado' });
          }
        }, CONFIG.ESPERA_INICIO_VOZ_MS);
        locucion.onstart = () => {
          empezo = true;
        };
        locucion.onend = () => terminar({ ok: true });
        locucion.onerror = (evento) => {
          if (evento.error === 'interrupted' || evento.error === 'canceled') {
            terminar({ ok: true, interrumpida: true });
          } else if (evento.error === 'not-allowed') {
            terminar({ ok: false, motivo: 'bloqueado' });
          } else {
            terminar({ ok: false, motivo: 'error' });
          }
        };
        locucionRef.current = locucion;
        try {
          sintetizador.speak(locucion);
        } catch {
          terminar({ ok: false, motivo: 'error' });
        }
      }),
    [soporte],
  );

  return { soporte, vozLocal, vocesCargadas, hablar, detener, desbloquear };
}

/* =========================================================================
 * 4. OCR (Tesseract.js v7) — ciclo de vida del worker
 * ========================================================================= */

function urlRecursosOcr() {
  return new URL(`${CARPETA_OCR}/`, document.baseURI).href;
}

// ¿Están los recursos OCR guardados por el service worker? Solo entonces se
// puede prometer OCR sin conexión.
async function recursosOcrEnCache() {
  try {
    if (!('caches' in window) || !navigator.serviceWorker?.controller) return false;
    if (!(await caches.has(NOMBRE_CACHE_OCR))) return false;
    const cache = await caches.open(NOMBRE_CACHE_OCR);
    const base = urlRecursosOcr();
    const [worker, idioma, ...nucleos] = await Promise.all([
      cache.match(`${base}worker.min.js`),
      cache.match(`${base}lang/spa.traineddata.gz`),
      ...NUCLEOS_OCR.map((n) => cache.match(`${base}core/${n}`)),
    ]);
    return Boolean(worker && idioma && nucleos.some(Boolean));
  } catch {
    return false;
  }
}

/**
 * Crea el worker de Tesseract.js SOLO cuando se necesita (carga diferida con
 * import()) y lo reutiliza en las siguientes lecturas.
 *
 * Configuración (API de createWorker en v7: createWorker(idiomas, oem, opciones)):
 *  - 'spa': modelo de español; también reconoce dígitos y "Bs".
 *  - oem 1: motor LSTM (el único incluido en el núcleo "lstm", más liviano).
 *  - workerPath / corePath / langPath: rutas del MISMO ORIGEN (public/ocr/...),
 *    copiadas por scripts/copiar-recursos-ocr.mjs. Sin ellas Tesseract.js
 *    descargaría de un CDN externo.
 *  - workerBlobURL: false: el worker se crea directamente desde su URL, para
 *    que lo controle el service worker y la CSP no necesite blob: para scripts.
 *  - cacheMethod: 'none': no usa IndexedDB; la caché la maneja el service worker
 *    (un solo lugar, fácil de borrar y de versionar).
 *  - errorHandler: evita que Tesseract.js lance errores no capturados; los
 *    errores llegan igualmente a las promesas y se muestran con mensajes claros.
 */
function useOcr() {
  const workerPromesaRef = useRef(null);
  const oyenteProgresoRef = useRef(null);
  const enUsoRef = useRef(0); // lecturas o preparaciones en curso
  const temporizadorRef = useRef(null);

  const obtenerWorker = useCallback(() => {
    if (!workerPromesaRef.current) {
      const promesa = (async () => {
        const modulo = await import('tesseract.js');
        const createWorker = modulo.createWorker ?? modulo.default?.createWorker;
        const base = urlRecursosOcr();

        // En Tesseract.js 7, si falla la descarga del MODELO DE IDIOMA (o su
        // inicialización), la promesa de createWorker nunca se rechaza: solo se
        // llama a errorHandler. Para no dejar la lectura colgada:
        //  1) errorHandler rechaza nuestra propia promesa de inicio;
        //  2) se captura el Web Worker que crea la librería (lo crea de forma
        //     síncrona al llamar a createWorker) para poder terminarlo si falla.
        let rechazarInicio = null;
        const falloInicio = new Promise((_, rechazar) => {
          rechazarInicio = rechazar;
        });
        const WorkerOriginal = window.Worker;
        let hiloCapturado = null;
        window.Worker = class extends WorkerOriginal {
          constructor(...argumentos) {
            super(...argumentos);
            hiloCapturado = this;
          }
        };
        let creacion;
        try {
          creacion = createWorker('spa', 1, {
            workerPath: `${base}worker.min.js`,
            corePath: `${base}core`,
            langPath: `${base}lang`,
            workerBlobURL: false,
            cacheMethod: 'none',
            gzip: true,
            logger: (mensaje) => oyenteProgresoRef.current?.(mensaje),
            // Después del inicio, los errores llegan como rechazo de recognize().
            errorHandler: () => rechazarInicio?.(new Error('fallo-inicio-ocr')),
          });
        } finally {
          window.Worker = WorkerOriginal;
        }
        try {
          const worker = await Promise.race([creacion, falloInicio]);
          rechazarInicio = null;
          return worker;
        } catch (error) {
          rechazarInicio = null;
          hiloCapturado?.terminate();
          creacion.then((w) => w.terminate()).catch(() => {});
          throw error;
        }
      })();
      workerPromesaRef.current = promesa;
      // Si falla (por ejemplo, sin conexión), se olvida para reintentar luego.
      promesa.catch(() => {
        if (workerPromesaRef.current === promesa) workerPromesaRef.current = null;
      });
    }
    return workerPromesaRef.current;
  }, []);

  // Termina el worker y libera la memoria del modelo (~decenas de MB).
  const liberarWorker = useCallback(async () => {
    const promesa = workerPromesaRef.current;
    workerPromesaRef.current = null;
    if (!promesa) return;
    try {
      const worker = await promesa;
      await worker.terminate();
    } catch {
      // Si nunca llegó a crearse, no hay nada que liberar.
    }
  }, []);

  // Reutilización con límite: mientras haya uso activo el worker se conserva;
  // cuando queda inactivo se programa su liberación.
  const empezarUso = useCallback(() => {
    enUsoRef.current += 1;
    clearTimeout(temporizadorRef.current);
  }, []);

  const terminarUso = useCallback(() => {
    enUsoRef.current = Math.max(0, enUsoRef.current - 1);
    if (enUsoRef.current > 0) return;
    clearTimeout(temporizadorRef.current);
    temporizadorRef.current = setTimeout(() => {
      if (enUsoRef.current === 0) void liberarWorker();
    }, CONFIG.LIBERAR_WORKER_INACTIVO_MS);
  }, [liberarWorker]);

  // Al desmontar el componente se cancela el temporizador y se libera el worker.
  useEffect(
    () => () => {
      clearTimeout(temporizadorRef.current);
      void liberarWorker();
    },
    [liberarWorker],
  );

  return { obtenerWorker, liberarWorker, empezarUso, terminarUso, oyenteProgresoRef };
}

class ErrorLectura extends Error {
  constructor(codigo) {
    super(codigo);
    this.codigo = codigo;
  }
}

const MENSAJES_ERROR = {
  'no-es-imagen': 'Ese archivo no es una imagen compatible. Elige una captura en formato PNG o JPG.',
  'muy-pesada': 'La imagen pesa más de 10 MB. Usa una captura de pantalla (suelen pesar menos de 2 MB).',
  'imagen-danada': 'No pudimos abrir la imagen. Puede estar dañada o en un formato no compatible. Prueba con otra captura.',
  'imagen-enorme': 'La imagen es demasiado grande para procesarla en el teléfono. Usa una captura de pantalla en lugar de una foto.',
  'sin-texto': 'No encontramos texto en la imagen. Usa una captura de la notificación o pega el texto del SMS.',
  borrosa: 'No pudimos leer el monto. Prueba con una captura más nítida o pega el texto del SMS.',
  'sin-monto': 'No encontramos un monto en bolivianos. Prueba con una captura más nítida o pega el texto del SMS.',
  'sin-conexion':
    'Sin conexión: el lector de imágenes todavía no está preparado en este teléfono. Conéctate una vez para prepararlo o pega el texto del SMS.',
  'descarga-modelo':
    'No se pudo descargar el lector de imágenes. Revisa tu conexión e inténtalo otra vez, o pega el texto del SMS.',
  general: 'Algo falló al leer la imagen. Inténtalo otra vez o pega el texto del SMS.',
  'texto-vacio': 'Pega el texto del SMS antes de pulsar «Leer monto del texto».',
  'texto-sin-monto':
    'No encontramos un monto en bolivianos en el texto. Revisa que incluya el monto, por ejemplo «Bs 50».',
};

const FORMATOS_DIRECTOS = ['image/png', 'image/jpeg'];

function validarArchivo(archivo) {
  // Algunos Android no informan el tipo; en ese caso se intenta decodificar.
  if (archivo.type && !archivo.type.startsWith('image/')) throw new ErrorLectura('no-es-imagen');
  if (archivo.size > CONFIG.TAMANO_MAXIMO_BYTES) throw new ErrorLectura('muy-pesada');
  if (archivo.size === 0) throw new ErrorLectura('imagen-danada');
}

// Abre la imagen con el decodificador del navegador. `onload` entrega las
// dimensiones sin pintar la imagen completa, así podemos rechazar imágenes
// enormes ANTES de dibujarlas en un canvas.
function decodificarImagen(archivo) {
  return new Promise((resolver, rechazar) => {
    const url = URL.createObjectURL(archivo);
    const img = new Image();
    img.onload = () => {
      if (!img.naturalWidth || !img.naturalHeight) {
        URL.revokeObjectURL(url);
        rechazar(new ErrorLectura('imagen-danada'));
        return;
      }
      resolver({ img, url, ancho: img.naturalWidth, alto: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      rechazar(new ErrorLectura(archivo.type && !archivo.type.startsWith('image/') ? 'no-es-imagen' : 'imagen-danada'));
    };
    img.src = url;
  });
}

/**
 * Prepara la imagen para Tesseract:
 *  - Capturas PNG/JPG de tamaño normal: se entregan TAL CUAL (sin recomprimir,
 *    para no degradar el texto).
 *  - Lado mayor > 2400 px: se reduce proporcionalmente (fotos de cámara).
 *  - Lado mayor < 1000 px: se amplía hasta x2 (capturas muy pequeñas).
 *  - Otros formatos (WebP, HEIC en Safari, etc.): se convierten a PNG con canvas.
 * No se aplica binarización ni filtros: Tesseract ya lo hace internamente y
 * un filtro agresivo puede borrar comas y puntos decimales.
 */
async function prepararParaOcr({ img, ancho, alto }, archivo) {
  if (ancho * alto > CONFIG.MAX_PIXELES) throw new ErrorLectura('imagen-enorme');
  const lado = Math.max(ancho, alto);
  let escala = 1;
  if (lado > CONFIG.LADO_MAXIMO_OCR) escala = CONFIG.LADO_MAXIMO_OCR / lado;
  else if (lado < CONFIG.LADO_MINIMO_OCR) escala = Math.min(2, CONFIG.LADO_MINIMO_OCR / lado);
  if (escala === 1 && FORMATOS_DIRECTOS.includes(archivo.type)) return archivo;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(ancho * escala);
  canvas.height = Math.round(alto * escala);
  const contexto = canvas.getContext('2d');
  if (!contexto) throw new ErrorLectura('imagen-enorme');
  contexto.fillStyle = '#ffffff'; // fondo blanco para imágenes con transparencia
  contexto.fillRect(0, 0, canvas.width, canvas.height);
  contexto.imageSmoothingEnabled = true;
  contexto.imageSmoothingQuality = 'high';
  contexto.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolver) => canvas.toBlob(resolver, 'image/png'));
  // Libera la memoria del canvas de inmediato.
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) throw new ErrorLectura('imagen-enorme');
  return blob;
}

const ETAPAS_OCR = {
  'loading tesseract core': 'Preparando el lector de imágenes (la primera vez tarda más)',
  'initializing tesseract': 'Preparando el lector de imágenes',
  'loading language traineddata': 'Cargando el modelo de español (la primera vez tarda más)',
  'initializing api': 'Preparando el lector de imágenes',
  'recognizing text': 'Reconociendo el texto',
};

// La confianza del OCR describe la nitidez de la lectura, NO si el pago es real.
function calidadDeLectura(confianza) {
  if (typeof confianza !== 'number') return null;
  if (confianza >= 80) return 'alta';
  if (confianza >= 55) return 'media';
  return 'baja';
}

/* =========================================================================
 * 5. ESTADO DE LA PANTALLA
 * ========================================================================= */

// Fases: inicial → procesando → resultado | ambiguo | error → inicial.
const ESTADO_INICIAL = {
  fase: 'inicial',
  origen: null,
  etapa: null,
  porcentaje: null,
  centavos: null,
  opciones: [],
  motivoOpciones: null,
  advertencias: [],
  monedaAsumida: false,
  calidad: null,
  error: null,
  campoError: null,
};

function reductor(estado, accion) {
  switch (accion.tipo) {
    case 'INICIO':
      return { ...ESTADO_INICIAL, fase: 'procesando', origen: accion.origen, etapa: 'Abriendo la imagen' };
    case 'PROGRESO':
      if (estado.fase !== 'procesando') return estado;
      return { ...estado, etapa: accion.etapa, porcentaje: accion.porcentaje };
    case 'RESULTADO':
      return {
        ...ESTADO_INICIAL,
        fase: 'resultado',
        origen: accion.origen,
        centavos: accion.centavos,
        advertencias: accion.advertencias,
        monedaAsumida: accion.monedaAsumida,
        calidad: accion.calidad ?? null,
      };
    case 'OPCIONES':
      return {
        ...ESTADO_INICIAL,
        fase: 'ambiguo',
        origen: accion.origen,
        opciones: accion.opciones,
        motivoOpciones: accion.motivo,
        advertencias: accion.advertencias,
        calidad: accion.calidad ?? null,
      };
    case 'ELEGIR':
      return {
        ...estado,
        fase: 'resultado',
        centavos: accion.centavos,
        opciones: [],
        monedaAsumida: false,
      };
    case 'ERROR':
      return {
        ...ESTADO_INICIAL,
        fase: 'error',
        origen: accion.origen,
        error: accion.codigo,
        campoError: accion.campo,
      };
    case 'REINICIAR':
      return ESTADO_INICIAL;
    default:
      return estado;
  }
}

const TEXTO_FASE = {
  inicial: 'Listo',
  procesando: 'Leyendo imagen',
  resultado: 'Revisa el resultado',
  ambiguo: 'Revisa el resultado',
  error: 'No se pudo leer',
};

const ICONO_FASE = { inicial: '●', procesando: '◌', resultado: '✓', ambiguo: '?', error: '✕' };

const ETIQUETA_ORIGEN = { imagen: 'Imagen', texto: 'Texto pegado' };

function horaCorta(fecha) {
  try {
    return fecha.toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return `${String(fecha.getHours()).padStart(2, '0')}:${String(fecha.getMinutes()).padStart(2, '0')}`;
  }
}

/* =========================================================================
 * 6. COMPONENTE PRINCIPAL
 * ========================================================================= */

const claseBotonPrincipal =
  'flex w-full min-h-14 items-center justify-center gap-2 rounded-2xl px-4 py-3 text-lg font-bold ' +
  'transition-colors disabled:opacity-50 disabled:saturate-50';
const claseBotonAzul = `${claseBotonPrincipal} bg-marca text-white hover:bg-marca-oscuro active:bg-marca-oscuro`;
const claseBotonBlanco = `${claseBotonPrincipal} border-2 border-marca bg-white text-marca hover:bg-blue-50`;

export default function App() {
  const [estado, despachar] = useReducer(reductor, ESTADO_INICIAL);
  const [texto, setTexto] = useState('');
  const [historial, setHistorial] = useState([]);
  const [vistaPrevia, setVistaPrevia] = useState(null);
  const [avisoVoz, setAvisoVoz] = useState(null);
  const [avisoPrueba, setAvisoPrueba] = useState(null);
  const [avisoPortapapeles, setAvisoPortapapeles] = useState(null);
  const [anuncio, setAnuncio] = useState('');
  const [enLinea, setEnLinea] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const [preparacion, setPreparacion] = useState({ estado: 'sin-comprobar', etapa: null });
  const [hayActualizacion, setHayActualizacion] = useState(false);

  const voz = useVoz();
  const { obtenerWorker, liberarWorker, empezarUso, terminarUso, oyenteProgresoRef } = useOcr();

  const montadoRef = useRef(false);
  const ocupadoRef = useRef(false); // impide procesamientos simultáneos
  const lecturaRef = useRef(0); // identificador de la lectura vigente
  const vistaPreviaRef = useRef(null);
  const inputArchivoRef = useRef(null);
  const textareaRef = useRef(null);
  const resultadoRef = useRef(null);
  const ultimoProgresoRef = useRef({ etapa: null, porcentaje: null });

  const procesando = estado.fase === 'procesando';
  const puedePegar = typeof navigator !== 'undefined' && typeof navigator.clipboard?.readText === 'function';

  // --- Montaje / desmontaje -------------------------------------------------
  useEffect(() => {
    montadoRef.current = true;
    return () => {
      montadoRef.current = false;
      lecturaRef.current += 1; // invalida cualquier lectura en curso
      if (vistaPreviaRef.current) URL.revokeObjectURL(vistaPreviaRef.current);
      vistaPreviaRef.current = null;
    };
  }, []);

  // Cambia la vista previa revocando SIEMPRE la URL temporal anterior.
  const cambiarVistaPrevia = useCallback((url) => {
    if (vistaPreviaRef.current && vistaPreviaRef.current !== url) {
      URL.revokeObjectURL(vistaPreviaRef.current);
    }
    vistaPreviaRef.current = url;
    setVistaPrevia(url);
  }, []);

  // --- Conexión y actualizaciones de la PWA ---------------------------------
  useEffect(() => {
    const alCambiar = () => setEnLinea(navigator.onLine);
    const alActualizar = () => setHayActualizacion(true);
    window.addEventListener('online', alCambiar);
    window.addEventListener('offline', alCambiar);
    window.addEventListener('alerta-qr:actualizacion', alActualizar);
    if (window.__alertaQrSwEnEspera) setHayActualizacion(true);
    let activo = true;
    recursosOcrEnCache().then((listo) => {
      if (activo && listo) setPreparacion({ estado: 'listo', etapa: null });
    });
    return () => {
      activo = false;
      window.removeEventListener('online', alCambiar);
      window.removeEventListener('offline', alCambiar);
      window.removeEventListener('alerta-qr:actualizacion', alActualizar);
    };
  }, []);

  // Mueve el foco al resultado o al error para lectores de pantalla y para que
  // la persona vea la respuesta sin buscarla.
  useEffect(() => {
    if (estado.fase === 'error' && estado.campoError === 'texto') {
      textareaRef.current?.focus();
    } else if (['resultado', 'ambiguo', 'error'].includes(estado.fase)) {
      resultadoRef.current?.focus();
    }
  }, [estado.fase, estado.campoError, estado.centavos]);

  // --- Historial (solo memoria) ---------------------------------------------
  const agregarAlHistorial = useCallback((centavos, origen, advertencias) => {
    setHistorial((previo) =>
      [
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          centavos,
          origen,
          hora: new Date(),
          conAdvertencia: advertencias.length > 0,
        },
        ...previo,
      ].slice(0, 3),
    );
  }, []);

  // --- Voz --------------------------------------------------------------------
  const decir = useCallback(
    async (frase, setAviso) => {
      setAviso(null);
      const resultado = await voz.hablar(frase);
      if (!montadoRef.current) return resultado;
      if (!resultado.ok) setAviso(MENSAJES_VOZ[resultado.motivo] || MENSAJES_VOZ.error);
      return resultado;
    },
    [voz],
  );

  const escucharMonto = useCallback(() => {
    if (estado.centavos == null) return;
    decir(crearTextoParaVoz(estado.centavos, { advertencias: estado.advertencias }), setAvisoVoz);
  }, [decir, estado.centavos, estado.advertencias]);

  const simularPrueba = useCallback(() => {
    // La prueba NO toca el historial ni el resultado.
    decir(FRASE_PRUEBA, setAvisoPrueba);
  }, [decir]);

  // --- Aplicar un análisis (común a imagen y texto) -------------------------
  const aplicarAnalisis = useCallback(
    (analisis, origen, calidad = null) => {
      if (analisis.tipo === 'unico') {
        despachar({
          tipo: 'RESULTADO',
          origen,
          centavos: analisis.centavos,
          advertencias: analisis.advertencias,
          monedaAsumida: analisis.monedaAsumida,
          calidad,
        });
        agregarAlHistorial(analisis.centavos, origen, analisis.advertencias);
        setAnuncio(`Monto detectado: ${formatearMonto(analisis.centavos)} bolivianos.`);
        // Intento de voz automática. Tras un proceso largo (OCR) el navegador
        // puede haber perdido el permiso del toque; si falla, queda el botón.
        decir(crearTextoParaVoz(analisis.centavos, { advertencias: analisis.advertencias }), setAvisoVoz);
      } else {
        despachar({
          tipo: 'OPCIONES',
          origen,
          opciones: analisis.opciones,
          motivo: analisis.tipo === 'revisar' ? analisis.motivo : 'varios',
          advertencias: analisis.advertencias,
          calidad,
        });
        setAnuncio('Revisa el resultado: elige el monto correcto.');
        // No se anuncia ninguna cantidad ambigua, solo que hay que revisar.
        decir(
          analisis.tipo === 'varios'
            ? 'Encontramos más de un monto posible. Elige el correcto en la pantalla'
            : 'Revisa el monto en la pantalla antes de continuar',
          setAvisoVoz,
        );
      }
    },
    [agregarAlHistorial, decir],
  );

  const mostrarError = useCallback((codigo, origen, campo) => {
    despachar({ tipo: 'ERROR', codigo, origen, campo });
    setAnuncio(MENSAJES_ERROR[codigo] || MENSAJES_ERROR.general);
  }, []);

  // --- Lectura de imagen ------------------------------------------------------
  const reportarProgreso = useCallback((mensaje, idLectura) => {
    if (!montadoRef.current || lecturaRef.current !== idLectura) return;
    const etapa = ETAPAS_OCR[mensaje.status];
    if (!etapa) return;
    const porcentaje =
      mensaje.status === 'recognizing text' && typeof mensaje.progress === 'number'
        ? Math.round(mensaje.progress * 100)
        : null;
    const previo = ultimoProgresoRef.current;
    // Evita renderizar por cada décima: solo cambios de etapa o de 5 %.
    if (previo.etapa === etapa && (porcentaje === null || Math.abs((previo.porcentaje ?? -10) - porcentaje) < 5)) {
      return;
    }
    if (previo.etapa !== etapa) setAnuncio(etapa); // al lector de pantalla, solo la etapa
    ultimoProgresoRef.current = { etapa, porcentaje };
    despachar({ tipo: 'PROGRESO', etapa, porcentaje });
  }, []);

  const manejarArchivo = useCallback(
    async (evento) => {
      const input = evento.target;
      const archivo = input.files?.[0];
      // Vaciar el input permite volver a elegir EL MISMO archivo.
      input.value = '';
      if (!archivo || ocupadoRef.current) return;

      ocupadoRef.current = true;
      empezarUso();
      const idLectura = ++lecturaRef.current;
      const vigente = () => montadoRef.current && lecturaRef.current === idLectura;
      voz.detener();
      setAvisoVoz(null);
      cambiarVistaPrevia(null);
      ultimoProgresoRef.current = { etapa: null, porcentaje: null };
      despachar({ tipo: 'INICIO', origen: 'imagen' });
      setAnuncio('Leyendo imagen');

      let urlImagen = null;
      try {
        validarArchivo(archivo);
        const imagen = await decodificarImagen(archivo);
        urlImagen = imagen.url;
        if (!vigente()) return;
        const entrada = await prepararParaOcr(imagen, archivo);
        if (!vigente()) return;
        cambiarVistaPrevia(urlImagen);
        urlImagen = null; // ahora la gestiona cambiarVistaPrevia

        if (!navigator.onLine && !(await recursosOcrEnCache())) {
          throw new ErrorLectura('sin-conexion');
        }
        oyenteProgresoRef.current = (m) => reportarProgreso(m, idLectura);
        let worker;
        try {
          worker = await obtenerWorker();
        } catch {
          throw new ErrorLectura(navigator.onLine ? 'descarga-modelo' : 'sin-conexion');
        }
        if (!vigente()) return;

        let datos;
        try {
          ({ data: datos } = await worker.recognize(entrada));
        } catch {
          // Un fallo dentro del worker puede dejarlo inestable: se recrea.
          await liberarWorker();
          throw new ErrorLectura('general');
        }
        if (!vigente()) return;

        // El texto reconocido se analiza aquí y se descarta; no se guarda.
        const textoOcr = datos?.text || '';
        const calidad = calidadDeLectura(datos?.confidence);
        if (textoOcr.replace(/[^a-z0-9]/gi, '').length < 6) {
          throw new ErrorLectura('sin-texto');
        }
        const analisis = analizarTexto(textoOcr);
        if (analisis.tipo === 'ninguno' || analisis.tipo === 'vacio') {
          throw new ErrorLectura(calidad === 'baja' ? 'borrosa' : 'sin-monto');
        }
        aplicarAnalisis(analisis, 'imagen', calidad);
      } catch (error) {
        if (urlImagen) URL.revokeObjectURL(urlImagen);
        if (vigente()) {
          mostrarError(error instanceof ErrorLectura ? error.codigo : 'general', 'imagen', 'imagen');
        }
      } finally {
        terminarUso();
        if (lecturaRef.current === idLectura) {
          ocupadoRef.current = false;
          oyenteProgresoRef.current = null;
        }
      }
    },
    [
      aplicarAnalisis,
      cambiarVistaPrevia,
      empezarUso,
      liberarWorker,
      mostrarError,
      obtenerWorker,
      oyenteProgresoRef,
      reportarProgreso,
      terminarUso,
      voz,
    ],
  );

  // Cancelar: invalida la lectura y termina el worker (Tesseract no permite
  // cancelar un reconocimiento a medias). La próxima lectura crea uno nuevo.
  const cancelarLectura = useCallback(() => {
    lecturaRef.current += 1;
    ocupadoRef.current = false;
    oyenteProgresoRef.current = null;
    void liberarWorker();
    cambiarVistaPrevia(null);
    despachar({ tipo: 'REINICIAR' });
    setAnuncio('Lectura cancelada. Listo.');
    inputArchivoRef.current?.focus();
  }, [cambiarVistaPrevia, liberarWorker, oyenteProgresoRef]);

  // --- Lectura de texto -------------------------------------------------------
  const leerTexto = useCallback(
    (evento) => {
      evento.preventDefault();
      if (ocupadoRef.current) return;
      lecturaRef.current += 1; // cualquier resultado anterior queda obsoleto
      voz.detener();
      setAvisoVoz(null);
      cambiarVistaPrevia(null);
      const analisis = analizarTexto(texto);
      if (analisis.tipo === 'vacio') {
        mostrarError('texto-vacio', 'texto', 'texto');
        return;
      }
      if (analisis.tipo === 'ninguno') {
        mostrarError('texto-sin-monto', 'texto', 'texto');
        return;
      }
      aplicarAnalisis(analisis, 'texto');
    },
    [aplicarAnalisis, cambiarVistaPrevia, mostrarError, texto, voz],
  );

  // Botón opcional: leer el portapapeles. Pegar manualmente siempre funciona.
  const pegarDesdePortapapeles = useCallback(async () => {
    setAvisoPortapapeles(null);
    try {
      const contenido = await navigator.clipboard.readText();
      if (!montadoRef.current) return;
      if (!contenido.trim()) {
        setAvisoPortapapeles('El portapapeles está vacío. Copia primero el SMS.');
        return;
      }
      setTexto(contenido.slice(0, CONFIG.MAX_CARACTERES_TEXTO));
      textareaRef.current?.focus();
    } catch {
      if (montadoRef.current) {
        setAvisoPortapapeles(
          'El navegador no permitió leer el portapapeles. Mantén presionado el campo de texto y elige «Pegar».',
        );
      }
    }
  }, []);

  // --- Selección manual cuando hay ambigüedad --------------------------------
  const elegirOpcion = useCallback(
    (centavos) => {
      despachar({ tipo: 'ELEGIR', centavos });
      agregarAlHistorial(centavos, estado.origen, estado.advertencias);
      setAnuncio(`Monto elegido: ${formatearMonto(centavos)} bolivianos.`);
      decir(crearTextoParaVoz(centavos, { advertencias: estado.advertencias }), setAvisoVoz);
    },
    [agregarAlHistorial, decir, estado.advertencias, estado.origen],
  );

  const leerOtro = useCallback(() => {
    lecturaRef.current += 1;
    voz.detener();
    setAvisoVoz(null);
    setTexto('');
    cambiarVistaPrevia(null);
    despachar({ tipo: 'REINICIAR' });
    setAnuncio('Listo para leer otro comprobante.');
    inputArchivoRef.current?.focus();
  }, [cambiarVistaPrevia, voz]);

  // --- Preparar OCR sin conexión ---------------------------------------------
  const prepararSinConexion = useCallback(async () => {
    if (!navigator.onLine) {
      setPreparacion({ estado: 'error', etapa: 'Necesitas conexión a internet para preparar el lector.' });
      return;
    }
    setPreparacion({ estado: 'preparando', etapa: 'Descargando el lector de imágenes…' });
    empezarUso();
    const oyenteAnterior = oyenteProgresoRef.current;
    if (!ocupadoRef.current) {
      oyenteProgresoRef.current = (m) => {
        const etapa = ETAPAS_OCR[m.status];
        if (etapa && montadoRef.current) setPreparacion({ estado: 'preparando', etapa });
      };
    }
    try {
      await obtenerWorker();
      const listo = await recursosOcrEnCache();
      if (!montadoRef.current) return;
      setPreparacion(
        listo
          ? { estado: 'listo', etapa: null }
          : {
              estado: 'solo-sesion',
              etapa:
                'El lector funciona ahora, pero este navegador no permitió guardarlo. Sin conexión puede no estar disponible.',
            },
      );
    } catch {
      if (montadoRef.current) {
        setPreparacion({ estado: 'error', etapa: 'No se pudo descargar el lector. Revisa tu conexión e inténtalo otra vez.' });
      }
    } finally {
      terminarUso();
      if (!ocupadoRef.current) oyenteProgresoRef.current = oyenteAnterior;
    }
  }, [empezarUso, obtenerWorker, oyenteProgresoRef, terminarUso]);

  const actualizarApp = useCallback(() => {
    const enEspera = window.__alertaQrSwEnEspera;
    if (!enEspera) return;
    // main.jsx recarga la página cuando la versión nueva toma el control.
    window.__alertaQrActualizacionPedida = true;
    enEspera.postMessage({ tipo: 'SALTAR_ESPERA' });
  }, []);

  /* ------------------------------------------------------------------------
   * Interfaz
   * ---------------------------------------------------------------------- */
  const errorImagen = estado.fase === 'error' && estado.campoError === 'imagen';
  const errorTexto = estado.fase === 'error' && estado.campoError === 'texto';

  return (
    <div
      className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-5 pb-8"
      style={{
        paddingTop: 'max(1rem, env(safe-area-inset-top))',
        paddingBottom: 'max(2rem, env(safe-area-inset-bottom))',
        paddingLeft: 'max(1rem, env(safe-area-inset-left))',
        paddingRight: 'max(1rem, env(safe-area-inset-right))',
      }}
    >
      {/* Región viva: anuncia cambios de fase, no cada punto de progreso. */}
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {anuncio}
      </p>

      {hayActualizacion && (
        <div className="flex flex-col gap-2 rounded-2xl border-2 border-marca bg-blue-50 p-4" role="status">
          <p className="font-semibold">Hay una versión nueva de la app.</p>
          <button type="button" className={claseBotonAzul} onClick={actualizarApp} disabled={procesando}>
            Actualizar ahora
          </button>
          {procesando && <p className="text-base">Podrás actualizar cuando termine la lectura.</p>}
        </div>
      )}

      {/* A. Encabezado */}
      <header className="flex flex-col gap-3">
        <div>
          <h1 className="text-3xl font-extrabold leading-tight text-marca">Alerta QR Bolivia</h1>
          <p className="text-lg text-slate-700">Lee el monto de tu notificación bancaria</p>
        </div>
        <p className="flex items-center gap-2 text-base">
          <span className="font-semibold">Estado:</span>
          <span
            className={`inline-flex items-center gap-2 rounded-full border-2 px-3 py-1 font-bold ${
              estado.fase === 'error'
                ? 'border-red-700 bg-red-50 text-red-800'
                : estado.fase === 'procesando'
                  ? 'border-marca bg-blue-50 text-marca'
                  : estado.fase === 'inicial'
                    ? 'border-slate-500 bg-white text-slate-800'
                    : 'border-amber-600 bg-amber-50 text-amber-900'
            }`}
          >
            <span aria-hidden="true">{ICONO_FASE[estado.fase]}</span>
            {TEXTO_FASE[estado.fase]}
          </span>
        </p>
        <p className="rounded-xl border-l-8 border-amber-500 bg-amber-50 p-3 font-semibold text-amber-950">
          <span aria-hidden="true">⚠ </span>
          Esta app lee el comprobante. Confirma el ingreso en tu banco.
        </p>
        {!enLinea && (
          <p className="rounded-xl bg-slate-200 p-3 text-slate-900" role="status">
            Sin conexión. Puedes leer texto pegado.
            {preparacion.estado === 'listo'
              ? ' El lector de imágenes está preparado.'
              : ' El lector de imágenes necesita prepararse con conexión.'}
          </p>
        )}
      </header>

      <main className="flex flex-col gap-5">
        {/* B. Acción principal: subir captura */}
        <section aria-labelledby="titulo-captura" className="flex flex-col gap-2 rounded-3xl bg-white p-4 shadow-sm">
          <h2 id="titulo-captura" className="sr-only">
            Leer una captura
          </h2>
          {/*
            El input está oculto visualmente pero sigue siendo accesible: la
            etiqueta <label> actúa como botón gigante. Sin "capture": el caso
            principal es elegir una captura existente de la galería.
          */}
          <input
            ref={inputArchivoRef}
            id="archivo"
            type="file"
            accept="image/*"
            className="peer sr-only"
            onChange={manejarArchivo}
            onClick={voz.desbloquear}
            disabled={procesando}
            aria-describedby={`ayuda-archivo${errorImagen ? ' error-imagen' : ''}`}
            aria-invalid={errorImagen || undefined}
          />
          <label
            htmlFor="archivo"
            className={`flex min-h-24 w-full cursor-pointer select-none items-center justify-center gap-3 rounded-2xl bg-marca px-4 py-4 text-center text-xl font-extrabold text-white shadow-md peer-focus-visible:outline-4 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-amber-500 ${
              procesando ? 'cursor-not-allowed opacity-50' : 'hover:bg-marca-oscuro active:bg-marca-oscuro'
            }`}
            aria-disabled={procesando || undefined}
          >
            <span aria-hidden="true" className="text-3xl">
              🖼️
            </span>
            Subir captura del comprobante
          </label>
          <p id="ayuda-archivo" className="text-base text-slate-700">
            Usa una captura de tu propia app bancaria.
          </p>

          {procesando && (
            <div className="flex flex-col gap-3 rounded-2xl bg-blue-50 p-3">
              <p className="font-semibold text-marca">{estado.etapa}</p>
              <div
                role="progressbar"
                aria-label="Progreso de la lectura"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={estado.porcentaje ?? undefined}
                aria-valuetext={estado.porcentaje != null ? `${estado.porcentaje} %` : estado.etapa}
                className="h-4 w-full overflow-hidden rounded-full bg-blue-200"
              >
                <div
                  className={`h-full rounded-full bg-marca transition-all ${
                    estado.porcentaje == null ? 'w-1/3 motion-safe:animate-pulse' : ''
                  }`}
                  style={estado.porcentaje != null ? { width: `${Math.max(4, estado.porcentaje)}%` } : undefined}
                />
              </div>
              {estado.porcentaje != null && <p className="text-base">{estado.porcentaje} %</p>}
              <button type="button" className={claseBotonBlanco} onClick={cancelarLectura}>
                Cancelar lectura
              </button>
            </div>
          )}

          {errorImagen && (
            <div
              id="error-imagen"
              ref={resultadoRef}
              tabIndex={-1}
              className="rounded-2xl border-2 border-red-700 bg-red-50 p-3 text-red-900"
            >
              <p className="font-bold">
                <span aria-hidden="true">✕ </span>No se pudo leer
              </p>
              <p>{MENSAJES_ERROR[estado.error] || MENSAJES_ERROR.general}</p>
            </div>
          )}
        </section>

        {/* C. Alternativa por texto */}
        <section aria-labelledby="titulo-texto" className="rounded-3xl bg-white p-4 shadow-sm">
          <h2 id="titulo-texto" className="sr-only">
            Leer el texto de un SMS
          </h2>
          <form className="flex flex-col gap-3" onSubmit={leerTexto} noValidate>
            <label htmlFor="texto-sms" className="text-lg font-bold">
              O pega el texto del SMS aquí
            </label>
            <textarea
              ref={textareaRef}
              id="texto-sms"
              value={texto}
              onChange={(e) => setTexto(e.target.value.slice(0, CONFIG.MAX_CARACTERES_TEXTO))}
              rows={4}
              maxLength={CONFIG.MAX_CARACTERES_TEXTO}
              placeholder="Ejemplo: Recibiste Bs 50,00 de JUAN P."
              className="w-full scroll-mb-40 rounded-xl border-2 border-slate-500 p-3 text-lg focus:border-marca"
              aria-invalid={errorTexto || undefined}
              aria-describedby={errorTexto ? 'error-texto' : 'ayuda-texto'}
              enterKeyHint="done"
              autoComplete="off"
              spellCheck={false}
              disabled={procesando}
            />
            <p id="ayuda-texto" className="text-base text-slate-700">
              El texto se analiza en tu teléfono y no se guarda.
            </p>
            {errorTexto && (
              <p id="error-texto" className="rounded-xl border-2 border-red-700 bg-red-50 p-3 font-semibold text-red-900">
                <span aria-hidden="true">✕ </span>
                {MENSAJES_ERROR[estado.error]}
              </p>
            )}
            <button
              type="submit"
              className={claseBotonAzul}
              disabled={procesando}
              aria-describedby={procesando ? 'aviso-ocupado' : undefined}
            >
              <span aria-hidden="true">🔎</span> Leer monto del texto
            </button>
            {procesando && (
              <p id="aviso-ocupado" className="text-base font-semibold text-slate-800">
                Espera a que termine la lectura de la imagen o pulsa «Cancelar lectura».
              </p>
            )}
            {puedePegar && (
              <button type="button" className={claseBotonBlanco} onClick={pegarDesdePortapapeles} disabled={procesando}>
                <span aria-hidden="true">📋</span> Pegar desde el portapapeles
              </button>
            )}
            {avisoPortapapeles && (
              <p className="text-base font-semibold text-slate-900" role="status">
                {avisoPortapapeles}
              </p>
            )}
          </form>
        </section>

        {/* D. Prueba de sonido */}
        <section aria-labelledby="titulo-prueba" className="flex flex-col gap-2 rounded-3xl bg-white p-4 shadow-sm">
          <h2 id="titulo-prueba" className="text-lg font-bold">
            Prueba de sonido
          </h2>
          <button type="button" className={claseBotonBlanco} onClick={simularPrueba}>
            <span aria-hidden="true">🔊</span> Simular prueba
          </button>
          <p className="text-base text-slate-700">
            La app no puede subir el volumen del teléfono. Súbelo con los botones laterales.
          </p>
          {voz.soporte && voz.vocesCargadas && !voz.vozLocal && !avisoPrueba && (
            <p className="text-base font-semibold">{MENSAJES_VOZ['sin-voz-local']}</p>
          )}
          {avisoPrueba && (
            <p className="text-base font-semibold" role="status">
              {avisoPrueba}
            </p>
          )}
        </section>

        {/* E. Resultado */}
        {estado.fase === 'resultado' && (
          <section
            aria-labelledby="titulo-resultado"
            className="flex flex-col gap-3 rounded-3xl border-4 border-marca bg-white p-4 shadow-md"
          >
            <h2 id="titulo-resultado" ref={resultadoRef} tabIndex={-1} className="text-xl font-bold">
              Monto detectado
            </h2>
            <p className="break-words text-5xl font-extrabold tabular-nums text-slate-950">
              <span className="text-3xl">Bs</span> {formatearMonto(estado.centavos)}
            </p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-base">
              <dt className="font-semibold">Moneda:</dt>
              <dd>
                bolivianos
                {estado.monedaAsumida && ' (asumida: el texto no indica la moneda)'}
              </dd>
              <dt className="font-semibold">Origen:</dt>
              <dd>{ETIQUETA_ORIGEN[estado.origen]}</dd>
              {estado.calidad && (
                <>
                  <dt className="font-semibold">Lectura:</dt>
                  <dd>
                    nitidez {estado.calidad}. No indica si el pago es real.
                  </dd>
                </>
              )}
            </dl>
            <Advertencias lista={estado.advertencias} />
            <p className="rounded-xl bg-amber-50 p-3 text-base font-semibold text-amber-950">
              Antes de entregar mercadería, confirma el abono en la app o los movimientos de tu propia cuenta.
            </p>
            {vistaPrevia && (
              <img
                src={vistaPrevia}
                alt="Captura que se leyó"
                className="max-h-48 w-full rounded-xl border border-slate-300 object-contain"
              />
            )}
            <button type="button" className={claseBotonAzul} onClick={escucharMonto}>
              <span aria-hidden="true">🔊</span> Escuchar monto
            </button>
            {avisoVoz && (
              <p className="text-base font-semibold" role="status">
                {avisoVoz}
              </p>
            )}
            <button type="button" className={claseBotonBlanco} onClick={leerOtro}>
              Leer otro comprobante
            </button>
          </section>
        )}

        {estado.fase === 'ambiguo' && (
          <section
            aria-labelledby="titulo-ambiguo"
            className="flex flex-col gap-3 rounded-3xl border-4 border-amber-600 bg-white p-4 shadow-md"
          >
            <h2 id="titulo-ambiguo" ref={resultadoRef} tabIndex={-1} className="text-xl font-bold">
              <span aria-hidden="true">? </span>Revisa el resultado
            </h2>
            <p>
              {estado.motivoOpciones === 'separador-tres-digitos'
                ? 'El formato del monto es ambiguo (por ejemplo, «1.250» puede ser mil doscientos cincuenta o uno con veinticinco). Toca el monto que ves en tu comprobante:'
                : estado.motivoOpciones === 'un-decimal'
                  ? 'El monto tiene un formato poco habitual. Confirma si es este:'
                  : 'Encontramos más de un monto posible. Toca el que corresponde al abono:'}
            </p>
            <Advertencias lista={estado.advertencias} />
            <ul className="flex flex-col gap-2">
              {estado.opciones.map((centavos) => (
                <li key={centavos}>
                  <button type="button" className={claseBotonBlanco} onClick={() => elegirOpcion(centavos)}>
                    Bs {formatearMonto(centavos)}
                  </button>
                </li>
              ))}
            </ul>
            {vistaPrevia && (
              <img
                src={vistaPrevia}
                alt="Captura que se leyó"
                className="max-h-48 w-full rounded-xl border border-slate-300 object-contain"
              />
            )}
            {avisoVoz && (
              <p className="text-base font-semibold" role="status">
                {avisoVoz}
              </p>
            )}
            <button type="button" className={claseBotonBlanco} onClick={leerOtro}>
              Ninguno es correcto: leer otro comprobante
            </button>
          </section>
        )}

        {/* F. Historial temporal (solo memoria) */}
        <section aria-labelledby="titulo-historial" className="flex flex-col gap-3 rounded-3xl bg-white p-4 shadow-sm">
          <h2 id="titulo-historial" className="text-lg font-bold">
            Últimas 3 lecturas
          </h2>
          {historial.length === 0 ? (
            <p className="text-base text-slate-700">Todavía no hay lecturas. Se borran al cerrar o recargar la app.</p>
          ) : (
            <>
              <ol className="flex flex-col gap-2">
                {historial.map((item) => (
                  <li key={item.id} className="rounded-xl border border-slate-300 p-3">
                    <p className="text-2xl font-bold tabular-nums">Bs {formatearMonto(item.centavos)}</p>
                    <p className="text-base text-slate-700">
                      {horaCorta(item.hora)} · {ETIQUETA_ORIGEN[item.origen]}
                      {item.conAdvertencia && ' · ⚠ con advertencia de estado'}
                    </p>
                  </li>
                ))}
              </ol>
              <p className="text-sm text-slate-700">
                Son lecturas de texto, no pagos confirmados. Un monto repetido no significa un pago duplicado.
              </p>
              <button type="button" className={claseBotonBlanco} onClick={() => setHistorial([])}>
                Borrar historial
              </button>
            </>
          )}
        </section>

        {/* Ayuda: uso sin conexión e instalación */}
        <section className="rounded-3xl bg-white p-4 shadow-sm">
          <details>
            <summary className="flex min-h-14 cursor-pointer items-center text-lg font-bold">
              Usar sin internet e instalar
            </summary>
            <div className="flex flex-col gap-3 pt-2 text-base">
              <p>
                Leer texto pegado funciona sin internet. Para leer imágenes sin internet, prepara el lector una vez
                con conexión (descarga unos 6 MB). La descarga trae el programa lector; tus capturas nunca se suben.
              </p>
              <button
                type="button"
                className={claseBotonBlanco}
                onClick={prepararSinConexion}
                disabled={preparacion.estado === 'preparando' || procesando}
              >
                Preparar lectura de imágenes sin conexión
              </button>
              <p role="status" className="font-semibold">
                {preparacion.estado === 'listo' && '✓ Lector de imágenes listo para usar sin conexión.'}
                {preparacion.estado !== 'listo' && preparacion.etapa}
              </p>
              <p>
                <strong>Android (Chrome):</strong> abre el menú ⋮ y elige «Instalar aplicación» o «Añadir a pantalla
                de inicio».
              </p>
              <p>
                <strong>iPhone (Safari):</strong> toca Compartir (cuadro con flecha) y elige «Añadir a pantalla de
                inicio».
              </p>
              <p className="text-slate-700">
                Privacidad: sin cuentas, sin publicidad y sin seguimiento. Todo se procesa en este teléfono.
              </p>
            </div>
          </details>
        </section>
      </main>
    </div>
  );
}

function Advertencias({ lista }) {
  if (!lista.length) return null;
  return (
    <div className="rounded-xl border-2 border-red-700 bg-red-50 p-3 text-red-900">
      <p className="font-bold">
        <span aria-hidden="true">⚠ </span>Atención: el texto dice «{lista.join('», «')}».
      </p>
      <p>No lo tomes como ingreso. Revisa tu banco antes de entregar mercadería.</p>
    </div>
  );
}
