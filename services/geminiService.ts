
import { GoogleGenAI, Type } from "@google/genai";
import { fileToBase64 } from "../utils/fileUtils";
import { GeminiTransactionResponse } from "../types";
import { TRANSACTION_CATEGORIES } from '../constants';

const processEnvKey = typeof process !== 'undefined' ? process.env?.GEMINI_API_KEY : undefined;
const windowEnvKey = typeof window !== 'undefined' ? (window as any).ENV?.GEMINI_API_KEY : undefined;

// The key will be read from the window.ENV (injected by Docker at runtime) or from the build process
const API_KEY = windowEnvKey !== "__GEMINI_API_KEY__" ? windowEnvKey : processEnvKey;

if (!API_KEY || API_KEY === "__GEMINI_API_KEY__") {
    throw new Error("A variável de ambiente GEMINI_API_KEY não está definida.");
}
const ai = new GoogleGenAI({ apiKey: API_KEY });

/**
 * Helper to clean JSON response from LLM
 */
const cleanJsonResponse = (text: string): string => {
    let cleaned = text.trim();
    if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```json\n?/, '').replace(/```$/, '').trim();
    }

    // Auto-repair truncated JSON (basic check for matching brackets)
    const openBraces = (cleaned.match(/{/g) || []).length;
    const closeBraces = (cleaned.match(/}/g) || []).length;
    const openBrackets = (cleaned.match(/\[/g) || []).length;
    const closeBrackets = (cleaned.match(/\]/g) || []).length;

    if (openBrackets > closeBrackets) {
        cleaned += ']'.repeat(openBrackets - closeBrackets);
    }
    if (openBraces > closeBraces) {
        cleaned += '}'.repeat(openBraces - closeBraces);
    }

    return cleaned;
};

const responseSchema = {
    type: Type.OBJECT,
    properties: {
        transactions: {
            type: Type.ARRAY,
            description: "Uma lista de todas as transações financeiras encontradas no documento.",
            items: {
                type: Type.OBJECT,
                properties: {
                    date: {
                        type: Type.STRING,
                        description: 'Data da transação, formatada como AAAA-MM-DD. Inferir o ano se estiver ausente.'
                    },
                    description: {
                        type: Type.STRING,
                        description: 'A descrição completa e detalhada da transação.'
                    },
                    debit: {
                        type: Type.NUMBER,
                        description: 'O valor do débito (saída de dinheiro, pagamentos, tarifas, valores negativos). Deve ser sempre um número positivo. Coloque 0 se for crédito.'
                    },
                    credit: {
                        type: Type.NUMBER,
                        description: 'O valor do crédito (entrada de dinheiro, recebimentos, depósitos, valores positivos). Deve ser sempre um número positivo. Coloque 0 se for débito.'
                    },
                    companyName: {
                        type: Type.STRING,
                        description: 'O nome da empresa associada à transação, se houver. Caso contrário, deixe em branco.'
                    },
                    cnpj: {
                        type: Type.STRING,
                        description: 'O CNPJ da empresa associada, se houver. Retorne apenas os números. Caso contrário, deixe em branco.'
                    },
                    category: {
                        type: Type.STRING,
                        description: `Sugira a categoria contábil mais apropriada para a transação. Escolha uma das seguintes opções: ${TRANSACTION_CATEGORIES.join(', ')}.`
                    },
                    isUnusual: {
                        type: Type.BOOLEAN,
                        description: "Analise a transação quanto a anomalias (valor extremo, descrição suspeita) e defina como 'true' se for incomum."
                    },
                    unusualReason: {
                        type: Type.STRING,
                        description: "Se 'isUnusual' for 'true', forneça uma breve justificativa (máximo 100 caracteres). Caso contrário, deixe em branco."
                    },
                    accountDebit: {
                        type: Type.STRING,
                        description: "Sugira um número de conta contábil ou nome genérico para o Débito (ex: 'Caixa/Bancos' ou 'Fornecedores'). Se não tiver certeza, deixe em branco."
                    },
                    accountCredit: {
                        type: Type.STRING,
                        description: "Sugira um número de conta contábil ou nome genérico para o Crédito (ex: 'Receita de Vendas' ou 'Caixa/Bancos'). Se não tiver certeza, deixe em branco."
                    },
                    accountingHistory: {
                        type: Type.STRING,
                        description: "Sugira um histórico padrão contábil resumido e limpo (ex: 'VLR REF PAGTO FORNECEDOR X')."
                    }
                },
                required: ['date', 'description', 'debit', 'credit', 'companyName', 'cnpj', 'category', 'isUnusual', 'unusualReason', 'accountDebit', 'accountCredit', 'accountingHistory']
            }
        },
        finalBalance: {
            type: Type.NUMBER,
            description: "O saldo final (saldo atual) declarado no extrato bancário. Se não for encontrado, omita este campo."
        },
        bankName: {
            type: Type.STRING,
            description: "O nome do banco do qual o extrato se origina (ex: Banco do Brasil, Itaú, Bradesco). Se não for encontrado, omita este campo."
        },
        accountHolderCNPJ: {
            type: Type.STRING,
            description: "O CNPJ do titular da conta ou da empresa proprietária do extrato bancário. Retorne apenas números. Se não encontrado, omita este campo."
        }
    },
    required: ['transactions']
};


export const processBankStatementPDF = async (file: File): Promise<GeminiTransactionResponse> => {
    const base64pdf = await fileToBase64(file);

    const pdfPart = {
        inlineData: {
            mimeType: 'application/pdf',
            data: base64pdf,
        },
    };

    const textPart = {
        text: `Analise o extrato bancário em PDF. Para cada transação, extraia: data (AAAA-MM-DD), descrição, valor (como débito ou crédito), nome da empresa e CNPJ (apenas números), se disponível. Extraia também o nome do banco e o CNPJ do titular da conta (empresa dona do extrato) se identificável no cabeçalho ou rodapé. Sugira uma categoria contábil da lista fornecida. 

        CRITÉRIOS PARA 'isUnusual' (Transações Suspeitas):
        Sinalize com 'isUnusual': true e forneça o motivo em 'unusualReason' se:
        1. Valor muito alto ou atípico para o contexto.
        2. Descrição vaga ou genérica (ex: "Diversos", "Outros").
        3. Valores redondos exatos (ex: 1000.00, 5000.00) que não parecem salários ou aluguéis.
        4. Transações duplicadas (mesma data, descrição e valor).
        5. Transações em horários ou dias estranhos (se a informação de hora estiver disponível).
        6. Pagamentos para a própria empresa ou sócios sem clara justificativa.

        REGRA CRÍTICA PARA VALORES: 
        A classificação entre Débito e Crédito DEVE ser baseada ESTRITAMENTE na coluna em que o valor aparece no extrato original, ou no sinal do valor (negativo = débito, positivo = crédito). 
        IGNORE palavras na descrição como "pagamento", "recebimento", "transferência" se elas contradisserem a coluna do valor. 
        Débito = saídas/pagamentos (negativo ou coluna de saída). Crédito = entradas/recebimentos (positivo ou coluna de entrada). Retorne valores como números positivos absolutos.
        
        CONTABILIDADE:
        Sempre infira 'accountDebit', 'accountCredit' e 'accountingHistory'. Use CAIXA ALTA e nomes genéricos de plano de contas (ex: "Bancos", "Fornecedores") se não souber o código.
        
        REGRAS FINAIS:
        Seja conciso. Se um campo for inexistente, retorne "". Preencha o JSON estritamente conforme o schema.`,
    };

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.0-flash',
            contents: { parts: [textPart, pdfPart] },
            config: {
                responseMimeType: "application/json",
                responseSchema: responseSchema,
                temperature: 0.1,
                maxOutputTokens: 8192,
            },
        });

        const jsonText = cleanJsonResponse(response.text);
        let parsedResponse: GeminiTransactionResponse;

        try {
            parsedResponse = JSON.parse(jsonText);
        } catch (parseError) {
            console.error("Failed to parse Gemini JSON:", jsonText);
            throw new Error(`Erro na resposta da IA: O formato dos dados retornados está incompleto (JSON Parse error). Isso geralmente acontece com documentos muito longos. Tente processar o documento novamente ou em partes menores.`);
        }

        if (!parsedResponse.transactions || !Array.isArray(parsedResponse.transactions)) {
            throw new Error("Estrutura JSON inválida recebida da API.");
        }

        // Ensure new fields are present
        parsedResponse.transactions = parsedResponse.transactions.map(t => ({
            ...t,
            companyName: t.companyName || '',
            cnpj: t.cnpj || '',
            category: t.category || 'Não categorizado',
            isUnusual: t.isUnusual || false,
            unusualReason: t.unusualReason || '',
            accountDebit: t.accountDebit || '',
            accountCredit: t.accountCredit || '',
            accountingHistory: t.accountingHistory || '',
        }));

        return parsedResponse;

    } catch (error: unknown) {
        console.error("Error processing PDF with Gemini API:", error);

        // Log more details if it's an API error
        if (error instanceof Error) {
            console.error("API Message:", error.message);
            const apiError = error as any;
            if (apiError.status) {
                console.error("API Status:", apiError.status);
            }
            throw new Error(`O modelo de IA não conseguiu processar este documento. Detalhe do erro: ${error.message}. Verifique se é um extrato bancário válido.`);
        }

        throw new Error("O modelo de IA não conseguiu processar este documento. O arquivo pode estar corrompido ou em um formato não suportado.");
    }
};


export const suggestDateCorrection = async (invalidDate: string): Promise<string> => {
    if (!invalidDate.trim()) return "";
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.0-flash',
            contents: `A seguinte string de data está incorreta: "${invalidDate}". Com base em erros comuns de OCR e digitação, qual é a data correta mais provável no formato AAAA-MM-DD? Responda apenas com a data corrigida. Exemplos: "2024.05.10" -> "2024-05-10", "30/02/2024" -> "2024-02-29", "2023-13-01" -> "2023-12-01".`,
            config: {
                temperature: 0,
                stopSequences: ['\n'],
            },
        });

        return response.text.trim();
    } catch (error) {
        console.error("Erro ao sugerir correção de data:", error);
        return invalidDate; // Retorna o original em caso de falha
    }
};

export const suggestNewCategory = async (description: string, currentCategory: string): Promise<string> => {
    if (!description.trim()) return currentCategory;
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.0-flash',
            contents: `Dada a descrição da transação: "${description}" e a categoria atual: "${currentCategory}", sugira a categoria mais apropriada da seguinte lista: [${TRANSACTION_CATEGORIES.join(', ')}]. Responda apenas com o nome da categoria. Se a categoria atual já for a melhor, retorne-a.`,
            config: {
                temperature: 0.1,
                stopSequences: ['\n'],
            },
        });

        const suggestedCategory = response.text.trim();
        // Simple validation to ensure the returned category is one of the allowed ones
        if (TRANSACTION_CATEGORIES.includes(suggestedCategory)) {
            return suggestedCategory;
        }
        return currentCategory; // Return original if suggestion is invalid

    } catch (error) {
        console.error("Erro ao sugerir nova categoria:", error);
        return currentCategory; // Retorna a original em caso de falha
    }
};
