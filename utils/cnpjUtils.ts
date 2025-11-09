
export interface CNPJValidationResult {
  isValid: boolean;
  message?: string;
}

export const validateCNPJ = (cnpj: string): CNPJValidationResult => {
  if (!cnpj) {
    return { isValid: true }; // Vazio não é inválido
  }

  const cnpjClean = cnpj.replace(/[^\d]/g, '');

  if (cnpjClean.length !== 14) {
    return { isValid: false, message: 'O CNPJ deve ter 14 números.' };
  }

  // Verifica sequências inválidas conhecidas
  if (/^(\d)\1+$/.test(cnpjClean)) {
    return { isValid: false, message: 'CNPJ inválido (dígitos repetidos).' };
  }

  // Valida os Dígitos Verificadores
  let size = cnpjClean.length - 2;
  let numbers = cnpjClean.substring(0, size);
  const digits = cnpjClean.substring(size);
  let sum = 0;
  let pos = size - 7;

  for (let i = size; i >= 1; i--) {
    sum += Number(numbers.charAt(size - i)) * pos--;
    if (pos < 2) {
      pos = 9;
    }
  }

  let result = sum % 11 < 2 ? 0 : 11 - (sum % 11);
  if (result !== Number(digits.charAt(0))) {
    return { isValid: false, message: 'CNPJ inválido. Verifique os números.' };
  }

  size = size + 1;
  numbers = cnpjClean.substring(0, size);
  sum = 0;
  pos = size - 7;

  for (let i = size; i >= 1; i--) {
    sum += Number(numbers.charAt(size - i)) * pos--;
    if (pos < 2) {
      pos = 9;
    }
  }

  result = sum % 11 < 2 ? 0 : 11 - (sum % 11);
  if (result !== Number(digits.charAt(1))) {
    return { isValid: false, message: 'CNPJ inválido. Verifique os números.' };
  }

  return { isValid: true };
};


export const formatCNPJForDisplay = (cnpj: string): string => {
    const digitsOnly = (cnpj || '').replace(/\D/g, '');
    return digitsOnly
      .replace(/^(\d{2})(\d)/, '$1.$2')
      .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/\.(\d{3})(\d)/, '.$1/$2')
      .replace(/(\d{4})(\d)/, '$1-$2')
      .slice(0, 18); // Limita a XX.XXX.XXX/XXXX-XX
};
