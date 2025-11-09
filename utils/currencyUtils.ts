
export interface CurrencyValidationResult {
  isValid: boolean;
  message?: string;
}

/**
 * Validates if a string is a potentially valid Brazilian currency input.
 * Allows for thousand separators and a single comma for decimals.
 * @param value The string value to validate.
 * @returns CurrencyValidationResult object.
 */
export const validateCurrency = (value: string): CurrencyValidationResult => {
  if (!value || value.trim() === '') {
    return { isValid: true }; // Empty is considered valid.
  }

  const cleanedValue = value.trim();

  // Check for invalid characters (anything not a digit, comma, or period)
  if (/[^0-9,.]/g.test(cleanedValue)) {
    return { isValid: false, message: 'Use apenas números, vírgulas e pontos.' };
  }

  // Check for multiple commas
  if ((cleanedValue.match(/,/g) || []).length > 1) {
    return { isValid: false, message: 'Apenas uma vírgula é permitida.' };
  }

  // Check that comma is for decimals (at most 2 digits after)
  if (cleanedValue.includes(',')) {
    const decimalPart = cleanedValue.split(',')[1];
    if (decimalPart.length > 2) {
      return { isValid: false, message: 'Apenas duas casas decimais são permitidas.' };
    }
  }

  // Check dot placement for thousands separators
  const integerPart = cleanedValue.split(',')[0];
  if (integerPart.includes('.')) {
    const thousandsGroups = integerPart.split('.');
    if (thousandsGroups[0].length > 3) {
      return { isValid: false, message: 'Formato de milhar inválido.' };
    }
    for (let i = 1; i < thousandsGroups.length; i++) {
      if (thousandsGroups[i].length !== 3) {
        return { isValid: false, message: 'Grupos de milhar devem ter 3 dígitos.' };
      }
    }
  }

  return { isValid: true };
};

/**
 * Parses a Brazilian currency string into a number.
 * Example: "1.234,56" -> 1234.56
 * @param value The currency string.
 * @returns The parsed number.
 */
export const parseCurrency = (value: string): number => {
  if (!value) return 0;
  // Remove thousand separators, then replace decimal comma with a dot
  const normalized = value.replace(/\./g, '').replace(',', '.');
  const parsed = parseFloat(normalized);
  return isNaN(parsed) ? 0 : parsed;
};
