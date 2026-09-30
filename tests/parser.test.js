// Pruebas del intérprete de montos. Todos los textos son EJEMPLOS SINTÉTICOS
// escritos para estas pruebas; no son plantillas oficiales de ningún banco.
import { describe, expect, it } from 'vitest';
import {
  analizarTexto,
  corregirOcrNumerico,
  crearTextoParaVoz,
  detectarEstadosAdversos,
  elegirVozLocal,
  extraerCandidatosDeMonto,
  formatearMonto,
  normalizarImporte,
  normalizarTexto,
} from '../src/App.jsx';

describe('normalizarTexto', () => {
  it('quita tildes, pasa a minúsculas y colapsa espacios', () => {
    expect(normalizarTexto('  Operación  EXITOSA \r\n\r\n\r\n Bs  50 ')).toBe('operacion exitosa\n\nbs 50');
  });
  it('tolera valores que no son texto', () => {
    expect(normalizarTexto(null)).toBe('');
  });
});

describe('normalizarImporte', () => {
  it.each([
    ['50', 5000],
    ['20.50', 2050],
    ['20,50', 2050],
    ['1.250,50', 125050],
    ['1,250.50', 125050],
    ['150,00', 15000],
    ['1.250.000', 125000000],
  ])('%s → %i centavos', (entrada, centavos) => {
    expect(normalizarImporte(entrada, Number.MAX_SAFE_INTEGER)).toEqual({ estado: 'valido', centavos });
  });

  it('marca "1.250" como ambiguo y ofrece ambas lecturas', () => {
    expect(normalizarImporte('1.250')).toEqual({
      estado: 'ambiguo',
      opciones: [125000, 125],
      motivo: 'separador-tres-digitos',
    });
  });

  it('"1.257" solo puede ser miles, pero igual pide revisión', () => {
    expect(normalizarImporte('1.257')).toEqual({ estado: 'ambiguo', opciones: [125700], motivo: 'separador-tres-digitos' });
  });

  it.each(['0', '0,00', '-50', '1.2.3', '12,3456', '050', '1..0', '1.250,5', 'abc', ''])(
    'rechaza "%s"',
    (entrada) => {
      expect(normalizarImporte(entrada).estado).toBe('invalido');
    },
  );

  it('rechaza valores sobre el límite técnico', () => {
    expect(normalizarImporte('500000')).toEqual({ estado: 'invalido', motivo: 'fuera-de-limite' });
  });
});

describe('corregirOcrNumerico', () => {
  it('cambia "o" por cero solo en una cadena numérica', () => {
    expect(corregirOcrNumerico('5o,oo')).toBe('50,00');
    expect(corregirOcrNumerico('oo')).toBeNull();
  });
  it('lo aplica al leer "Bs 5O,00" pero no a palabras', () => {
    expect(analizarTexto('Recibiste Bs 5O,00 de Pedro')).toMatchObject({ tipo: 'unico', centavos: 5000 });
  });
});

describe('formatos mínimos reconocidos', () => {
  it.each([
    ['Bs. 50', 5000],
    ['Bs50', 5000],
    ['Bs 50', 5000],
    ['Bs. 20.50', 2050],
    ['Bs 20,50', 2050],
    ['BOB 100', 10000],
    ['100 Bs', 10000],
    ['Monto: 100', 10000],
    ['Importe: Bs. 150,00', 15000],
    ['Monto recibido: Bs 1.250,50', 125050],
    ['Monto abonado: BOB 1,250.50', 125050],
    ['MONTO   RECIBIDO:\n  bs 75,00', 7500],
  ])('%j → %i', (entrada, centavos) => {
    expect(analizarTexto(entrada)).toMatchObject({ tipo: 'unico', centavos });
  });
});

describe('tabla de casos mínimos', () => {
  it('1. Recibiste Bs. 50 → 50,00', () => {
    expect(analizarTexto('Recibiste Bs. 50')).toMatchObject({ tipo: 'unico', centavos: 5000, advertencias: [] });
  });
  it('2. Abono recibido: Bs50 → 50,00', () => {
    expect(analizarTexto('Abono recibido: Bs50')).toMatchObject({ tipo: 'unico', centavos: 5000 });
  });
  it('3. Monto: 100 → 100,00 con moneda asumida', () => {
    expect(analizarTexto('Monto: 100')).toMatchObject({ tipo: 'unico', centavos: 10000, monedaAsumida: true });
  });
  it('4. Importe: Bs. 20.50 → 20,50', () => {
    expect(analizarTexto('Importe: Bs. 20.50')).toMatchObject({ tipo: 'unico', centavos: 2050, monedaAsumida: false });
  });
  it('5. Monto abonado: Bs 1.250,50 → 1250,50', () => {
    expect(analizarTexto('Monto abonado: Bs 1.250,50')).toMatchObject({ tipo: 'unico', centavos: 125050 });
  });
  it('6. Monto abonado: BOB 1,250.50 → 1250,50', () => {
    expect(analizarTexto('Monto abonado: BOB 1,250.50')).toMatchObject({ tipo: 'unico', centavos: 125050 });
  });
  it('7. Saldo: Bs 500. Monto recibido: Bs 50 → 50,00', () => {
    expect(analizarTexto('Saldo: Bs 500. Monto recibido: Bs 50')).toMatchObject({ tipo: 'unico', centavos: 5000 });
    expect(analizarTexto('Saldo: Bs. 500. Monto recibido: Bs. 50')).toMatchObject({ tipo: 'unico', centavos: 5000 });
  });
  it('8. Operación 123456. Fecha 29/09/2026 → ningún monto', () => {
    expect(analizarTexto('Operación 123456. Fecha 29/09/2026')).toMatchObject({ tipo: 'ninguno' });
  });
  it('9. Transferencia pendiente → advertencia', () => {
    expect(analizarTexto('Transferencia pendiente por Bs 50')).toMatchObject({
      tipo: 'unico',
      centavos: 5000,
      advertencias: ['pendiente'],
    });
  });
  it('10. Transacción rechazada → advertencia', () => {
    expect(analizarTexto('Transacción rechazada. Monto Bs 50')).toMatchObject({
      centavos: 5000,
      advertencias: ['rechazada'],
    });
  });
  it('11. Dos importes igualmente plausibles → selección manual', () => {
    expect(analizarTexto('Recibiste Bs 50. Recibiste Bs 80')).toEqual({
      tipo: 'varios',
      opciones: [5000, 8000],
      advertencias: [],
    });
  });
  it('12. Texto vacío → vacío', () => {
    expect(analizarTexto('   \n ')).toEqual({ tipo: 'vacio', advertencias: [] });
  });
  it('13. Texto de OCR sin montos (imagen sin texto útil) → ninguno', () => {
    expect(analizarTexto('~~ |||  ..')).toMatchObject({ tipo: 'ninguno' });
  });
  it('14. Formato ambiguo → revisión sin adivinar', () => {
    expect(analizarTexto('Monto recibido: Bs 1.250')).toMatchObject({
      tipo: 'revisar',
      opciones: [125000, 125],
    });
  });
});

describe('no confunde montos con otros números', () => {
  it.each([
    ['Hora 10:30. Cel 71234567. Cuenta 1234567890', 'ninguno'],
    ['Nro. de operación: 998877. Referencia 4455', 'ninguno'],
    ['Comisión Bs 2,00', 'ninguno'],
    ['Saldo disponible: Bs 1.500,00', 'ninguno'],
    ['Monto: USD 50', 'ninguno'],
  ])('%j → %s', (entrada, tipo) => {
    expect(analizarTexto(entrada).tipo).toBe(tipo);
  });

  it('ignora la comisión y el saldo en un texto completo', () => {
    const sms =
      'BANCO EJEMPLO (sintético): Recibiste una transferencia de MARIA L.\n' +
      'Monto recibido: Bs 35,50\nComisión: Bs 0,00\nSaldo: Bs 1.220,00\n' +
      'Fecha 29/09/2026 14:05 Nro. operación 123456789';
    expect(analizarTexto(sms)).toMatchObject({ tipo: 'unico', centavos: 3550, advertencias: [] });
  });

  it('unifica montos repetidos', () => {
    expect(analizarTexto('Te enviaron Bs 20,00\nImporte: Bs 20.00')).toMatchObject({ tipo: 'unico', centavos: 2000 });
  });

  it('informa por qué descartó cada candidato', () => {
    const motivos = extraerCandidatosDeMonto('Saldo: Bs 500. Fecha 29/09/2026 Monto recibido: Bs 50')
      .filter((c) => c.descartado)
      .map((c) => c.motivo);
    expect(motivos).toContain('saldo-o-comision');
  });
});

describe('estados adversos', () => {
  it.each([
    ['Transferencia ANULADA', ['anulada']],
    ['La operación no fue realizada', ['no realizada']],
    ['Pago exitoso', []],
  ])('%j', (texto, esperado) => {
    expect(detectarEstadosAdversos(texto)).toEqual(esperado);
  });
});

describe('formato y voz', () => {
  it('formatea en estilo boliviano', () => {
    expect(formatearMonto(125050)).toBe('1.250,50');
    expect(formatearMonto(5000)).toBe('50,00');
    expect(formatearMonto(5)).toBe('0,05');
  });
  it('frase predeterminada', () => {
    expect(crearTextoParaVoz(5000)).toBe('Monto detectado: 50 bolivianos. Revisa el abono en tu banco');
  });
  it('frase con centavos y sin separador de miles', () => {
    expect(crearTextoParaVoz(2050)).toBe(
      'Monto detectado: 20 bolivianos con 50 centavos. Revisa el abono en tu banco',
    );
    expect(crearTextoParaVoz(125050)).toBe(
      'Monto detectado: 1250 bolivianos con 50 centavos. Revisa el abono en tu banco',
    );
    expect(crearTextoParaVoz(101)).toBe('Monto detectado: 1 boliviano con 1 centavo. Revisa el abono en tu banco');
  });
  it('nunca dice "pago recibido" y alerta estados adversos', () => {
    const frase = crearTextoParaVoz(5000, { advertencias: ['pendiente'] });
    expect(frase).toMatch(/^Atención: el texto dice pendiente/);
    expect(frase.toLowerCase()).not.toContain('pago recibido');
  });
});

describe('elegirVozLocal', () => {
  const voz = (lang, localService, name = lang) => ({ lang, localService, name });
  it('prefiere es-BO local', () => {
    expect(elegirVozLocal([voz('es-ES', true), voz('es-BO', true), voz('es-MX', true)]).lang).toBe('es-BO');
  });
  it('usa otra voz local en español como alternativa', () => {
    expect(elegirVozLocal([voz('es-BO', false), voz('es-ES', true)]).lang).toBe('es-ES');
  });
  it('no usa voces remotas ni de otro idioma', () => {
    expect(elegirVozLocal([voz('es-BO', false), voz('en-US', true)])).toBeNull();
  });
});
