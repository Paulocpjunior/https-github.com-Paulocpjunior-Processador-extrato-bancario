
export interface DateValidationResult {
  isValid: boolean;
  message?: string;
}

export const validateDate = (dateString: string): DateValidationResult => {
  if (!dateString) {
    return { isValid: false, message: 'A data não pode estar em branco.' };
  }
  
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateString)) {
    return { isValid: false, message: 'Formato inválido. Use AAAA-MM-DD.' };
  }

  const date = new Date(dateString + 'T00:00:00Z'); // Use UTC para evitar problemas de fuso horário
  
  const [year, month, day] = dateString.split('-').map(Number);

  if (
    isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    return { isValid: false, message: 'Data inválida (ex: dia 31 em um mês com 30 dias).' };
  }

  return { isValid: true };
};
